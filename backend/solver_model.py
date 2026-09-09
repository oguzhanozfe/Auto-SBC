"""CP-SAT squad selection, exact position assignment, and result verification.

Derived from the Auto-SBC MIT project (see LICENSE). Standard chemistry tiers
are documented by EA's FIFA 23 FUT Chemistry Update and FUT Deep Dive. Boosted
profiles are explicitly excluded until their contribution rules are modeled.
"""

from collections import Counter, defaultdict
from copy import deepcopy
import math
import os
import json
import time

from ortools.sat.python import cp_model

from .logger import add_log
from .solver_policy import SolverInputError, flag, identifier, is_special


SCOPES = {"GREATER", "LOWER", "EXACT"}
MATCH_FIELDS = {
    "CLUB_ID": "teamId", "LEAGUE_ID": "leagueId", "NATION_ID": "nationId",
    "PLAYER_RARITY": "rarityId", "PLAYER_LEVEL": "ratingTier",
    "PLAYER_EXACT_OVR": "rating",
}
SAME_FIELDS = {"SAME_CLUB_COUNT": "teamId", "SAME_LEAGUE_COUNT": "leagueId", "SAME_NATION_COUNT": "nationId"}
UNIQUE_FIELDS = {"CLUB_COUNT": "teamId", "LEAGUE_COUNT": "leagueId", "NATION_COUNT": "nationId"}
CHEMISTRY_KEYS = {"CHEMISTRY_POINTS", "ALL_PLAYERS_CHEMISTRY_POINTS"}
# EA's UTSBCEligibilityDTO leaves count at -1 when a requirement has no
# PLAYER_COUNT field. Its isRequirementMet evaluates these keys against the
# eligibility value (or every open slot), never against that count sentinel.
SQUAD_WIDE_KEYS = set(SAME_FIELDS) | set(UNIQUE_FIELDS) | CHEMISTRY_KEYS | {"TEAM_RATING", "PLAYER_QUALITY"}
SUPPORTED_KEYS = set(MATCH_FIELDS) | set(SAME_FIELDS) | set(UNIQUE_FIELDS) | CHEMISTRY_KEYS | {
    "PLAYER_RARITY_GROUP", "PLAYER_MIN_OVR", "PLAYER_MAX_OVR", "PLAYER_QUALITY", "TEAM_RATING",
}
CHEMISTRY_TIERS = {"normalizeClubId": (2, 4, 7), "leagueId": (3, 5, 8), "nationId": (2, 5, 8)}
STATUS_TEXT = {
    0: "UNKNOWN: Search limit reached before a solution or proof of infeasibility.",
    1: "MODEL_INVALID: The solver could not validate the model.",
    2: "FEASIBLE: A valid squad was found; cheapest cost has not been proven.",
    3: "INFEASIBLE: No squad satisfies the requirements and protection policy in the supplied candidates.",
    4: "OPTIMAL: The cheapest squad under the supplied candidates, prices and policy was found.",
}


