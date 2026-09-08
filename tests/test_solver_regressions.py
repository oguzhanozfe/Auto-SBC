"""Synthetic regressions; no EA account, remote market, or inventory mutation."""
import json
from copy import deepcopy

import pytest

from backend.setup import runAutoSBC
from backend.solver_model import squad_rating
from backend.solver_policy import prepare_players


def player(number, **changes):
    row = {
        "id": number, "assetId": number, "definitionId": number,
        "name": f"Player {number}", "rating": 80, "teamId": 10,
        "leagueId": 20, "nationId": 30, "rarityId": 1,
        "ratingTier": 3, "groups": [4], "possiblePositions": [0],
        "isUntradeable": True, "isDuplicate": False, "isStorage": False,
        "concept": False, "isFixed": False, "price": 1000,
        "marketPrice": 1000,
    }
    row.update(changes)
    return row


def requirement(key, value, scope="GREATER", count=11):
    return {"requirementKey": key, "eligibilityValues": value if isinstance(value, list) else [value], "scope": scope, "count": count}


def challenge(size=11, requirements=None, formation=None):
    return {
        "constraints": requirements or [], "formation": formation or [0] * size + [-1] * (11 - size),
        "brickIndices": list(range(size, 11)), "currentSolution": [],
    }


def solve(players, sbc=None, policy=None, time=3):
    response = runAutoSBC(sbc or challenge(), players, time, policy)
    return json.loads(response.body)


def ids(result):
    return {p["id"] for p in result["solution"]}


def test_monkey_weights_and_storage_priority_use_market_value_once():
    rows, _, _ = prepare_players([
        player(1, isDuplicate=True, price=1), player(2),
        player(3, isUntradeable=False), player(4, concept=True),
        player(5, isStorage=True),
    ], {"allowConcept": True})
    assert [p["price"] for p in rows] == [100, 700, 1000, 2000, 100]
    assert [p["marketPrice"] for p in rows] == [1000] * 5


def test_duplicate_preference_is_cost_weight_not_hard_requirement():
    result = solve([player(1), player(2, isDuplicate=True)], challenge(1))
    assert ids(result) == {2}
    disabled = solve([player(1, marketPrice=900), player(2, isDuplicate=True)], challenge(1), {"prioritizeDuplicates": False})
    assert ids(disabled) == {1}


def test_duplicates_cannot_override_any_protection():
    candidates = [player(i, isDuplicate=True) for i in range(1, 8)]
    candidates[1]["isLocked"] = True
    candidates[2]["rarityId"] = 3
    candidates[3]["isUntradeable"] = False
    candidates[4]["concept"] = True
    candidates[5]["isEvolution"] = True
    policy = {"lockedItemIds": [1], "allowTradeable": False, "lockedAssetIds": [7]}
    result = solve(candidates, challenge(1), policy)
    assert result["status_code"] == 3
    assert result["diagnostics"]["candidateCount"] == 0


def test_locked_asset_blocks_all_card_versions_but_not_similar_names():
    result = solve([player(1, name="Same", assetId=123), player(2, assetId=123), player(3, name="Same")], challenge(1), {"lockedAssetIds": ["123"]})
    assert ids(result) == {3}
    result = solve([player(1, name="Same"), player(2, name="Same")], challenge(2))
    assert ids(result) == {1, 2}


def test_one_athlete_cannot_appear_twice_with_different_names_or_versions():
    result = solve([player(1, assetId=123), player(2, assetId=123, name="Alternate")], challenge(2))
    assert result["status_code"] == 3


def test_fixed_is_a_hard_requirement_and_lock_conflict_is_infeasible():
    candidates = [player(1, isFixed=True, marketPrice=100000), player(2)]
    result = solve(candidates, challenge(1))
    assert ids(result) == {1}
    result = solve(candidates, challenge(1), {"lockedItemIds": [1]})
    assert result["status_code"] == 3
    assert result["solution"] == []


def test_missing_required_item_cannot_be_silently_ignored():
    result = solve([player(1)], challenge(1), {"requiredItemIds": [2]})
    assert result["status_code"] == 3


