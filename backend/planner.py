"""Budgeted club + public-market planning, with explicit search coverage."""
from __future__ import annotations

import json
import time
from copy import deepcopy
from fastapi.responses import Response

from . import setup
from .solver_policy import flag, identifier, normalize_policy, owned_price_stale, positive_price
from .live_market import plan_live


def validate_scope(body, catalog):
    """Never reuse a labelled card or quote from another season/platform."""
    for label, item in [("SBC", body.sbcData), *[(f"Card {i}", p) for i, p in enumerate(body.clubPlayers)]]:
        for key in ("gameYear", "priceGameYear"):
            if item.get(key) is not None and str(item[key]) != str(catalog.game_year):
                raise ValueError(f"{label}: {key} differs from selected FC {catalog.game_year}. Export the correct season.")
        for key in ("platform", "pricePlatform"):
            if item.get(key) is not None and item[key] != catalog.platform:
                raise ValueError(f"{label}: {key} differs from selected {catalog.platform} market.")


def price_diagnostics(result, refresh):
    diagnostics = result.setdefault("diagnostics", {})
    if refresh is not None:
        diagnostics["priceRefresh"] = refresh
        if refresh["state"] not in ("fresh", "refreshed"):
            diagnostics.setdefault("warnings", []).append("Current public prices could not be refreshed. Existing quote freshness checks and player value limits remain in force.")
    unavailable = diagnostics.get("priceLimitWithoutQuote", {})
    count = sum(unavailable.get(key, 0) for key in ("stale", "missing"))
    if count and not result.get("solution") and result.get("status_code") == 3:
        # Keep the proof for the restricted pool, but do not describe missing
        # prices as proof that the owned club cannot satisfy this challenge.
        diagnostics["priceLimitedSolveStatus"] = {"status_code": result["status_code"], "status_key": result.get("status_key"), "status": result.get("status")}
        result.update(status_code=0, status_key="PRICES_UNAVAILABLE",
                      status=f"No squad found among currently valued cards. {count} otherwise eligible owned cards were excluded by the player value limit because prices are stale or missing; refresh prices and retry. Infeasibility is not proven across those cards.")
    return result