def normalize_sbc(sbc):
    if not isinstance(sbc, dict):
        raise SolverInputError("sbcData must be an object")
    sbc = deepcopy(sbc)
    formation = sbc.get("formation")
    if not isinstance(formation, list) or len(formation) != 11 or any(isinstance(v, bool) or not isinstance(v, int) or v < -1 for v in formation):
        raise SolverInputError("formation must contain exactly 11 integer positions (-1 for bricks)")
    bricks = sbc.get("brickIndices", [])
    if not isinstance(bricks, list) or any(isinstance(v, bool) or not isinstance(v, int) or not 0 <= v < 11 for v in bricks) or len(set(bricks)) != len(bricks):
        raise SolverInputError("brickIndices must contain distinct squad indexes from 0 to 10")
    if any(position == -1 and index not in bricks for index, position in enumerate(formation)):
        raise SolverInputError("Every -1 formation position must be listed in brickIndices")
    if len(bricks) == 11:
        raise SolverInputError("A challenge must contain at least one open squad slot")
    sbc["brickIndices"] = bricks
    constraints = sbc.get("constraints", [])
    if not isinstance(constraints, list):
        raise SolverInputError("constraints must be a list")
    for req in constraints:
        if not isinstance(req, dict):
            raise SolverInputError("Each SBC requirement must be an object")
        key = req.get("requirementKey")
        if key not in SUPPORTED_KEYS:
            raise SolverInputError(f"Unsupported SBC requirement: {key}", "UNSUPPORTED_CONSTRAINT")
        if req.get("scope") not in SCOPES:
            raise SolverInputError(f"Unsupported requirement scope for {key}: {req.get('scope')}", "UNSUPPORTED_CONSTRAINT")
        values = req.get("eligibilityValues")
        if not isinstance(values, list) or not values or any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in values):
            raise SolverInputError(f"{key} must have nonnegative integer eligibilityValues")
        if key not in MATCH_FIELDS and key != "PLAYER_RARITY_GROUP" and len(values) != 1:
            raise SolverInputError(f"{key} requires exactly one eligibility value")
        count = req.get("count", 11 - len(bricks))
        if type(count) is int and count == -1 and key in SQUAD_WIDE_KEYS:
            count = 11 - len(bricks)
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise SolverInputError(f"{key} count must be a nonnegative integer")
        req["count"] = count
        if key == "TEAM_RATING" and bricks:
            raise SolverInputError("Team-rating rules with brick slots need live EA validation and are not supported yet", "UNSUPPORTED_TEAM_RATING")
    sbc["constraints"] = constraints
    return sbc


def scoped(model, expression, scope, target, enforcement=None):
    if scope == "GREATER":
        result = model.Add(expression >= target)
    elif scope == "LOWER":
        result = model.Add(expression <= target)
    else:
        result = model.Add(expression == target)
    if enforcement is not None:
        result.OnlyEnforceIf(enforcement)
    return result


def satisfies(value, scope, target):
    return value >= target if scope == "GREATER" else value <= target if scope == "LOWER" else value == target


def matches(item, req):
    key, values = req["requirementKey"], req["eligibilityValues"]
    if key in MATCH_FIELDS:
        return item[MATCH_FIELDS[key]] in values
    if key == "PLAYER_RARITY_GROUP":
        return bool(set(item["groups"]) & set(values))
    if key == "PLAYER_MIN_OVR":
        return item["rating"] >= values[0]
    if key == "PLAYER_MAX_OVR":
        return item["rating"] <= values[0]
    if key == "PLAYER_QUALITY":
        # EA quality scopes describe the quality threshold, not a maximum
        # number of cards of that tier (e.g. Min Silver permits Gold).
        return satisfies(item["ratingTier"], req["scope"], values[0])
    raise SolverInputError(f"Unsupported player match requirement {key}")


