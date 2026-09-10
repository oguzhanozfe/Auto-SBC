"""Normalize local club inputs and preserve the userscript /solve contract."""

import json

import pandas as pd
from fastapi.responses import JSONResponse

from . import optimize
from .logger import add_log
from .solver_model import normalize_sbc, squad_rating
from .solver_policy import SolverInputError, prepare_players


def preprocess_data(df: pd.DataFrame, sbc, solverPolicy=None):
    """Apply explicit policy only; never discard 'expensive' or unique options.

    Physical players stay one row each. The solver handles their alternative
    positions and all rarity groups, so top-N filtering cannot erase a solution.
    """
    normalize_sbc(sbc)
    rows, policy, diagnostics = prepare_players(df.to_dict(orient="records"), solverPolicy)
    result = pd.DataFrame(rows)
    result.attrs["solverPolicy"] = policy
    result.attrs["diagnostics"] = diagnostics
    return result


def runAutoSBC(sbc, players, maxSolveTime, solverPolicy=None):
    """Return a reviewable squad, never purchase, place, or submit any cards."""
    diagnostics = {"warnings": []}
    try:
        normalized_sbc = normalize_sbc(sbc)
        rows, policy, diagnostics = prepare_players(players, solverPolicy)
        add_log(f"Received {len(players)} players; {len(rows)} meet the protection policy")
        solution, status, status_code = optimize.solve(rows, normalized_sbc, maxSolveTime, policy, diagnostics)
    except SolverInputError as error:
        diagnostics["code"] = error.code
        status_code = 0 if error.code.startswith("UNSUPPORTED") else 1
        status = f"{error.code}: {error}"
        add_log(status)
        return JSONResponse(content={
            "results": "[]", "solution": [], "status": status,
            "status_code": status_code, "status_key": error.code,
            "diagnostics": diagnostics, "shoppingList": [], "summary": None,
        })
    for row in solution:
        row.pop("Original_Idx", None)
        row.pop("solverCost", None)
    add_log(status)
    summary = None
    shopping_list = []
    if solution:
        owned = [row for row in solution if not row["concept"]]
        purchases = [row for row in solution if row["concept"]]
        purchase_cost = round(sum(row["marketPrice"] for row in purchases), 2)
        shopping_list = [{
            "definitionId": row["definitionId"], "assetId": row["assetId"],
            "name": row["name"], "rating": row["rating"],
            "position": normalized_sbc["formation"][row["squadPosition"]],
            "squadPosition": row["squadPosition"], "quantity": 1,
            "marketPrice": row["marketPrice"],
            "priceSnapshotAt": row.get("priceSnapshotAt") or row.get("priceUpdatedAt"),
            "priceFetchedAt": row.get("priceFetchedAt"),
            "source": row.get("marketPriceSource"), "url": row.get("url"),
            "gameYear": row.get("gameYear", normalized_sbc.get("gameYear")),
            "platform": row.get("platform", normalized_sbc.get("platform")),
        } for row in purchases]
        summary = {
            "playerCount": len(solution),
            "ownedPlayers": len(owned),
            "estimatedRating": squad_rating([row["rating"] for row in solution]) if len(solution) == 11 else None,
            "chemistry": sum(row["Chemistry"] for row in solution) if all(row["Chemistry"] is not None for row in solution) else None,
            "marketCost": round(sum(row["marketPrice"] for row in solution), 2),
            "purchaseCost": purchase_cost,
            "purchaseCoins": purchase_cost,
            "ownedOpportunityCost": round(sum(row["marketPrice"] for row in owned), 2),
            "weightedCost": round(sum(row["price"] for row in solution), 2),
            "duplicatesUsed": sum(bool(row["isDuplicate"] or row["isStorage"]) for row in solution),
            "conceptPlayers": len(purchases),
            "requiresPurchase": any(row["concept"] for row in solution),
        }
    return JSONResponse(content={
        # Legacy clients JSON.parse(results); modern clients can use solution.
        "results": json.dumps(solution, ensure_ascii=False, allow_nan=False),
        "solution": solution, "status": status, "status_code": status_code,
        "status_key": diagnostics.get("code", {0: "UNKNOWN", 1: "MODEL_INVALID", 2: "FEASIBLE", 3: "INFEASIBLE", 4: "OPTIMAL"}[status_code]),
        "diagnostics": diagnostics, "summary": summary, "shoppingList": shopping_list,
    })


def calc_squad_rating(ratings):
    """Compatibility wrapper around the documented integer rating estimate."""
    return squad_rating(ratings)
