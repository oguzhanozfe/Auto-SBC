"""Local, explainable player protection and replacement-cost policy.

The default cost multipliers follow the public SBC Monkey user guide; this
module is an independent implementation, not extension code or a remote API.
"""

from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
import math
import os


DEFAULT_WEIGHTS = {
    "duplicateUntradeable": 0.1,
    "untradeable": 0.7,
    "tradeable": 1.0,
    "concept": 2.0,
}
DEFAULT_POLICY = {
    "allowTradeable": True,
    "allowConcept": False,
    "protectSpecial": True,
    "protectEvolutions": True,
    # Legacy uploaded inventories omit EA Bio stats. The Companion explicitly
    # sends True by default and supplies its native getter-derived count.
    "protectPlayed": False,
    "prioritizeDuplicates": True,
    "onlyStorage": False,
}
ID_LISTS = (
    "lockedItemIds", "lockedAssetIds", "lockedDefinitionIds",
    "lockedNationIds", "lockedTeamIds", "lockedLeagueIds", "lockedRarityIds",
    "requiredItemIds", "requiredAssetIds", "requiredDefinitionIds",
)


class SolverInputError(ValueError):
    def __init__(self, message, code="INVALID_INPUT"):
        super().__init__(message)
        self.code = code


def flag(value):
    """Do not interpret CSV strings such as 'False' as truthy."""
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    if isinstance(value, float) and not math.isfinite(value):
        return False
    return bool(value)


def identifier(value):
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float):
        return str(int(value)) if math.isfinite(value) and value.is_integer() else ""
    return str(value).strip()


def positive_price(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) and 0 < number <= 15_000_000 else None
    except (TypeError, ValueError):
        return None


def owned_price_stale(item):
    """Recheck dated owned valuations without inventing dates for legacy rows."""
    if flag(item.get("priceStale")):
        return True
    stamp = item.get("priceSnapshotAt") or item.get("priceUpdatedAt")
    if stamp is None:
        return False
    try:
        published = (datetime.fromtimestamp(stamp, timezone.utc) if type(stamp) in (int, float)
                     else datetime.fromisoformat(str(stamp).replace("Z", "+00:00")))
        if published.tzinfo is None:
            return True
        age = (datetime.now(timezone.utc) - published).total_seconds()
        max_age = float(os.environ.get("AUTOSBC_PRICE_MAX_AGE_HOURS", "6"))
        return not math.isfinite(max_age) or max_age <= 0 or age < -300 or age > max_age * 3600
    except (ValueError, TypeError, OverflowError, OSError):
        return True


def normalize_policy(raw=None):
    if raw is not None and not isinstance(raw, dict):
        raise SolverInputError("solverPolicy must be an object")
    raw = raw or {}
    allowed = set(DEFAULT_POLICY) | set(ID_LISTS) | {
        "weights", "ratingFallbackPrices", "maxPlayerPrice", "maxTotalPrice", "maxPurchasePrice",
        "minRating", "maxRating",
    }
    unknown = set(raw) - allowed
    if unknown:
        raise SolverInputError(f"Unknown solver policy fields: {', '.join(sorted(unknown))}")
    policy = {**DEFAULT_POLICY, **raw}
    for key in DEFAULT_POLICY:
        if not isinstance(policy[key], bool):
            raise SolverInputError(f"{key} must be true or false")
    for key in ID_LISTS:
        values = raw.get(key, [])
        if not isinstance(values, list):
            raise SolverInputError(f"{key} must be a list")
        policy[key] = sorted({identifier(v) for v in values if identifier(v)})
    weights = raw.get("weights", {})
    if not isinstance(weights, dict) or set(weights) - set(DEFAULT_WEIGHTS):
        raise SolverInputError("Unknown or invalid cost weights")
    policy["weights"] = {**DEFAULT_WEIGHTS, **weights}
    for key, value in policy["weights"].items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
            raise SolverInputError(f"Weight {key} must be between 0 and 100")
    for key in ("maxPlayerPrice", "maxTotalPrice", "maxPurchasePrice", "minRating", "maxRating"):
        value = policy.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0):
            raise SolverInputError(f"{key} must be a nonnegative number")
        if value is None or (key in ("maxPlayerPrice", "maxTotalPrice", "maxPurchasePrice") and value == 0):
            policy.pop(key, None)
    if policy.get("minRating", 0) > policy.get("maxRating", 99):
        raise SolverInputError("minRating cannot exceed maxRating")
    fallbacks = raw.get("ratingFallbackPrices", {})
    if not isinstance(fallbacks, dict):
        raise SolverInputError("ratingFallbackPrices must be an object")
    policy["ratingFallbackPrices"] = fallbacks
    return policy


