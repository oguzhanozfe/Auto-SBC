"""Synthetic public snapshots and owned-card fixtures; no real network or club."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import fcntl

import pytest
import requests

from backend import planner
from backend.catalog import Catalog, PRICE_REFRESH_TIMEOUT
from backend.main import SolveRequest
from backend.solver_policy import prepare_players


class PriceResponse:
    status_code = 200

    def __init__(self, value):
        self.value = value

    def raise_for_status(self):
        pass

    def json(self):
        return self.value


class PriceSource:
    def __init__(self, *, year=26, platform="ps5", age_hours=0, amount=500):
        self.year, self.platform, self.age_hours, self.amount = year, platform, age_hours, amount
        self.calls, self.failure, self.broken = [], None, False

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        assert url.startswith(f"https://r2.fut.gg/{self.year}/")
        assert kwargs["params"] is None
        if self.failure:
            raise self.failure
        if url.endswith("manifest.json"):
            published = (datetime.now(timezone.utc) - timedelta(hours=self.age_hours)).timestamp()
            return PriceResponse({"_version": 2, "player-prices-index": "aa",
                                  f"player-prices-{self.platform}-dyn": "bb",
                                  "_published_at": {f"player-prices-{self.platform}-dyn": published}})
        if "player-prices-index" in url:
            return PriceResponse({"v": 2, "id0": 10, "d": []})
        assert f"player-prices-{self.platform}-dyn" in url
        return PriceResponse({"v": 2, "p": [self.amount, 1] if self.broken else [self.amount], "s": [0]})


def daily_request(**changes):
    value = {"gameYear": 26, "platform": "ps5", "maxSolveTime": 3,
             "sbcData": {"formation": [0] + [-1] * 10, "brickIndices": list(range(1, 11)),
                         "constraints": [{"requirementKey": "PLAYER_LEVEL", "scope": "EXACT", "count": 1, "eligibilityValues": [1]}]},
             "clubPlayers": [{"id": 100, "definitionId": 10, "assetId": 20, "rating": 60,
                              "teamId": 1, "leagueId": 2, "nationId": 3, "rarityId": 0,
                              "groups": [0], "possiblePositions": [25], "concept": False,
                              "isUntradeable": True, "gamesPlayed": 0}],
             "solverPolicy": {"protectPlayed": True, "maxRating": 64, "maxPlayerPrice": 1000}}
    value.update(changes)
    return SolveRequest(**value)


def stale_catalog(tmp_path):
    source = PriceSource(age_hours=7)
    catalog = Catalog(tmp_path, session=source)
    catalog.sync(0)
    source.calls.clear()
    return catalog, source


def test_overnight_daily_recovers_with_one_bulk_refresh_and_reuses_it(tmp_path):
    catalog, source = stale_catalog(tmp_path)
    body = daily_request()
    original = body.model_dump()
    offline = planner.plan(body, catalog)
    assert not source.calls
    assert offline["status_key"] == "PRICES_UNAVAILABLE"
    assert offline["diagnostics"]["priceLimitWithoutQuote"] == {"stale": 1, "missing": 0}
    assert offline["diagnostics"]["priceLimitedSolveStatus"]["status_key"] == "INFEASIBLE"
    assert "not proven" in offline["status"]

    source.age_hours = 0
    result = planner.plan(body, catalog, refresh_prices=True)
    assert result["status_code"] == 4
    assert result["solution"][0]["id"] == 100
    assert result["solution"][0]["marketPrice"] == 500
    assert result["diagnostics"]["priceRefresh"]["state"] == "refreshed"
    assert len(source.calls) == 3
    assert all(options["timeout"] == PRICE_REFRESH_TIMEOUT for _, options in source.calls)
    assert catalog.status()["count"] == 0, "price refresh must not crawl definition pages"
    assert body.model_dump() == original
    again = planner.plan(body, catalog, refresh_prices=True)
    assert again["status_code"] == 4 and again["diagnostics"]["priceRefresh"]["state"] == "fresh"
    assert len(source.calls) == 3


def test_failed_refresh_keeps_stale_snapshot_and_cooldown_survives_new_catalog_instance(tmp_path):
    catalog, source = stale_catalog(tmp_path)
    source.failure = requests.ConnectionError("Private exception text must not escape")
    result = planner.plan(daily_request(), catalog, refresh_prices=True)
    assert result["status_key"] == "PRICES_UNAVAILABLE"
    assert result["diagnostics"]["priceRefresh"]["state"] == "failed"
    assert "Private exception" not in str(result)
    assert len(source.calls) == 1
    assert catalog.enrich([{"definitionId": 10}])[0]["catalogMarketPrice"] == 500
    other_source = PriceSource()
    other = Catalog(tmp_path, session=other_source)
    blocked = planner.plan(daily_request(), other, refresh_prices=True)
    assert blocked["diagnostics"]["priceRefresh"]["state"] == "cooldown"
    assert 0 < blocked["diagnostics"]["priceRefresh"]["cooldownSeconds"] <= 300
    assert not other_source.calls


@pytest.mark.parametrize("age,amount,state,counts", [
    (7, 500, "stale", {"stale": 1, "missing": 0}),
    (0, 0, "missing", {"stale": 0, "missing": 1}),
])
def test_old_or_empty_provider_snapshot_is_never_freshened_by_download_time(tmp_path, age, amount, state, counts):
    source = PriceSource(age_hours=age, amount=amount)
    catalog = Catalog(tmp_path, session=source)
    result = planner.plan(daily_request(), catalog, refresh_prices=True)
    assert result["status_key"] == "PRICES_UNAVAILABLE"
    assert result["diagnostics"]["priceRefresh"]["state"] == state
    assert result["diagnostics"]["priceLimitWithoutQuote"] == counts
    assert result["solution"] == []
    assert len(source.calls) == 3
    assert catalog.refresh_prices_if_stale()["state"] == "cooldown"
    assert len(source.calls) == 3


def test_cooldown_allows_exactly_one_new_attempt_after_five_minutes(tmp_path, monkeypatch):
    source = PriceSource(age_hours=7)
    catalog = Catalog(tmp_path, session=source)
    clock = [1000]
    monkeypatch.setattr("backend.catalog.time.time", lambda: clock[0])
    assert catalog.refresh_prices_if_stale()["state"] == "stale"
    clock[0] = 1299.5
    assert catalog.refresh_prices_if_stale()["cooldownSeconds"] == 1
    assert len(source.calls) == 3
    source.age_hours = 0
    clock[0] = 1300
    assert catalog.refresh_prices_if_stale()["state"] == "refreshed"
    assert len(source.calls) == 6


def test_manual_sync_lock_blocks_automatic_refresh_without_network_or_waiting(tmp_path):
    catalog, source = stale_catalog(tmp_path)
    source.age_hours = 0
    with catalog.path.with_suffix(".sync.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = planner.plan(daily_request(), catalog, refresh_prices=True)
        assert result["diagnostics"]["priceRefresh"]["state"] == "busy"
        assert result["status_key"] == "PRICES_UNAVAILABLE"
        assert not source.calls
    assert catalog.refresh_prices_if_stale()["state"] == "refreshed"
    assert len(source.calls) == 3


def test_concurrent_auto_refresh_uses_the_same_lock_and_only_one_snapshot(tmp_path):
    catalog = Catalog(tmp_path, session=PriceSource())
    other_source = PriceSource()
    other = Catalog(tmp_path, session=other_source)
    original = catalog.session.get
    observed = []

    def get(url, **kwargs):
        if not observed:
            observed.append(other.refresh_prices_if_stale())
        return original(url, **kwargs)

    catalog.session.get = get
    assert catalog.refresh_prices_if_stale()["state"] == "refreshed"
    assert observed[0]["state"] == "busy"
    assert len(catalog.session.calls) == 3 and not other_source.calls


def test_malformed_bulk_snapshot_preserves_previous_prices(tmp_path):
    catalog, source = stale_catalog(tmp_path)
    source.age_hours, source.amount, source.broken = 0, 999, True
    result = catalog.refresh_prices_if_stale()
    assert result["state"] == "failed"
    with catalog._connect() as db:
        assert db.execute("SELECT market_price FROM prices WHERE definition_id=10").fetchone()[0] == 500
    assert catalog.status()["pricesStale"] is True


@pytest.mark.parametrize("document", ["manifest", "index", "prices", "publication"])
def test_malformed_public_document_fails_closed_and_preserves_prices(tmp_path, document):
    catalog, source = stale_catalog(tmp_path)
    original = source.get

    def malformed(url, **kwargs):
        response = original(url, **kwargs)
        if (document == "manifest" and url.endswith("manifest.json") or
                document == "index" and "player-prices-index" in url or
                document == "prices" and "-dyn" in url):
            return PriceResponse([])
        if document == "publication" and url.endswith("manifest.json"):
            response.value["_published_at"] = [123]
        return response

    source.get = malformed
    result = planner.plan(daily_request(), catalog, refresh_prices=True)
    assert result["status_key"] == "PRICES_UNAVAILABLE"
    assert result["diagnostics"]["priceRefresh"]["state"] == "failed"
    assert catalog.enrich([{"definitionId": 10}])[0]["catalogMarketPrice"] == 500
    assert catalog.status()["pricesStale"] is True
    assert catalog.refresh_prices_if_stale()["state"] == "cooldown"


@pytest.mark.parametrize("status", [401, 403, 429])
def test_public_denial_stops_without_retry_or_alternate_host(tmp_path, status):
    catalog, source = stale_catalog(tmp_path)
    original = source.get

    def denied(url, **kwargs):
        response = original(url, **kwargs)
        response.status_code = status
        return response

    source.get = denied
    assert catalog.refresh_prices_if_stale()["state"] == "failed"
    assert len(source.calls) == 1
    assert source.calls[0][0] == "https://r2.fut.gg/26/manifest.json"
    assert catalog.refresh_prices_if_stale()["state"] == "cooldown"
    assert len(source.calls) == 1


@pytest.mark.parametrize("year,platform", [(26, "ps5"), (26, "pc"), (27, "ps5"), (27, "pc")])
def test_public_refresh_is_scoped_and_never_sends_card_or_account_identifiers(tmp_path, year, platform):
    source = PriceSource(year=year, platform=platform)
    catalog = Catalog(tmp_path, game_year=year, platform=platform, session=source)
    result = planner.plan(daily_request(gameYear=year, platform=platform), catalog, refresh_prices=True)
    assert result["status_code"] == 4
    assert len(source.calls) == 3
    assert all(url.startswith(f"https://r2.fut.gg/{year}/") for url, _ in source.calls)
    assert any(f"player-prices-{platform}-dyn" in url for url, _ in source.calls)
    assert all(set(options) == {"params", "timeout", "headers"} and options["params"] is None for _, options in source.calls)


def test_quoted_price_limit_and_other_protections_remain_genuine_pool_infeasibility(tmp_path):
    source = PriceSource(amount=1500)
    catalog = Catalog(tmp_path, session=source)
    known_expensive = planner.plan(daily_request(), catalog, refresh_prices=True)
    assert known_expensive["status_key"] == "INFEASIBLE"
    assert known_expensive["diagnostics"]["priceLimitWithoutQuote"] == {"stale": 0, "missing": 0}
    assert "priceLimitedSolveStatus" not in known_expensive["diagnostics"]
    empty = Catalog(tmp_path / "empty", session=PriceSource())
    body = daily_request()
    body.solverPolicy["lockedItemIds"] = [100]
    locked = planner.plan(body, empty)
    assert locked["status_key"] == "INFEASIBLE"
    assert locked["diagnostics"]["filteredCounts"] == {"lockedItem": 1}


def test_partial_missing_prices_do_not_hide_an_existing_valid_solution(tmp_path):
    catalog = Catalog(tmp_path, session=PriceSource())
    body = daily_request()
    body.clubPlayers.append({**body.clubPlayers[0], "id": 101, "definitionId": 11, "assetId": 21, "rating": 61})
    result = planner.plan(body, catalog, refresh_prices=True)
    assert result["status_code"] == 4
    assert result["diagnostics"]["priceLimitWithoutQuote"] == {"stale": 0, "missing": 1}
    assert len(result["solution"]) == 1 and result["solution"][0]["id"] == 100


def test_supplied_live_concept_quotes_do_not_trigger_public_price_refresh(tmp_path):
    source = PriceSource()
    catalog = Catalog(tmp_path, session=source)
    body = daily_request(clubPlayers=[], solverPolicy={"allowConcept": True},
                         liveMarket={"gameYear": 26, "platform": "ps5",
                                     "observedAt": datetime.now(timezone.utc).isoformat(),
                                     "quality": "bronze", "searchMaxBuy": 1000,
                                     "pagesRead": 1, "quotes": []})
    result = planner.plan(body, catalog, refresh_prices=True)
    assert result["status_key"] == "LIVE_POOL_NO_SOLUTION"
    assert "priceRefresh" not in result["diagnostics"]
    assert not source.calls
    assert catalog.status()["priceIndexCount"] == 0


def test_stale_exported_price_is_replaced_as_one_fresh_catalog_quote_without_changing_ownership(tmp_path):
    catalog = Catalog(tmp_path, session=PriceSource())
    body = daily_request()
    body.clubPlayers[0].update(marketPrice=1, priceStale=False,
                              priceSnapshotAt=(datetime.now(timezone.utc) - timedelta(hours=7)).isoformat())
    original = deepcopy(body.clubPlayers)
    result = planner.plan(body, catalog, refresh_prices=True)
    card = result["solution"][0]
    assert card["marketPrice"] == 500 and card["priceStale"] is False
    assert card["id"] == 100 and card["assetId"] == 20 and card["concept"] is False
    assert body.clubPlayers == original
    retained, _, diagnostics = prepare_players(original, body.solverPolicy)
    assert retained == [] and diagnostics["priceLimitWithoutQuote"] == {"stale": 1, "missing": 0}


def test_refresh_does_not_consume_solver_search_budget(tmp_path, monkeypatch):
    catalog = Catalog(tmp_path, session=PriceSource())
    clock, budgets = [100.0], []
    refresh, solve = catalog.refresh_prices_if_stale, planner.setup.runAutoSBC

    def slow_refresh():
        clock[0] += 20
        return refresh()

    def measured(sbc, players, duration, policy):
        budgets.append(duration)
        return solve(sbc, players, duration, policy)

    monkeypatch.setattr("backend.planner.time.monotonic", lambda: clock[0])
    monkeypatch.setattr(catalog, "refresh_prices_if_stale", slow_refresh)
    monkeypatch.setattr(planner.setup, "runAutoSBC", measured)
    result = planner.plan(daily_request(), catalog, refresh_prices=True)
    assert result["status_code"] == 4 and budgets == [3]


def test_invalid_scope_and_policy_fail_before_any_refresh(tmp_path):
    source = PriceSource()
    catalog = Catalog(tmp_path, session=source)
    body = daily_request()
    body.clubPlayers[0]["gameYear"] = 27
    with pytest.raises(ValueError):
        planner.plan(body, catalog, refresh_prices=True)
    body = daily_request()
    body.solverPolicy["unsafeUnknownSetting"] = True
    with pytest.raises(ValueError):
        planner.plan(body, catalog, refresh_prices=True)
    assert not source.calls
