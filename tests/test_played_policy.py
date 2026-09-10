"""EA-reported match counts are a Companion policy, not raw-stat provenance."""
from datetime import datetime, timezone

import pytest

from backend.solver_policy import SolverInputError, normalize_policy, prepare_players


def player(number, **changes):
    return {
        "id": number, "assetId": number, "definitionId": number,
        "rating": 80, "teamId": 1, "leagueId": 1, "nationId": 1,
        "rarityId": 0, "possiblePositions": [14], "isUntradeable": True,
        "marketPrice": 1000, **changes,
    }


def test_played_policy_is_explicit_for_legacy_imports_and_requires_boolean():
    assert normalize_policy()["protectPlayed"] is False
    assert normalize_policy({"protectPlayed": True})["protectPlayed"] is True
    with pytest.raises(SolverInputError, match="protectPlayed must be true or false"):
        normalize_policy({"protectPlayed": "true"})
    rows, _, _ = prepare_players([player(1)])
    assert len(rows) == 1
    assert rows[0]["gamesPlayed"] is None


def test_played_gate_preserves_zero_count_and_filters_played_dupes_and_unknowns():
    malformed = [None, True, "0", -1, 0.5, float("nan"), float("inf"), 2**53, 10**1000]
    candidates = [player(1, gamesPlayed=0), player(2, gamesPlayed=505, isDuplicate=True)]
    candidates.extend(player(i + 3, gamesPlayed=value) for i, value in enumerate(malformed))
    rows, policy, diagnostics = prepare_players(candidates, {"protectPlayed": True})
    assert policy["protectPlayed"] is True
    assert [(row["id"], row["gamesPlayed"]) for row in rows] == [(1, 0)]
    assert diagnostics["filteredCounts"] == {"played": 1, "gamesPlayedUnknown": len(malformed)}


def test_ownership_match_protection_does_not_reject_verified_concepts():
    concept = player(1, concept=True, gameYear=26, platform="ps5", priceSource="Synthetic test quote",
                     priceSnapshotAt=datetime.now(timezone.utc).isoformat())
    rows, _, diagnostics = prepare_players([concept], {"protectPlayed": True, "allowConcept": True})
    assert len(rows) == 1
    assert rows[0]["concept"] is True
    assert rows[0]["gamesPlayed"] is None
    assert diagnostics["filteredCounts"] == {}
