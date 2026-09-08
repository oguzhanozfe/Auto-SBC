"""Ephemeral EA transfer-search observations joined to local card definitions.

No credentials, auction IDs, purchases, network calls, or quote persistence.
These observations describe a bounded search, not the entire transfer market.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import time
from typing import Literal

from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import setup
from .solver_policy import flag, identifier


LIVE_QUOTE_SECONDS = 120


class LiveQuote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definitionId: int = Field(strict=True, gt=0, le=2_147_483_647)
    buyNowPrice: int = Field(strict=True, gt=0, le=15_000_000)


class LiveMarket(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gameYear: Literal[26, 27]
    platform: Literal["ps5", "pc"]
    observedAt: str = Field(min_length=20, max_length=40)
    quality: Literal["bronze", "silver", "gold"]
    searchMaxBuy: int = Field(strict=True, gt=0, le=15_000_000)
    pagesRead: int = Field(strict=True, ge=1, le=20)
    quotes: list[LiveQuote] = Field(max_length=500)

    def checked_snapshot(self):
        try:
            observed = datetime.fromisoformat(self.observedAt.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            raise ValueError("liveMarket.observedAt must be an ISO UTC timestamp") from None
        if observed.tzinfo is None or observed.utcoffset() != timedelta(0):
            raise ValueError("liveMarket.observedAt must include the UTC timezone")
        age = (datetime.now(timezone.utc) - observed).total_seconds()
        if age > LIVE_QUOTE_SECONDS:
            raise ValueError("Live EA market quotes expired; run the transfer search again")
        if age < -5:
            raise ValueError("Live EA market observation is in the future")
        return observed

    @model_validator(mode="after")
    def validate_observations(self):
        self.checked_snapshot()
        if any(quote.buyNowPrice > self.searchMaxBuy for quote in self.quotes):
            raise ValueError("A live buy-now quote exceeds the observed searchMaxBuy")
        return self


def live_candidates(live, catalog):
    observed = live.checked_snapshot()
    if live.gameYear != catalog.game_year or live.platform != catalog.platform:
        raise ValueError("Live market scope differs from the selected season/platform")
    prices = {}
    for quote in live.quotes:
        prices[quote.definitionId] = min(prices.get(quote.definitionId, quote.buyNowPrice), quote.buyNowPrice)
    definitions = {int(row["definitionId"]): row for row in catalog.definition_records(list(prices))}
    excluded, unknown_ids, players = Counter(), [], []
    low, high = {"bronze": (1, 64), "silver": (65, 74), "gold": (75, 99)}[live.quality]
    observed_at = observed.isoformat().replace("+00:00", "Z")
    expires_at = (observed + timedelta(seconds=LIVE_QUOTE_SECONDS)).isoformat().replace("+00:00", "Z")
    for definition_id, price in sorted(prices.items()):
        card = definitions.get(definition_id)
        if card is None:
            excluded["unknownDefinition"] += 1
            unknown_ids.append(definition_id)
            continue
        if card.get("gameYear") not in (None, live.gameYear) or card.get("platform") not in (None, live.platform):
            raise ValueError(f"Catalog definition {definition_id} has mismatched season/platform metadata")
        required = ("assetId", "rating", "teamId", "leagueId", "nationId", "rarityId")
        if any(isinstance(card.get(key), bool) or not isinstance(card.get(key), int) or card[key] < 0 for key in required) or not card.get("assetId") or not card.get("possiblePositions"):
            excluded["incompleteDefinition"] += 1
            unknown_ids.append(definition_id)
            continue
        if not low <= card["rating"] <= high:
            raise ValueError(f"Live definition {definition_id} does not match observed {live.quality} quality")
        row = deepcopy(card)
        row.update({
            "id": f"concept:{definition_id}", "concept": True,
            "isUntradeable": False, "isStorage": False, "isDuplicate": False,
            "isFixed": False, "isLocked": False,
            "isSbc": False, "isObjective": False, "isExtinct": False,
            "gameYear": live.gameYear, "platform": live.platform,
            "priceGameYear": live.gameYear, "pricePlatform": live.platform,
            "marketPrice": price, "futggPrice": None, "futBinPrice": None,
            "price": price, "marketPriceSource": "EA Transfer Market",
            "priceSource": "EA Transfer Market", "priceSnapshotAt": observed_at,
            "priceFetchedAt": observed_at, "priceUpdatedAt": observed_at,
            "liveQuoteExpiresAt": expires_at, "quoteReady": True,
            "priceStale": False, "isMarketAvailable": True,
        })
        players.append(row)
    return {"players": players, "coverage": {
        "source": "EA Transfer Market", "mode": "live-ea-observed-pool",
        "observedAt": observed_at, "liveQuoteExpiresAt": expires_at,
        "quality": live.quality, "searchMaxBuy": live.searchMaxBuy,
        "pagesRead": live.pagesRead, "quotesReceived": len(live.quotes),
        "distinctQuotedDefinitions": len(prices), "returned": len(players),
        "complete": False, "observedPoolComplete": True,
        "wholeMarketOptimality": False, "gameYear": live.gameYear,
        "platform": live.platform, "excludedCounts": dict(excluded),
        "unknownDefinitionIds": unknown_ids,
        "optimalityScope": "Only observed live buy-now quotes with known card definitions; no entire-market cheapest claim",
    }}


def plan_live(body, catalog, owned, policy, sbc, progress=None):
    start = time.monotonic()
    live = body.liveMarket
    if policy.get("allowConcept") is not True:
        raise ValueError("liveMarket requires solverPolicy.allowConcept=true")
    pool = live_candidates(live, catalog)
    coverage = pool["coverage"]
    expiry = datetime.fromisoformat(coverage["liveQuoteExpiresAt"].replace("Z", "+00:00"))
    remaining_validity = (expiry - datetime.now(timezone.utc)).total_seconds()
    if remaining_validity <= 0:
        raise ValueError("Live EA market quotes expired during definition lookup")
    duration = max(.001, min(body.maxSolveTime, remaining_validity - .01))
    if progress:
        progress({"stage": 1, "ownedCandidates": len(owned), "conceptCandidates": len(pool["players"]),
                  "mode": "live-ea-observed-pool", "elapsedSeconds": round(time.monotonic() - start, 1)})
    response = setup.runAutoSBC(sbc, owned + pool["players"], duration, policy)
    result = json.loads(response.body) if isinstance(response, Response) else response
    diagnostics = result.setdefault("diagnostics", {})
    diagnostics.update(conceptCoverage=coverage, largestConceptPool=coverage,
                       optimalityScope=coverage["optimalityScope"], elapsedSeconds=round(time.monotonic() - start, 2))
    warnings = diagnostics.setdefault("warnings", [])
    warnings.append("Canlı EA fiyatları yalnızca okunan arama sayfalarındaki ilanları kapsar; tüm piyasadaki en ucuz kadro olduğu kanıtlanmadı. Satın alma yapılmadı.")
    if coverage["unknownDefinitionIds"]:
        warnings.append(f"{len(coverage['unknownDefinitionIds'])} canlı fiyatın kart tanımı yerel katalogda eksik; fiyat veya oyuncu bilgisi tahmin edilmedi.")
    if any(flag(row.get("concept")) for row in body.clubPlayers):
        warnings.append("İçe aktarılan konseptler kullanılmadı; bu çözüm yalnızca gönderilen canlı EA ilan fiyatlarını kullanır.")
    proof = {identifier(row["definitionId"]): row for row in pool["players"]}
    selected = [row for row in result.get("solution", []) if flag(row.get("concept"))]
    result["conceptCandidates"] = [deepcopy(proof[identifier(row["definitionId"])]) for row in selected]
    for entry in result.get("shoppingList", []):
        entry["liveQuoteExpiresAt"] = coverage["liveQuoteExpiresAt"]
    if selected and datetime.now(timezone.utc) >= expiry:
        result.update(solution=[], results="[]", shoppingList=[], conceptCandidates=[], summary=None,
                      status_code=0, status_key="LIVE_QUOTES_EXPIRED", status="Live quotes expired while solving; repeat the EA transfer search")
    elif result.get("status_code") in (2, 4):
        result.update(status_code=2, status_key="FEASIBLE_LIVE_POOL", status="Feasible squad using the observed live EA quote pool; entire-market optimality is not claimed")
    elif result.get("status_code") == 3:
        result.update(status_code=0, status_key="LIVE_POOL_NO_SOLUTION", status="No squad found in the observed live EA pool; expand the transfer search or adjust filters")
    result.update(database=catalog.status(), gameYear=catalog.game_year, platform=catalog.platform,
                  reviewRequired=True, liveMarket=coverage)
    return result