def plan(body, catalog, progress=None, *, refresh_prices=False):
    validate_scope(body, catalog)
    policy = dict(body.solverPolicy)
    normalize_policy(policy)  # Validate before database work or silent filtering.
    refresh = None
    # Supplied live quotes do not depend on the public catalog price snapshot.
    catalog_concepts = policy.get("allowConcept", False) and getattr(body, "liveMarket", None) is None
    needs_catalog_prices = catalog_concepts or any(
        not flag(player.get("concept")) and (owned_price_stale(player) or not any(
            positive_price(player.get(key)) for key in ("marketPrice", "futggPrice", "futBinPrice", "price")))
        for player in body.clubPlayers)
    if refresh_prices and needs_catalog_prices:
        if progress:
            progress({"stage": "prices", "message": "Checking current public market prices"})
        refresh = catalog.refresh_prices_if_stale()
    # Price refresh is separate from the user's CP-SAT search budget.
    start = time.monotonic()
    # Fallback valuation is scoped to this season; it is never a purchase quote.
    policy["ratingFallbackPrices"] = catalog.rating_fallbacks()
    owned = catalog.enrich([p for p in body.clubPlayers if not flag(p.get("concept"))])
    if not owned and not policy.get("allowConcept", False):
        raise ValueError("Load club players or enable market concepts.")
    sbc = {**body.sbcData, "gameYear": catalog.game_year, "platform": catalog.platform}
    sbc.pop("conceptCoverage", None)  # Server computes coverage itself.
    if getattr(body, "liveMarket", None) is not None:
        return price_diagnostics(plan_live(body, catalog, owned, policy, sbc, progress), refresh)
    limits = (750, 2500, 6000, 12000, 20000) if policy.get("allowConcept") else (0,)
    candidates, stages = {}, []
    best, last, best_coverage = None, None, None
    best_proof = []
    coverage = None
    for index, limit in enumerate(limits):
        if index and time.monotonic() - start >= body.maxSolveTime - .1:
            break
        if limit:
            pool = catalog.concept_candidates(sbc, policy, limit)
            coverage = dict(pool["coverage"])
            for card in pool["players"]:
                candidates[identifier(card["definitionId"])] = card
            coverage["returned"] = len(candidates)
            coverage["selection"] = "Cumulative diversified market pools"
        remaining = max(.05, body.maxSolveTime - (time.monotonic() - start))
        complete = not limit or coverage.get("complete", False)
        # Reserve time to broaden the market even after finding a small-pool squad.
        duration = remaining if complete or index == len(limits) - 1 else max(.1, remaining * .30)
        if progress:
            progress({"stage": index + 1, "ownedCandidates": len(owned),
                      "conceptCandidates": len(candidates), "elapsedSeconds": round(time.monotonic() - start, 1)})
        response = setup.runAutoSBC(sbc, owned + list(candidates.values()), duration, policy)
        current = json.loads(response.body) if isinstance(response, Response) else response
        last = current
        stages.append({"conceptCandidates": len(candidates), "status": current.get("status_key"),
                       "weightedCost": (current.get("summary") or {}).get("weightedCost"),
                       "elapsedSeconds": round(time.monotonic() - start, 2)})
        if current.get("status_code") in (2, 4) and current.get("solution"):
            def score(value):
                summary = value.get("summary") or {}
                return (summary.get("weightedCost", float("inf")), -(summary.get("chemistry") or 0))
            if best is None or score(current) <= score(best):
                best, best_coverage = current, dict(coverage) if coverage else None
                best_proof = [deepcopy(candidates[identifier(p["definitionId"])]) for p in current["solution"]
                              if flag(p.get("concept")) and identifier(p["definitionId"]) in candidates]
        if complete or str(current.get("status_key", "")).startswith(("UNSUPPORTED", "INVALID", "MODEL_INVALID")):
            break
    result = best or last
    if result is None:
        raise ValueError("No player pool could be prepared in the allotted time.")
    diagnostics = result.setdefault("diagnostics", {})
    diagnostics["searchStages"] = stages
    diagnostics["elapsedSeconds"] = round(time.monotonic() - start, 2)
    diagnostics["optimalityScope"] = "Eligible club cards and supported market cards in the evaluated pool."
    warnings = diagnostics.setdefault("warnings", [])
    if any(flag(p.get("concept")) for p in body.clubPlayers):
        warnings.append("Imported concept prices were excluded. Current candidates came from the selected season’s catalog.")
    if coverage is not None:
        diagnostics["conceptCoverage"] = best_coverage if best else coverage
        diagnostics["largestConceptPool"] = coverage
        chosen_coverage = best_coverage if best else coverage
        excluded = chosen_coverage.get("excludedCounts", {})
        metadata_missing = any(excluded.get(key, 0) for key in ("unknownRarityGroups", "unsupportedChemistryProfile"))
        incomplete = not chosen_coverage.get("complete", False) or not chosen_coverage.get("catalogComplete", True)
        if incomplete or metadata_missing:
            warnings.append("Concept search covers the evaluated player pool. The lowest price across the entire market is not proven.")
            if result.get("status_code") == 4:
                result.update(status_code=2, status_key="FEASIBLE_POOL", status="Feasible squad in the evaluated market pool")
            elif result.get("status_code") == 3:
                result.update(status_code=0, status_key="POOL_INCOMPLETE", status="No squad found in the evaluated market pool; increase solve time or adjust filters")
        if metadata_missing:
            warnings.append("Some market cards were excluded because required chemistry or rarity-group information is missing.")
            if not best and result.get("status_key") in ("INFEASIBLE", "POOL_INCOMPLETE"):
                result.update(status_code=0, status_key="UNKNOWN_METADATA", status="Some market cards lack required chemistry or rarity-group metadata; infeasibility is not proven")
    database = catalog.status()
    if policy.get("allowConcept") and not database.get("readyForConcepts", database.get("pricedCount", 0) > 0):
        warnings.append(f"FC {catalog.game_year} / {catalog.platform}: no usable current market prices. No purchase recommendations were made.")
        if not best:
            result.update(status_code=0, status_key="MARKET_UNAVAILABLE", status="Selected season/platform has no usable market quotes; refresh the database or solve with owned cards")
    result["conceptCandidates"] = best_proof
    result.update(database=database, gameYear=catalog.game_year, platform=catalog.platform, reviewRequired=True)
    return price_diagnostics(result, refresh)
