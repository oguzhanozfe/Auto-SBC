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
            "diagnostics": diagnostics,
        })
    for row in solution:
        row.pop("Original_Idx", None)
        row.pop("solverCost", None)
    add_log(status)
    summary = None
    if solution:
        summary = {
            "playerCount": len(solution),
            "estimatedRating": squad_rating([row["rating"] for row in solution]) if len(solution) == 11 else None,
            "chemistry": sum(row["Chemistry"] for row in solution) if all(row["Chemistry"] is not None for row in solution) else None,
            "marketCost": round(sum(row["marketPrice"] for row in solution), 2),
            "weightedCost": round(sum(row["price"] for row in solution), 2),
            "duplicatesUsed": sum(bool(row["isDuplicate"] or row["isStorage"]) for row in solution),
            "conceptPlayers": sum(row["concept"] for row in solution),
            "requiresPurchase": any(row["concept"] for row in solution),
        }
    return JSONResponse(content={
        # Legacy clients JSON.parse(results); modern clients can use solution.
        "results": json.dumps(solution, ensure_ascii=False, allow_nan=False),
        "solution": solution, "status": status, "status_code": status_code,
        "status_key": diagnostics.get("code", {0: "UNKNOWN", 1: "MODEL_INVALID", 2: "FEASIBLE", 3: "INFEASIBLE", 4: "OPTIMAL"}[status_code]),
        "diagnostics": diagnostics, "summary": summary,
    })


def calc_squad_rating(ratings):
    """Compatibility wrapper around the documented integer rating estimate."""
    return squad_rating(ratings)