def test_expensive_and_unpriced_choices_are_retained_with_explanation():
    rows, _, diagnostics = prepare_players([player(1, marketPrice=200000), player(2, marketPrice=None, price=-1, rating=99)])
    assert len(rows) == 2
    assert rows[0]["marketPrice"] == 200000
    assert rows[1]["marketPrice"] == 15000000
    assert diagnostics["priceSources"]["unknownConservativeFallback"] == 1
    assert diagnostics["warnings"]


def test_objective_price_uses_same_rating_p60_before_legacy_price():
    objective = player(3, isObjective=True, marketPrice=None, price=150)
    rows, _, _ = prepare_players([player(1, marketPrice=1000), player(2, marketPrice=2000), objective])
    assert rows[2]["marketPrice"] == 1600
    assert rows[2]["priceSource"] == "candidateRatingP60"
    rows, _, _ = prepare_players([objective], {"ratingFallbackPrices": {"80": 1800}})
    assert rows[0]["marketPrice"] == 1800
    assert rows[0]["priceSource"] == "databaseRatingP60"


def test_hard_budget_uses_market_cost_even_for_duplicates():
    result = solve([player(1, isDuplicate=True)], challenge(1), {"maxTotalPrice": 999})
    assert result["status_code"] == 3
    assert solve([player(1)], challenge(1), {"maxTotalPrice": 0})["status_code"] == 4


def test_no_top_eleven_pruning_drops_unique_position_or_asset():
    candidates = [player(i, assetId=1, possiblePositions=[0], marketPrice=100) for i in range(1, 13)]
    candidates += [player(20, possiblePositions=[5], marketPrice=60000)]
    sbc = challenge(2, [requirement("ALL_PLAYERS_CHEMISTRY_POINTS", 2)], [0, 5] + [-1] * 9)
    result = solve(candidates, sbc)
    assert result["status_code"] in (2, 4)
    assert 20 in ids(result)
    assert result["summary"]["chemistry"] == 4


def test_multigroup_membership_cannot_evade_exact_zero():
    result = solve([player(1, groups=[4, 23]), player(2, groups=[4])], challenge(1, [requirement("PLAYER_RARITY_GROUP", 23, "EXACT", 0)]))
    assert ids(result) == {2}


@pytest.mark.parametrize("key,field", [("CLUB_ID", "teamId"), ("LEAGUE_ID", "leagueId"), ("NATION_ID", "nationId"), ("PLAYER_RARITY", "rarityId"), ("PLAYER_EXACT_OVR", "rating")])
@pytest.mark.parametrize("scope", ["EXACT", "LOWER"])

def test_match_constraints_honor_maximum_and_exact_zero(key, field, scope):
    target = 80 if field == "rating" else 1
    rows = [player(1, **{field: target}), player(2, **{field: target + 1})]
    result = solve(rows, challenge(1, [requirement(key, target, scope, 0)]), {"protectSpecial": False})
    assert ids(result) == {2}


def test_minimum_quality_allows_higher_tier_and_partial_count():
    rows = [player(1, rating=70), player(2, rating=80), player(3, rating=60)]
    result = solve(rows, challenge(2, [requirement("PLAYER_QUALITY", 2, "GREATER", 2)]))
    assert ids(result) == {1, 2}


def test_standard_chemistry_is_reported_and_positions_are_verified():
    rows = [player(i, possiblePositions=[i - 1]) for i in range(1, 12)]
    sbc = challenge(requirements=[requirement("CHEMISTRY_POINTS", 33)], formation=list(range(11)))
    result = solve(rows, sbc)
    assert result["status_code"] == 4
    assert result["summary"]["chemistry"] == 33
    assert all(p["Chemistry"] == 3 and p["Is_Pos"] == 1 for p in result["solution"])
    assert result["diagnostics"]["verified"] is True
    assert {p["squadPosition"] for p in result["solution"]} == set(range(11))


def test_out_of_position_does_not_generate_or_receive_chemistry():
    rows = [player(1, possiblePositions=[0]), player(2, possiblePositions=[99])]
    sbc = challenge(2, [requirement("CHEMISTRY_POINTS", 1)])
    result = solve(rows, sbc)
    assert result["status_code"] == 3


def test_alternative_positions_choose_a_real_available_slot():
    rows = [player(1, possiblePositions=[0, 5]), player(2, possiblePositions=[0])]
    sbc = challenge(2, [requirement("CHEMISTRY_POINTS", 4)], [0, 5] + [-1] * 9)
    result = solve(rows, sbc)
    assert result["status_code"] == 4
    assert next(p for p in result["solution"] if p["id"] == 1)["squadPosition"] == 1


