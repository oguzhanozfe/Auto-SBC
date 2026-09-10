"""Rating bootstrap regressions using generated cards, never account payloads."""
from copy import deepcopy

import pytest

from backend import solver_model as model
from backend.solver_policy import prepare_players


def player(number, **changes):
    return {"id": number, "assetId": number, "definitionId": number,
            "name": "Generated test card", "rating": 92, "teamId": 1,
            "leagueId": 1, "nationId": 1, "rarityId": 1, "ratingTier": 3,
            "groups": [4], "possiblePositions": [0], "isUntradeable": True,
            "concept": False, "marketPrice": 1000, "gamesPlayed": 0, **changes}


def requirement(key="TEAM_RATING", target=92):
    return {"requirementKey": key, "scope": "GREATER", "eligibilityValues": [target], "count": 11}


def challenge(constraints=None):
    return model.normalize_sbc({"formation": [0] * 11, "brickIndices": [],
                                "constraints": [requirement()] if constraints is None else constraints})


def solver_trace(monkeypatch, *, full_unknown=False):
    """Solve the bootstrap normally, optionally simulate only a full timeout."""
    original = model.cp_model.CpSolver
    calls = []

    class TracedSolver:
        def __init__(self):
            self.delegate = original()
            self.unknown = False

        def __getattr__(self, key):
            return getattr(self.delegate, key)

        def Solve(self, current):
            count = sum(variable.name.startswith("player_") for variable in current.Proto().variables)
            calls.append({"candidates": count, "budget": self.parameters.max_time_in_seconds})
            self.unknown = full_unknown and count > 400
            return model.cp_model.UNKNOWN if self.unknown else self.delegate.Solve(current)

        def WallTime(self):
            return 0 if self.unknown else self.delegate.WallTime()

        def StatusName(self, status):
            return "UNKNOWN" if self.unknown else self.delegate.StatusName(status)

        def BestObjectiveBound(self):
            return 0 if self.unknown else self.delegate.BestObjectiveBound()

    monkeypatch.setattr(model.cp_model, "CpSolver", TracedSolver)
    return calls


def test_rating_pool_uses_distinct_athletes_and_retains_all_required_versions():
    candidates = [player(index, assetId=100, marketPrice=100 + index) for index in range(1, 31)]
    candidates += [player(index, marketPrice=1000 + index) for index in range(31, 51)]
    candidates += [player(60, assetId=600, definitionId=700, marketPrice=9000),
                   player(61, assetId=600, definitionId=701, marketPrice=9500),
                   player(62, assetId=601, definitionId=702, marketPrice=9900),
                   player(63, assetId=602, definitionId=703, marketPrice=10000)]
    rows, policy, _ = prepare_players(candidates, {"requiredAssetIds": [600],
                                                 "requiredDefinitionIds": [702], "requiredItemIds": [63]})
    original = deepcopy(rows)
    chosen = model.rating_warm_start_pool(rows, policy)
    assert rows == original
    ids = {row["id"] for row in chosen}
    assert ids == {1, *range(31, 41), 60, 61, 62, 63}
    assert len({row["assetId"] for row in chosen if row["id"] < 60}) == 11
    assert all(row in rows for row in chosen)


def test_full_unknown_returns_verified_rating_feasible_not_subset_optimal(monkeypatch):
    calls = solver_trace(monkeypatch, full_unknown=True)
    rows, policy, diagnostics = prepare_players([player(index) for index in range(1, 451)],
                                                {"requiredItemIds": [450], "maxTotalPrice": 11000})
    sbc = challenge()
    solution, text, code = model.solve_rows(rows, sbc, policy, 3, diagnostics)
    assert code == 2 and text.startswith("FEASIBLE:")
    assert len(solution) == 11 and 450 in {row["id"] for row in solution}
    assert all(row["Chemistry"] is None for row in solution)
    assert diagnostics["verified"] is True
    assert diagnostics["searchStatus"] == "UNKNOWN"
    assert diagnostics["warmStart"]["strategy"] == "rating-only"
    assert diagnostics["warmStart"]["foundSolution"] is True
    assert 0 < diagnostics["warmStart"]["budgetSeconds"] <= 2
    assert [call["candidates"] for call in calls] == [12, 450]
    assert 0 < calls[0]["budget"] <= 2
    model.verify_solution(solution, sbc, policy, False)


def test_full_model_can_use_card_omitted_from_infeasible_bootstrap(monkeypatch):
    calls = solver_trace(monkeypatch)
    candidates = [player(index, marketPrice=2000, isDuplicate=True) for index in range(1, 12)]
    candidates += [player(12, marketPrice=1000, isUntradeable=False)]
    candidates += [player(index, rating=50, marketPrice=1) for index in range(13, 451)]
    rows, policy, diagnostics = prepare_players(candidates, {"maxTotalPrice": 21000})
    assert 12 not in {row["id"] for row in model.rating_warm_start_pool(rows, policy)}
    sbc = challenge()
    solution, _, code = model.solve_rows(rows, sbc, policy, 5, diagnostics)
    assert diagnostics["warmStart"]["foundSolution"] is False
    assert code in (2, 4)
    assert 12 in {row["id"] for row in solution}
    assert sum(row["marketPrice"] for row in solution) <= 21000
    assert calls[-1]["candidates"] == 450
    model.verify_solution(solution, sbc, policy, False)


@pytest.mark.parametrize("constraints,budget", [([], 3), ([requirement(), requirement("PLAYER_LEVEL", 3)], 3),
                                                ([requirement()], 2.5)])
def test_rating_bootstrap_is_limited_to_large_pure_rating_workloads(monkeypatch, constraints, budget):
    calls = solver_trace(monkeypatch, full_unknown=True)
    rows, policy, diagnostics = prepare_players([player(index) for index in range(1, 451)])
    model.solve_rows(rows, challenge(constraints), policy, budget, diagnostics)
    assert "warmStart" not in diagnostics
    assert [call["candidates"] for call in calls] == [450]


def test_existing_chemistry_bootstrap_and_verified_fallback_are_preserved(monkeypatch):
    calls = solver_trace(monkeypatch, full_unknown=True)
    rows, policy, diagnostics = prepare_players([player(index) for index in range(1, 451)])
    sbc = challenge([requirement("CHEMISTRY_POINTS", 18)])
    solution, _, code = model.solve_rows(rows, sbc, policy, 3, diagnostics)
    assert code == 2 and len(solution) == 11
    assert diagnostics["warmStart"]["strategy"] == "chemistry"
    assert calls[-1]["candidates"] == 450
    model.verify_solution(solution, sbc, policy, True)