def percentile60(values):
    """Linear-interpolated P60, with no dependency on a remote price source."""
    values = sorted(values)
    position = (len(values) - 1) * 0.6
    lower = math.floor(position)
    upper = math.ceil(position)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def is_special(item):
    return flag(item.get("isSpecial")) or flag(item.get("protectedSpecial")) or item.get("rarityId") not in (0, 1)


def concept_quote_issue(item):
    """A shopping suggestion needs a real, dated market quote, never fodder value.

    Recheck the snapshot age: an exported ``priceStale=False`` flag can outlive
    its quote. Fetch time alone does not make an old source snapshot current.
    The freshness window is shared with the local catalog configuration.
    """
    if flag(item.get("isObjective")) or flag(item.get("isSbc")) or flag(item.get("isExtinct")) or item.get("isMarketAvailable") is False:
        return "conceptNotMarketAvailable"
    game_year = item.get("gameYear")
    if isinstance(game_year, bool) or not isinstance(game_year, int) or not 20 <= game_year <= 99 or item.get("platform") not in {"ps5", "pc"}:
        return "conceptMissingScope"
    if flag(item.get("priceStale")):
        return "conceptStaleQuote"
    if item.get("priceSource") in {"databaseRatingP60", "candidateRatingP60", "unknownConservativeFallback"}:
        return "conceptMissingMarketQuote"
    if not any(positive_price(item.get(field)) is not None for field in ("marketPrice", "futggPrice", "futBinPrice")):
        return "conceptMissingMarketQuote"
    stamp = item.get("priceSnapshotAt") or item.get("priceUpdatedAt")
    try:
        if isinstance(stamp, (int, float)) and not isinstance(stamp, bool):
            published = datetime.fromtimestamp(stamp, timezone.utc)
        else:
            published = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        if published.tzinfo is None:
            return "conceptUnknownQuoteFreshness"
        age = (datetime.now(timezone.utc) - published).total_seconds()
        max_age_hours = float(os.environ.get("AUTOSBC_PRICE_MAX_AGE_HOURS", "6"))
        if not math.isfinite(max_age_hours) or max_age_hours <= 0:
            return "conceptUnknownQuoteFreshness"
        if age < -300 or age > max_age_hours * 3600:
            return "conceptStaleQuote"
    except (ValueError, TypeError, OverflowError, OSError):
        return "conceptUnknownQuoteFreshness"
    source = item.get("marketPriceSource") or item.get("priceSource") or item.get("catalogSource")
    if not isinstance(source, str) or not source.strip() or source in {"market", "unknown"}:
        return "conceptMissingQuoteSource"
    return None