def squad_rating(ratings):
    """Inherited SBC correction model, implemented without float rounding.

    Round sum + above-average excess to an integer, then floor after /11.
    EA does not publish this formula; the web app must validate the preview.
    """
    total = sum(ratings)
    adjusted_times_11 = total * 11 + sum(max(11 * rating - total, 0) for rating in ratings)
    return min(99, (2 * adjusted_times_11 + 11) // 242)


def add_rating(model, rows, selected):
    total = model.NewIntVar(0, 1089, "rating_total")
    model.Add(total == sum(row["rating"] * var for row, var in zip(rows, selected)))
    terms = []
    for rating in sorted({row["rating"] for row in rows}):
        count = model.NewIntVar(0, 11, f"rating_count_{rating}")
        model.Add(count == sum(selected[i] for i, row in enumerate(rows) if row["rating"] == rating))
        excess = model.NewIntVar(0, 1089, f"rating_excess_{rating}")
        model.AddMaxEquality(excess, [11 * rating - total, 0])
        contribution = model.NewIntVar(0, 11979, f"rating_excess_total_{rating}")
        model.AddMultiplicationEquality(contribution, [count, excess])
        terms.append(contribution)
    adjusted = model.NewIntVar(0, 23958, "adjusted_rating_times_11")
    model.Add(adjusted == total * 11 + sum(terms))
    rating = model.NewIntVar(0, 198, "squad_rating")
    model.AddDivisionEquality(rating, adjusted * 2 + 11, 242)
    return rating


def chemistry_profile(row):
    """Read only known same-entity additive rules (EA profile type 1).

    Complete profiles support explicit local link increments and maxChem.
    Type 2/global rules remain unsupported until their enum is verified from
    the current client. No Icon/Hero behavior is inferred from a card name.
    """
    if flag(row.get("chemistryBoost")):
        return None
    provided, contributions = 0, []
    for index, field in enumerate(("teamChem", "leagueChem", "nationChem"), 1):
        rule = row.get(field)
        if rule is None and f"{field}.calculationType" in row:
            rule = {key: row.get(f"{field}.{key}") for key in ("calculationType", "contribution", "parameterId")}
        if rule is None:
            if is_special(row) or flag(row.get("maxChem")):
                return None
            contributions.append(1)
            continue
        provided += 1
        if not isinstance(rule, dict):
            return None
        try:
            actual = tuple(float(rule[key]) for key in ("calculationType", "contribution", "parameterId"))
        except (KeyError, TypeError, ValueError):
            return None
        calculation_type, contribution, parameter = actual
        if calculation_type != 1 or parameter != index or not math.isfinite(contribution) or not contribution.is_integer() or not 0 <= contribution <= 3:
            return None
        contributions.append(int(contribution))
    if any(value != 1 for value in contributions) and provided != 3:
        return None
    return {"contributions": contributions, "fullChemistry": flag(row.get("maxChem"))}


def standard_chemistry_profile(row):
    """Compatibility predicate: whether the supplied profile can be modeled."""
    return chemistry_profile(row) is not None


def normalized_club(row):
    value = row.get("normalizeClubId")
    try:
        return int(value) if value is not None and math.isfinite(float(value)) and int(value) > 0 else row["teamId"]
    except (TypeError, ValueError, OverflowError):
        return row["teamId"]


def add_chemistry(model, rows, selected, sbc):
    slots = [(index, pos) for index, pos in enumerate(sbc["formation"]) if index not in sbc["brickIndices"]]
    capacities = Counter(position for _, position in slots)
    assignments, in_position = [], []
    for i, row in enumerate(rows):
        choices = {position: model.NewBoolVar(f"slot_{i}_{position}") for position in capacities}
        model.Add(sum(choices.values()) == selected[i])
        in_pos = model.NewBoolVar(f"in_position_{i}")
        model.Add(in_pos == sum(var for position, var in choices.items() if position in row["possiblePositions"]))
        assignments.append(choices)
        in_position.append(in_pos)
    for position, capacity in capacities.items():
        model.Add(sum(choices[position] for choices in assignments) == capacity)
    group_levels = {}
    profiles = [chemistry_profile(row) for row in rows]
    for dimension, (field, thresholds) in enumerate(CHEMISTRY_TIERS.items()):
        groups = defaultdict(list)
        for i, row in enumerate(rows):
            value = normalized_club(row) if field == "normalizeClubId" else row[field]
            contribution = profiles[i]["contributions"][dimension] if profiles[i] else 0
            groups[value].append(in_position[i] * contribution)
        for value, variables in groups.items():
            level = model.NewIntVar(0, 3, f"chem_level_{field}_{value}")
            hits = []
            for threshold in thresholds:
                hit = model.NewBoolVar(f"chem_tier_{field}_{value}_{threshold}")
                model.Add(sum(variables) >= threshold).OnlyEnforceIf(hit)
                model.Add(sum(variables) < threshold).OnlyEnforceIf(hit.Not())
                hits.append(hit)
            model.Add(level == sum(hits))
            group_levels[(field, value)] = level
    chemistry = []
    for i, row in enumerate(rows):
        raw = model.NewIntVar(0, 3, f"chem_cap_{i}")
        points = sum(group_levels[(field, normalized_club(row) if field == "normalizeClubId" else row[field])] for field in CHEMISTRY_TIERS)
        if profiles[i] and profiles[i]["fullChemistry"]:
            model.Add(raw == 3)
        else:
            model.AddMinEquality(raw, [points, 3])
        chem = model.NewIntVar(0, 3, f"chemistry_{i}")
        model.Add(chem == raw).OnlyEnforceIf(in_position[i])
        model.Add(chem == 0).OnlyEnforceIf(in_position[i].Not())
        chemistry.append(chem)
    return assignments, chemistry


def calculate_chemistry(squad, sbc):
    counts = {field: Counter() for field in CHEMISTRY_TIERS}
    for row in squad:
        position = sbc["formation"][row["squadPosition"]]
        if position in row["originalPossiblePositions"]:
            profile = chemistry_profile(row)
            for dimension, field in enumerate(CHEMISTRY_TIERS):
                value = normalized_club(row) if field == "normalizeClubId" else row[field]
                counts[field][value] += profile["contributions"][dimension]
    result = []
    for row in squad:
        position = sbc["formation"][row["squadPosition"]]
        if position not in row["originalPossiblePositions"]:
            result.append(0)
            continue
        if chemistry_profile(row)["fullChemistry"]:
            result.append(3)
            continue
        points = 0
        for field, thresholds in CHEMISTRY_TIERS.items():
            value = normalized_club(row) if field == "normalizeClubId" else row[field]
            points += sum(counts[field][value] >= threshold for threshold in thresholds)
        result.append(min(3, points))
    return result


def verify_solution(squad, sbc, policy, chemistry_mode):
    """Check physical identity, every requirement, assignment, budget and locks."""
    if len(squad) != 11 - len(sbc["brickIndices"]):
        raise RuntimeError("Solver returned the wrong squad size")
    for field in ("id", "assetId"):
        if len({identifier(row[field]) for row in squad}) != len(squad):
            raise RuntimeError(f"Solver returned repeated {field}")
    if {row["squadPosition"] for row in squad} != set(range(11)) - set(sbc["brickIndices"]):
        raise RuntimeError("Solver returned an invalid position assignment")
    for field, name in (("id", "Item"), ("assetId", "Asset"), ("definitionId", "Definition")):
        actual = {identifier(row[field]) for row in squad}
        if actual & set(policy[f"locked{name}Ids"]) or not set(policy[f"required{name}Ids"]) <= actual:
            raise RuntimeError("Solver violated a protected or required player constraint")
    for field, name in (("nationId", "Nation"), ("teamId", "Team"), ("leagueId", "League"), ("rarityId", "Rarity")):
        if {identifier(row[field]) for row in squad} & set(policy[f"locked{name}Ids"]):
            raise RuntimeError("Solver violated a protected player category")
    if policy.get("maxTotalPrice") is not None and sum(row["marketPrice"] for row in squad) > policy["maxTotalPrice"] + 0.001:
        raise RuntimeError("Solver violated the total market cost budget")
    if policy.get("maxPurchasePrice") is not None and sum(row["marketPrice"] for row in squad if row["concept"]) > policy["maxPurchasePrice"] + 0.001:
        raise RuntimeError("Solver violated the purchase coin budget")
    if any(row["concept"] and not row.get("purchaseQuoteVerified") for row in squad):
        raise RuntimeError("Solver returned a purchase without a verified market quote")
    if chemistry_mode:
        computed = calculate_chemistry(squad, sbc)
        if computed != [row["Chemistry"] for row in squad]:
            raise RuntimeError("Solver chemistry did not match independent recalculation")
    for req in sbc["constraints"]:
        key, target, scope = req["requirementKey"], req["eligibilityValues"][0], req["scope"]
        if key == "TEAM_RATING":
            actual = squad_rating([row["rating"] for row in squad])
        elif key == "CHEMISTRY_POINTS":
            actual = sum(row["Chemistry"] for row in squad)
        elif key == "ALL_PLAYERS_CHEMISTRY_POINTS":
            if not all(satisfies(row["Chemistry"], scope, target) for row in squad):
                raise RuntimeError(f"Solver violated {key}")
            continue
        elif key in SAME_FIELDS:
            actual = max(Counter(row[SAME_FIELDS[key]] for row in squad).values(), default=0)
        elif key in UNIQUE_FIELDS:
            actual = len({row[UNIQUE_FIELDS[key]] for row in squad})
        else:
            actual, target = sum(matches(row, req) for row in squad), req["count"]
            if key == "PLAYER_QUALITY":
                scope = "GREATER"
        if not satisfies(actual, scope, target):
            raise RuntimeError(f"Solver violated {key}: {actual} does not satisfy {scope} {target}")


def warm_start_pool(rows, policy):
    """A diverse, cheap feasibility pool; the final model still uses all rows."""
    ordered = sorted(range(len(rows)), key=lambda i: (rows[i]["solverCost"], rows[i]["marketPrice"], identifier(rows[i]["id"])))
    chosen = set(ordered[:44])
    by_rating_position, by_league_position = Counter(), Counter()
    common_leagues = {league for league, _ in Counter(row["leagueId"] for row in rows).most_common(5)}
    for i in ordered:
        row = rows[i]
        if any(identifier(row[field]) in policy[f"required{name}Ids"] for field, name in (("id", "Item"), ("assetId", "Asset"), ("definitionId", "Definition"))):
            chosen.add(i)
        for position in row["possiblePositions"]:
            key = row["rating"], position
            if by_rating_position[key] < 2:
                chosen.add(i)
                by_rating_position[key] += 1
            key = row["leagueId"], position
            if row["leagueId"] in common_leagues and by_league_position[key] < 2:
                chosen.add(i)
                by_league_position[key] += 1
    return [rows[i] for i in sorted(chosen)]


def solve_rows(rows, sbc, policy, max_solve_time, diagnostics, _warm_start=True):
    started = time.monotonic()
    try:
        if isinstance(max_solve_time, bool):
            raise ValueError
        max_solve_time = float(max_solve_time)
    except (ValueError, TypeError):
        raise SolverInputError("maxSolveTime must be a number") from None
    if not math.isfinite(max_solve_time) or not 0 < max_solve_time <= 600:
        raise SolverInputError("maxSolveTime must be greater than zero and at most 600 seconds")
    model = cp_model.CpModel()
    selected = [model.NewBoolVar(f"player_{i}") for i in range(len(rows))]
    model.Add(sum(selected) == 11 - len(sbc["brickIndices"]))
    for field in ("id", "assetId"):
        groups = defaultdict(list)
        for i, row in enumerate(rows):
            groups[identifier(row[field])].append(selected[i])
        for group in groups.values():
            model.Add(sum(group) <= 1)
    for field, name in (("id", "Item"), ("assetId", "Asset"), ("definitionId", "Definition")):
        for required in policy[f"required{name}Ids"]:
            model.Add(sum(selected[i] for i, row in enumerate(rows) if identifier(row[field]) == required) == 1)
    # Strictly interchangeable, single-version athletes need not be permuted
    # during search. Every feasible attribute/cost combination is preserved;
    # no physical item is dropped, and required identities are never ordered.
    asset_counts = Counter(identifier(row["assetId"]) for row in rows)
    interchangeable = defaultdict(list)
    semantic_fields = ("rating", "teamId", "leagueId", "nationId", "rarityId", "ratingTier", "solverCost", "marketPrice", "isUntradeable", "isDuplicate", "isStorage", "concept", "maxChem")
    for i, row in enumerate(rows):
        if asset_counts[identifier(row["assetId"])] != 1:
            continue
        if any(identifier(row[field]) in policy[f"required{name}Ids"] for field, name in (("id", "Item"), ("assetId", "Asset"), ("definitionId", "Definition"))):
            continue
        signature = {field: row.get(field) for field in semantic_fields}
        signature.update({"groups": sorted(row["groups"]), "possiblePositions": sorted(row["possiblePositions"]), "normalizeClubId": normalized_club(row), "rarityGroupsKnown": row.get("rarityGroupsKnown"), "profile": chemistry_profile(row)})
        interchangeable[json.dumps(signature, sort_keys=True)].append(i)
    ordering_count = 0
    for group in interchangeable.values():
        for previous, current in zip(group, group[1:]):
            model.Add(selected[previous] >= selected[current])
            ordering_count += 1
    diagnostics["interchangeableItemOrderings"] = ordering_count
    if policy.get("maxTotalPrice") is not None:
        # Ceiling each player's cents makes the budget conservative.
        costs = [math.ceil(row["marketPrice"] * 100) for row in rows]
        model.Add(sum(cost * var for cost, var in zip(costs, selected)) <= math.floor(policy["maxTotalPrice"] * 100))
    if policy.get("maxPurchasePrice") is not None:
        purchase_costs = [math.ceil(row["marketPrice"] * 100) if row["concept"] else 0 for row in rows]
        model.Add(sum(cost * var for cost, var in zip(purchase_costs, selected)) <= math.floor(policy["maxPurchasePrice"] * 100))
    chemistry_mode = any(req["requirementKey"] in CHEMISTRY_KEYS for req in sbc["constraints"])
    unsupported = []
    unknown_groups = []
    if any(req["requirementKey"] == "PLAYER_RARITY_GROUP" for req in sbc["constraints"]):
        for i, row in enumerate(rows):
            if not row.get("rarityGroupsKnown", False):
                model.Add(selected[i] == 0)
                unknown_groups.append(identifier(row["id"]))
        if unknown_groups:
            diagnostics["unknownRarityGroupItemIds"] = unknown_groups
            diagnostics["warnings"].append(f"{len(unknown_groups)} cards with unknown rarity-group membership were excluded from this rarity-group challenge.")
    assignments, chemistry = None, None
    if chemistry_mode:
        for i, row in enumerate(rows):
            if not standard_chemistry_profile(row):
                model.Add(selected[i] == 0)
                unsupported.append(identifier(row["id"]))
        if unsupported:
            diagnostics["unsupportedChemistryItemIds"] = unsupported
            diagnostics["warnings"].append(f"{len(unsupported)} cards with unrecognized or global chemistry profiles were excluded; optimality/infeasibility is not claimed across those cards.")
        diagnostics["chemistryModel"] = "ea-tiers-local-profile-v1"
        assignments, chemistry = add_chemistry(model, rows, selected, sbc)
    rating_var = None
    for req in sbc["constraints"]:
        key, scope, target = req["requirementKey"], req["scope"], req["eligibilityValues"][0]
        if key == "TEAM_RATING":
            if rating_var is None:
                rating_var = add_rating(model, rows, selected)
                diagnostics["ratingModel"] = "inherited-correction-v1"
                diagnostics["warnings"].append("Squad rating uses the inherited correction model. EA does not publish its exact rounding formula; verify the resulting preview in the web app.")
            scoped(model, rating_var, scope, target)
        elif key == "CHEMISTRY_POINTS":
            scoped(model, sum(chemistry), scope, target)
        elif key == "ALL_PLAYERS_CHEMISTRY_POINTS":
            for var, chem in zip(selected, chemistry):
                scoped(model, chem, scope, target, var)
        elif key in SAME_FIELDS or key in UNIQUE_FIELDS:
            field = SAME_FIELDS.get(key, UNIQUE_FIELDS.get(key))
            groups = defaultdict(list)
            for i, row in enumerate(rows):
                groups[row[field]].append(selected[i])
            if key in SAME_FIELDS:
                count_vars = []
                for value, variables in groups.items():
                    count = model.NewIntVar(0, 11, f"same_{key}_{value}")
                    model.Add(count == sum(variables))
                    count_vars.append(count)
                maximum = model.NewIntVar(0, 11, f"same_max_{key}")
                if count_vars:
                    model.AddMaxEquality(maximum, count_vars)
                else:
                    model.Add(maximum == 0)
                scoped(model, maximum, scope, target)
            else:
                present = []
                for value, variables in groups.items():
                    exists = model.NewBoolVar(f"unique_{key}_{value}")
                    model.Add(sum(variables) > 0).OnlyEnforceIf(exists)
                    model.Add(sum(variables) == 0).OnlyEnforceIf(exists.Not())
                    present.append(exists)
                scoped(model, sum(present), scope, target)
        else:
            expression = sum(selected[i] for i, row in enumerate(rows) if matches(row, req))
            scoped(model, expression, "GREATER" if key == "PLAYER_QUALITY" else scope, req["count"])
    cost_expression = sum(row["solverCost"] * var for row, var in zip(rows, selected))
    objective_scale = 1
    if chemistry_mode:
        # At most 33 chemistry and 11 in-position cards: the secondary term is
        # <=407, so a one-cent primary improvement always wins with scale408.
        objective_scale = 408
        in_pos_count = sum(var for i, choices in enumerate(assignments) for position, var in choices.items() if position in rows[i]["possiblePositions"])
        model.Minimize(cost_expression * objective_scale - sum(chemistry) * 12 - in_pos_count)
    else:
        model.Minimize(cost_expression)
    warm_solution = []
    if _warm_start and chemistry_mode and len(rows) > 400 and max_solve_time >= 3:
        warm_rows = warm_start_pool(rows, policy)
        if len(warm_rows) < len(rows):
            warm_diagnostics = {"warnings": []}
            warm_time = min(2.0, max_solve_time * 0.3)
            warm_solution, _, _ = solve_rows(warm_rows, sbc, policy, warm_time, warm_diagnostics, _warm_start=False)
            diagnostics["warmStart"] = {"candidateCount": len(warm_rows), "foundSolution": bool(warm_solution), "solveTimeSeconds": warm_diagnostics.get("solveTimeSeconds", 0)}
            if warm_solution:
                by_id = {identifier(row["id"]): row for row in warm_solution}
                model.Add(cost_expression <= sum(row["solverCost"] for row in warm_solution))
                for i, row in enumerate(rows):
                    warm_row = by_id.get(identifier(row["id"]))
                    model.AddHint(selected[i], int(warm_row is not None))
                    for position, var in assignments[i].items():
                        model.AddHint(var, int(warm_row is not None and warm_row["possiblePositions"] == position))
                    model.AddHint(chemistry[i], warm_row["Chemistry"] if warm_row else 0)
    validation = model.Validate()
    if validation:
        raise SolverInputError(f"Invalid solver model: {validation}", "MODEL_INVALID")
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.001, max_solve_time - (time.monotonic() - started))
    solver.parameters.num_search_workers = min(8, os.cpu_count() or 1)
    solver.parameters.random_seed = 42
    # Large clubs should spend their short time limit searching. Probing can
    # otherwise consume the whole budget before the first feasible solution.
    solver.parameters.cp_model_probing_level = 0
    add_log(f"Solving {len(rows)} candidates with {len(sbc['constraints'])} requirements")
    status = solver.Solve(model)
    diagnostics["solveTimeSeconds"] = round(solver.WallTime(), 3)
    diagnostics["searchStatus"] = solver.StatusName(status)
    if status not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
        if warm_solution and status == cp_model.UNKNOWN:
            verify_solution(warm_solution, sbc, policy, chemistry_mode)
            diagnostics["verified"] = True
            diagnostics["objectiveBound"] = max(0, math.ceil(solver.BestObjectiveBound() / objective_scale)) / 100
            diagnostics["objectiveCost"] = sum(row["solverCost"] for row in warm_solution) / 100
            return warm_solution, "FEASIBLE: A verified warm-start squad is available; the full candidate search reached its time limit.", 2
        if unsupported or unknown_groups:
            diagnostics["code"] = "UNSUPPORTED_CHEMISTRY" if unsupported else "UNKNOWN_RARITY_GROUPS"
            return [], "UNKNOWN: No solution found using verified player metadata; excluded cards need additional modeling or rarity-group data.", 0
        return [], STATUS_TEXT[int(status)], int(status)
    diagnostics["objectiveBound"] = max(0, math.ceil(solver.BestObjectiveBound() / objective_scale)) / 100
    diagnostics["objectiveCost"] = sum(row["solverCost"] for i, row in enumerate(rows) if solver.Value(selected[i])) / 100
    remaining_slots = defaultdict(list)
    for index, pos in enumerate(sbc["formation"]):
        if index not in sbc["brickIndices"]:
            remaining_slots[pos].append(index)
    squad = []
    for i, row in enumerate(rows):
        if not solver.Value(selected[i]):
            continue
        row = deepcopy(row)
        if assignments is not None:
            position = next(position for position, var in assignments[i].items() if solver.Value(var))
        else:
            position = next(pos for pos, slots in remaining_slots.items() if slots)
        row["squadPosition"] = remaining_slots[position].pop(0)
        row["originalPossiblePositions"] = row["possiblePositions"]
        row["Is_Pos"] = int(position in row["possiblePositions"])
        row["possiblePositions"] = position
        row["Chemistry"] = solver.Value(chemistry[i]) if chemistry is not None else None
        squad.append(row)
    squad.sort(key=lambda row: row["squadPosition"])
    verify_solution(squad, sbc, policy, chemistry_mode)
    diagnostics["verified"] = True
    if unsupported or unknown_groups:
        return squad, "FEASIBLE: Valid squad found among supported player metadata; other cards were excluded.", 2
    return squad, STATUS_TEXT[int(status)], int(status)