def test_chemistry_exact_and_upper_bound_are_enforced():
    rows = [player(1, possiblePositions=[0]), player(2, possiblePositions=[0])]
    for scope in ("LOWER", "EXACT"):
        result = solve(rows, challenge(2, [requirement("CHEMISTRY_POINTS", 3, scope)]))
        assert result["status_code"] == 3  # Two same club/nation yield 2 each.


def test_normalized_mens_womens_club_link_is_used_only_for_chemistry():
    rows = [player(1, teamId=116326, normalizeClubId=243, nationId=1, leagueId=1), player(2, teamId=243, nationId=2, leagueId=2)]
    result = solve(rows, challenge(2, [requirement("CHEMISTRY_POINTS", 2), requirement("CLUB_COUNT", 2, "EXACT")]))
    assert result["status_code"] == 4
    assert result["summary"]["chemistry"] == 2


def test_unsupported_boosted_chemistry_is_unknown_not_false_infeasible():
    rows = [player(1, maxChem=True), player(2)]
    result = solve(rows, challenge(2, [requirement("CHEMISTRY_POINTS", 4)]))
    assert result["status_code"] == 0
    assert result["status_key"] == "UNSUPPORTED_CHEMISTRY"


def test_standard_live_profile_enum_is_supported():
    rows = [player(i, **{f"{field}Chem": {"calculationType": 1, "contribution": 1, "parameterId": j} for j, field in enumerate(("team", "league", "nation"), 1)}) for i in (1, 2)]
    assert solve(rows, challenge(2, [requirement("CHEMISTRY_POINTS", 4)]))["status_code"] == 4


def test_same_and_unique_counts_can_prove_infeasible():
    rows = [player(i) for i in range(1, 12)]
    result = solve(rows, challenge(requirements=[requirement("SAME_LEAGUE_COUNT", 3, "LOWER")]))
    assert result["status_code"] == 3
    result = solve(rows, challenge(requirements=[requirement("NATION_COUNT", 2, "GREATER")]))
    assert result["status_code"] == 3


def test_unknown_requirement_fails_closed_and_preserves_legacy_shape():
    result = solve([player(1)], challenge(1, [requirement("NEW_EA_REQUIREMENT", 1)]))
    assert result["status_code"] == 0
    assert result["status_key"] == "UNSUPPORTED_CONSTRAINT"
    assert json.loads(result["results"]) == []


def test_unknown_rarity_groups_are_not_treated_as_empty_for_exact_zero():
    unknown = player("concept:1", concept=True)
    unknown.pop("groups")
    result = solve([unknown], challenge(1, [requirement("PLAYER_RARITY_GROUP", 23, "EXACT", 0)]), {"allowConcept": True})
    assert result["status_code"] == 0
    assert result["status_key"] == "UNKNOWN_RARITY_GROUPS"


def test_inherited_rating_model_reference_combination_and_unsatisfiable_target():
    ratings = [84] * 2 + [83] * 3 + [82] * 6
    assert squad_rating(ratings) == 83
    rows = [player(i + 1, rating=rating) for i, rating in enumerate(ratings)]
    feasible = solve(rows, challenge(requirements=[requirement("TEAM_RATING", 83)]))
    assert feasible["status_code"] == 4
    assert feasible["summary"]["estimatedRating"] == 83
    assert feasible["diagnostics"]["ratingModel"] == "inherited-correction-v1"
    assert solve(rows, challenge(requirements=[requirement("TEAM_RATING", 84)]))["status_code"] == 3
    assert solve(rows, challenge(requirements=[requirement("TEAM_RATING", 82, "LOWER")]))["status_code"] == 3


def test_rating_with_bricks_is_explicitly_unsupported():
    result = solve([player(1)], challenge(1, [requirement("TEAM_RATING", 80)]))
    assert result["status_key"] == "UNSUPPORTED_TEAM_RATING"