def prepare_players(players, raw_policy=None):
    """Keep every admissible physical item; no price/group/position truncation."""
    policy = normalize_policy(raw_policy)
    if not isinstance(players, list):
        raise SolverInputError("clubPlayers must be a list")
    rows, seen = [], set()
    market_by_rating = defaultdict(list)
    required_from_flags = []
    for original_index, source in enumerate(players):
        if not isinstance(source, dict):
            raise SolverInputError(f"Player {original_index} must be an object")
        item = dict(source)
        for field in ("id", "assetId", "definitionId"):
            if not identifier(item.get(field)):
                raise SolverInputError(f"Player {original_index} is missing {field}")
        for field in ("rating", "teamId", "leagueId", "nationId", "rarityId"):
            value = item.get(field)
            try:
                numeric = int(value)
            except (ValueError, TypeError, OverflowError):
                raise SolverInputError(f"Player {original_index} has invalid {field}") from None
            if isinstance(value, bool) or float(value) != numeric or numeric < 0:
                raise SolverInputError(f"Player {original_index} has invalid {field}")
            item[field] = numeric
        if not 1 <= item["rating"] <= 99:
            raise SolverInputError(f"Player {original_index} rating must be between 1 and 99")
        item["ratingTier"] = 1 if item["rating"] < 65 else 2 if item["rating"] < 75 else 3
        for field in ("isUntradeable", "isDuplicate", "isStorage", "isFixed", "isLocked", "concept", "isObjective", "isSbc"):
            item[field] = flag(item.get(field))
        played = item.get("gamesPlayed")
        item["gamesPlayed"] = int(played) if (
            not isinstance(played, bool) and isinstance(played, (int, float))
            and 0 <= played <= 9_007_199_254_740_991 and math.isfinite(played)
            and int(played) == played
        ) else None
        key = (item["concept"], identifier(item["id"]))
        if key in seen:
            raise SolverInputError(f"Repeated inventory item id {item['id']}; send each item once")
        seen.add(key)
        for field in ("possiblePositions", "groups"):
            if field == "groups":
                item["rarityGroupsKnown"] = field in item and item.get("rarityGroupsKnown") is not False
            value = item.get(field, [])
            if not isinstance(value, (list, tuple)):
                raise SolverInputError(f"Player {original_index} {field} must be a list")
            try:
                item[field] = list(dict.fromkeys(int(v) for v in value))
            except (TypeError, ValueError, OverflowError):
                raise SolverInputError(f"Player {original_index} has invalid {field}") from None
        item["name"] = str(item.get("name", item["assetId"]))
        item["cardType"] = str(item.get("cardType", ""))
        item["Original_Idx"] = original_index
        item["marketPriceSource"] = item.get("marketPriceSource") or item.get("priceSource") or item.get("catalogSource")
        item["_conceptQuoteIssue"] = concept_quote_issue(item) if item["concept"] else None
        stale = owned_price_stale(item)
        if stale:
            item["priceStale"] = True
        raw_price = None if stale else next((p for field in ("marketPrice", "futggPrice", "futBinPrice") if (p := positive_price(item.get(field))) is not None), None)
        # The legacy price may already contain a protection multiplier or fixed=1.
        if raw_price is None and not stale and not (item["concept"] or item["isObjective"] or item["isSbc"] or item["isFixed"]):
            raw_price = positive_price(item.get("price"))
        item["_rawMarketPrice"] = raw_price
        if raw_price is not None and not item["_conceptQuoteIssue"]:
            market_by_rating[item["rating"]].append(raw_price)
        if item["isFixed"]:
            required_from_flags.append(identifier(item["id"]))
        rows.append(item)
    policy["requiredItemIds"] = sorted(set(policy["requiredItemIds"]) | set(required_from_flags))
    filtered, retained, price_sources = Counter(), [], Counter()
    price_limit_without_quote = Counter()
    for item in rows:
        item_id, asset_id, definition_id = (identifier(item[k]) for k in ("id", "assetId", "definitionId"))
        reason = None
        if item["isLocked"] or item_id in policy["lockedItemIds"]:
            reason = "lockedItem"
        elif asset_id in policy["lockedAssetIds"]:
            reason = "lockedAsset"
        elif definition_id in policy["lockedDefinitionIds"]:
            reason = "lockedDefinition"
        elif identifier(item["nationId"]) in policy["lockedNationIds"]:
            reason = "lockedNation"
        elif identifier(item["teamId"]) in policy["lockedTeamIds"]:
            reason = "lockedTeam"
        elif identifier(item["leagueId"]) in policy["lockedLeagueIds"]:
            reason = "lockedLeague"
        elif identifier(item["rarityId"]) in policy["lockedRarityIds"]:
            reason = "lockedRarity"
        elif flag(item.get("isLoan")) or (isinstance(item.get("loans"), (int, float)) and item["loans"] >= 0 and not item["concept"]):
            reason = "loan"
        elif flag(item.get("isTimeLimited")):
            reason = "timeLimited"
        elif policy["protectPlayed"] and not item["concept"] and item["gamesPlayed"] is None:
            reason = "gamesPlayedUnknown"
        elif policy["protectPlayed"] and not item["concept"] and item["gamesPlayed"] > 0:
            reason = "played"
        elif policy["protectEvolutions"] and (flag(item.get("isEvolution")) or item["rarityId"] == 60):
            reason = "evolution"
        elif item["concept"] and not policy["allowConcept"]:
            reason = "concept"
        elif item["concept"] and item["_conceptQuoteIssue"]:
            reason = item["_conceptQuoteIssue"]
        elif not item["concept"] and not item["isUntradeable"] and not policy["allowTradeable"]:
            reason = "tradeable"
        elif policy["protectSpecial"] and is_special(item):
            reason = "special"
        elif policy["onlyStorage"] and not item["isStorage"]:
            reason = "outsideStorage"
        elif item["rating"] < policy.get("minRating", 0) or item["rating"] > policy.get("maxRating", 99):
            reason = "ratingLimit"
        market_price = item.pop("_rawMarketPrice")
        quote_issue = item.pop("_conceptQuoteIssue")
        if item["concept"] and quote_issue:
            filtered[reason or quote_issue] += 1
            continue
        price_source = "market"
        if market_price is None:
            market_price = positive_price(policy["ratingFallbackPrices"].get(str(item["rating"]), policy["ratingFallbackPrices"].get(item["rating"])))
            price_source = "databaseRatingP60"
        if market_price is None and market_by_rating[item["rating"]]:
            market_price = percentile60(market_by_rating[item["rating"]])
            price_source = "candidateRatingP60"
        if market_price is None:
            market_price, price_source = 15_000_000, "unknownConservativeFallback"
        item["marketPrice"] = market_price
        item["priceSource"] = price_source
        item["purchaseQuoteVerified"] = bool(item["concept"] and not quote_issue)
        if policy.get("maxPlayerPrice") is not None and market_price > policy["maxPlayerPrice"]:
            if not reason and not item["concept"] and price_source == "unknownConservativeFallback":
                price_limit_without_quote["stale" if item.get("priceStale") else "missing"] += 1
            reason = reason or "priceLimit"
        if reason:
            filtered[reason] += 1
            continue
        category = "concept" if item["concept"] else "tradeable" if not item["isUntradeable"] else "duplicateUntradeable" if policy["prioritizeDuplicates"] and (item["isDuplicate"] or item["isStorage"]) else "untradeable"
        item["costCategory"] = category
        item["costWeight"] = policy["weights"][category]
        cents = (Decimal(str(market_price)) * Decimal(str(item["costWeight"])) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        item["solverCost"] = int(cents)
        item["price"] = int(cents) / 100
        price_sources[price_source] += 1
        retained.append(item)
    diagnostics = {
        "inputCount": len(rows), "candidateCount": len(retained),
        "filteredCounts": dict(filtered), "priceSources": dict(price_sources),
        "priceLimitWithoutQuote": {"stale": price_limit_without_quote["stale"], "missing": price_limit_without_quote["missing"]},
        "warnings": [],
    }
    if price_limit_without_quote:
        diagnostics["warnings"].append(f"{sum(price_limit_without_quote.values())} otherwise eligible owned cards lack current prices or a rating valuation and were excluded by the player value limit. Their conservative fallback is not a known market price.")
    if price_sources["unknownConservativeFallback"]:
        diagnostics["warnings"].append("Some market prices are unknown; a conservative 15,000,000 replacement value is used. This is an estimate, not a market quote.")
    if price_sources["candidateRatingP60"]:
        diagnostics["warnings"].append("Some missing prices use P60 of supplied candidates at the same rating; this is not a whole-market percentile.")
    rejected_quotes = sum(count for reason, count in filtered.items() if reason.startswith("concept") and reason != "concept")
    if rejected_quotes:
        diagnostics["warnings"].append(f"{rejected_quotes} concept cards lack a fresh, sourced purchase quote or are not market-available. They were excluded from the shopping list and solve candidates; rating estimates are never used as purchase prices.")
    return retained, policy, diagnostics
