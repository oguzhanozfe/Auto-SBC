"""Compatibility entry point for the Auto-SBC MIT optimizer.

The original optimizer's name-based grouping and rarity/position explosion
could change the feasible set. The current model retains physical items and
validates each solution; original project attribution is retained in LICENSE.
"""

from .solver_model import STATUS_TEXT, normalize_sbc, solve_rows
from .solver_policy import normalize_policy

status_dict = STATUS_TEXT


def solve(rows, sbc, maxSolveTime, policy, diagnostics):
    return solve_rows(rows, sbc, policy, maxSolveTime, diagnostics)


def SBC(df, sbc, maxSolveTime, policy=None, diagnostics=None):
    """Preserve the legacy (selected dataframe indexes, status, code) API."""
    policy = policy or df.attrs.get("solverPolicy") or normalize_policy()
    diagnostics = diagnostics if diagnostics is not None else {"warnings": []}
    rows = df.to_dict(orient="records")
    result, message, code = solve_rows(rows, normalize_sbc(sbc), policy, maxSolveTime, diagnostics)
    original_to_index = {row.get("Original_Idx", index): index for index, row in enumerate(rows)}
    indexes = []
    for row in result:
        index = original_to_index[row["Original_Idx"]]
        indexes.append(index)
        for field in ("Chemistry", "Is_Pos", "squadPosition", "possiblePositions"):
            if field not in df:
                df[field] = None
            df.at[index, field] = row[field]
    return indexes, message, code