def test_solver_does_not_modify_input_or_write_csv(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    rows, sbc = [player(1)], challenge(1)
    originals = deepcopy((rows, sbc))
    result = solve(rows, sbc)
    assert result["status_code"] == 4
    assert (rows, sbc) == originals
    assert not list(tmp_path.glob("*.csv"))
    assert json.loads(result["results"]) == result["solution"]


def test_unknown_cost_weight_and_duplicate_inventory_ids_are_errors():
    assert solve([player(1)], challenge(1), {"weights": {"typo": 1}})["status_code"] == 1
    assert solve([player(1), player(1)], challenge(1))["status_code"] == 1


def profile(contributions=(1, 1, 1), full=False):
    return {"maxChem": full, **{f"{field}Chem": {"calculationType": 1, "contribution": contribution, "parameterId": index} for index, (field, contribution) in enumerate(zip(("team", "league", "nation"), contributions), 1)}}


def test_equal_cost_squad_uses_best_chemistry_and_real_positions():
    positions = [0, 3, 5, 5, 7, 12, 14, 14, 16, 25, 25]
    rows = [player(i + 1, possiblePositions=[position]) for i, position in enumerate(positions)]
    result = solve(rows, challenge(requirements=[requirement("CHEMISTRY_POINTS", 18)], formation=positions))
    assert result["status_code"] == 4
    assert result["summary"]["chemistry"] == 33
    assert all(row["Is_Pos"] == 1 for row in result["solution"])
    assert result["diagnostics"]["objectiveCost"] == 7700
    assert result["diagnostics"]["objectiveBound"] == 7700


def test_chemistry_secondary_objective_never_spends_an_extra_cent():
    rows = [player(1, marketPrice=1000, teamId=1, leagueId=1, nationId=1, **profile()), player(2, marketPrice=1000.02, **profile(full=True))]
    result = solve(rows, challenge(1, [requirement("CHEMISTRY_POINTS", 0)]))
    assert ids(result) == {1}
    assert result["summary"]["chemistry"] == 0


def test_supplied_local_double_league_contribution():
    rows = [player(1, teamId=1, nationId=1, **profile((1, 2, 1))), player(2, teamId=2, nationId=2, **profile())]
    result = solve(rows, challenge(2, [requirement("CHEMISTRY_POINTS", 2)]))
    assert result["status_code"] == 4
    assert [row["Chemistry"] for row in result["solution"]] == [1, 1]


def test_complete_profile_can_guarantee_full_chemistry_in_position_only():
    hero = player(1, **profile((0, 2, 1), full=True))
    assert solve([hero], challenge(1, [requirement("CHEMISTRY_POINTS", 3)]))["status_code"] == 4
    hero["possiblePositions"] = [99]
    assert solve([hero], challenge(1, [requirement("CHEMISTRY_POINTS", 1)]))["status_code"] == 3


def test_double_club_and_nation_profile_gets_two_self_links():
    radioactive = player(1, **profile((2, 2, 2)))
    result = solve([radioactive], challenge(1, [requirement("CHEMISTRY_POINTS", 2)]))
    assert result["status_code"] == 4
    assert result["summary"]["chemistry"] == 2


def test_global_type_two_profile_remains_explicitly_unsupported():
    unknown = player(1, **profile(full=True))
    unknown["leagueChem"]["calculationType"] = 2
    result = solve([unknown], challenge(1, [requirement("CHEMISTRY_POINTS", 1)]))
    assert result["status_code"] == 0
    assert result["status_key"] == "UNSUPPORTED_CHEMISTRY"


def test_identity_symmetry_never_orders_a_required_or_multiversion_athlete():
    rows = [player(1), player(2), player(3, assetId=3), player(4, assetId=3)]
    result = solve(rows, challenge(1), {"requiredItemIds": [2]})
    assert ids(result) == {2}
    assert result["diagnostics"]["interchangeableItemOrderings"] == 0


def test_stale_imported_quotes_never_enter_cost_or_candidate_percentile():
    stale = player(1, priceStale=True, marketPrice=1, futggPrice=1, futBinPrice=1, price=1)
    rows, _, _ = prepare_players([stale], {"ratingFallbackPrices": {"80": 10000}})
    assert rows[0]["marketPrice"] == 10000
    assert rows[0]["priceSource"] == "databaseRatingP60"
    unknown = player(2, marketPrice=None, price=-1)
    rows, _, _ = prepare_players([stale, player(3, marketPrice=2000), unknown])
    assert rows[0]["marketPrice"] == 2000
    assert rows[2]["marketPrice"] == 2000
    assert rows[2]["priceSource"] == "candidateRatingP60"
