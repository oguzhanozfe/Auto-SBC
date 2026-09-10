import csv
from datetime import datetime, timezone, timedelta
import io
import json

import pytest

from backend.catalog import BANDS, Catalog, decode_prices, normalize_player


class Response:
    def __init__(self, payload=None, status=200):
        self.payload, self.status_code = payload, status
    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(str(self.status_code))
    def json(self):
        return self.payload


class PublicSession:
    def __init__(self, pages=None, denied=False, broken_prices=False):
        self.calls = []
        self.pages = pages or {}
        self.denied = denied
        self.broken_prices = broken_prices
    def get(self, url, **kwargs):
        self.calls.append((url, kwargs.get('params')))
        if self.denied:
            return Response(status=429)
        if url.endswith('manifest.json'):
            return Response({'_version': 1, 'player-prices-index': 'a1', 'player-prices-ps5-dyn': 'b1',
                             '_published_at': {'player-prices-ps5-dyn': datetime.now(timezone.utc).timestamp()}})
        if 'player-prices-index' in url:
            return Response({'v': 2, 'id0': 10, 'd': [10, 10, 10]})
        if 'player-prices-ps5-dyn' in url:
            return Response({'v': 2, 'p': [500] if self.broken_prices else [500, 0, 2000, 3000], 's': [0, 0, 1, 2]})
        params = kwargs['params']
        return Response(self.pages.get((params['overall__gte'], params['page']), {'data': [], 'total': 0, 'next': None}))


def player(identifier=10, rating=83, name='Player'):
    return {'eaId': identifier, 'overall': rating, 'basePlayerEaId': 99, 'firstName': name,
            'lastName': 'Example', 'position': 0, 'alternativePositionIds': [5], 'game': '26',
            'clubEaId': 11, 'leagueEaId': 13, 'nationEaId': 38, 'uniqueClubEaId': 111,
            'rarityEaId': 1, 'rarity': {'name': 'Rare', 'isSpecial': False}}


def test_delta_prices_never_turn_sbc_objective_or_unknown_into_market_prices():
    rows = decode_prices({'v': 2, 'id0': 10, 'd': [2, 3, 1, 1]},
                         {'v': 2, 'p': [500, 0, 1000, 2000, 3000], 's': [0, 0, 1, 2, 3]})
    assert [row[0] for row in rows] == [10, 12, 15, 16, 17]
    assert [row[1] for row in rows] == [500, None, None, None, None]
    assert rows[2][2] == 1000
    with pytest.raises(ValueError, match='mismatch'):
        decode_prices({'v': 2, 'id0': 10, 'd': [1]}, {'v': 2, 'p': [20], 's': [0]})


def test_positions_use_source_numbers_and_public_cards_are_never_owned():
    card = normalize_player(player())
    assert card['possiblePositions'] == [0, 5]
    assert card['preferredPosition'] == 0
    assert card['position'] == 'GK'
    assert card['id'] == 'concept:10' and card['concept'] is True
    assert card['teamId'] == 111 and card['normalizeClubId'] == 11
    assert 'isUntradeable' not in card and 'groups' not in card
    raw = player(); raw['position'] = 'ST'; raw['alternativePositionIds'] = ['CM', 'UNRECOGNIZED']
    assert normalize_player(raw)['possiblePositions'] == [25, 14]


def test_sync_is_resumable_and_marks_only_finished_bands_complete(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.catalog.time.sleep', lambda seconds: None)
    session = PublicSession({(80, 1): {'data': [player()], 'total': 2, 'next': 2},
                             (80, 2): {'data': [player(20, 84, 'Second')], 'total': 2, 'next': None}})
    catalog = Catalog(tmp_path, session=session)
    first = catalog.sync(max_pages=1)
    assert first['count'] == 1 and first['complete'] is False
    assert first['priceIndexCount'] == 4 and first['marketPriceCount'] == 1
    result = catalog.sync(max_pages=7)
    assert result['count'] == result['reportedTotal'] == 2 and result['complete'] is True
    assert result['pricesPublishedAt'] != result['pricesFetchedAt']
    assert [params['page'] for url, params in session.calls if params and params['overall__gte'] == 80] == [1, 2]


def test_enrich_preserves_inventory_locks_and_uses_definition_not_asset_id(tmp_path):
    catalog = Catalog(tmp_path, session=PublicSession())
    catalog.sync(max_pages=0)
    owned = {'id': 777, 'assetId': 20, 'definitionId': 10, 'locked': True, 'isUntradeable': True, 'concept': False}
    rows = catalog.enrich([owned, {'id': 888, 'definitionId': 999}, {'id': 889, 'definitionId': 30}])
    assert rows[0]['marketPrice'] == rows[0]['futggPrice'] == 500
    assert rows[0]['id'] == 777 and rows[0]['locked'] is True and rows[0]['concept'] is False
    assert 'marketPrice' not in owned and 'marketPrice' not in rows[1]
    assert rows[2]['marketPrice'] is None


def test_stale_snapshot_remains_visible_but_is_not_a_solver_quote(tmp_path):
    catalog = Catalog(tmp_path, session=PublicSession())
    catalog.sync(max_pages=0)
    old = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with catalog._connect() as db:
        db.execute('UPDATE prices SET published_at=?', (old,))
    item = catalog.enrich([{'id': 1, 'definitionId': 10}])[0]
    assert item['catalogMarketPrice'] == 500
    assert item['marketPrice'] is None and item['futggPrice'] is None and item['priceStale'] is True
    assert item['priceUpdatedAt'] is None
    assert catalog.rating_fallbacks() == {}


def test_sync_denial_does_not_retry_or_corrupt_previous_prices(tmp_path):
    catalog = Catalog(tmp_path, session=PublicSession())
    catalog.sync(max_pages=0)
    catalog.session = PublicSession(denied=True)
    with pytest.raises(RuntimeError, match='429'):
        catalog.sync()
    assert len(catalog.session.calls) == 1
    assert catalog.status()['priceIndexCount'] == 4
    catalog.session = PublicSession(broken_prices=True)
    with pytest.raises(ValueError):
        catalog.sync()
    assert catalog.enrich([{'definitionId': 10}])[0]['marketPrice'] == 500


def test_csv_search_percentile_and_unknown_price_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.catalog.time.sleep', lambda seconds: None)
    session = PublicSession({(80, 1): {'data': [player(), player(20, 83, '100% Name')], 'total': 2, 'next': None}})
    catalog = Catalog(tmp_path, session=session)
    catalog.sync(max_pages=1)
    assert catalog.count('%') == 1 and len(catalog.search('%')) == 1
    assert catalog.rating_fallbacks() == {83: 500}
    records = list(csv.DictReader(io.StringIO(catalog.csv_text())))
    assert all(row['concept'] == 'True' for row in records)
    assert all(row['possiblePositions'] == '0|5' for row in records)
    unknown = next(row for row in records if row['definitionId'] == '20')
    assert unknown['futggPrice'] == '' and unknown['price'] == ''
    assert unknown['groups'] == '' and unknown['teamChem.calculationType'] == ''


def test_platforms_are_isolated_and_rating_cap_does_not_claim_complete(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.catalog.time.sleep', lambda seconds: None)
    catalog = Catalog(tmp_path, session=PublicSession({(80, 1): {'data': [player()], 'total': 10000, 'next': 2}}))
    catalog.sync(1)
    assert catalog.status()['complete'] is False
    assert Catalog(tmp_path, platform='pc').status()['priceIndexCount'] == 0


def test_concurrent_sync_is_rejected_without_network_requests(tmp_path):
    import fcntl
    session = PublicSession()
    catalog = Catalog(tmp_path, session=session)
    with catalog.path.with_suffix('.sync.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(RuntimeError, match='already running'):
            catalog.sync()
    assert not session.calls


def test_provider_filters_and_pagination_are_validated_before_card_writes(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.catalog.time.sleep', lambda seconds: None)
    session = PublicSession({(80, 1): {'data': [player(rating=99)], 'total': 1, 'next': None}})
    catalog = Catalog(tmp_path, session=session)
    with pytest.raises(ValueError, match='rating-band'):
        catalog.sync(1)
    assert catalog.status()['count'] == 0
    assert catalog.status()['priceIndexCount'] == 4
    session.pages = {(80, 1): {'data': [player()], 'total': 2, 'next': 1}}
    with pytest.raises(ValueError, match='pagination'):
        catalog.sync(1)
    assert catalog.status()['count'] == 0


def seed_candidates(catalog, raw_players, amounts=None, stale_ids=()):
    from backend.catalog import _now
    amounts = amounts or {}
    now = _now()
    stale = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    with catalog._connect() as db:
        for raw in raw_players:
            item = normalize_player(raw)
            item['rarityGroupsKnown'] = False
            db.execute('INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?)',
                       (item['definitionId'], item['name'], item['rating'], json.dumps(item), now))
            amount = amounts.get(item['definitionId'], 500)
            db.execute('INSERT OR REPLACE INTO prices VALUES (?, ?, ?, ?, ?, ?)',
                       (item['definitionId'], amount, amount, 0, stale if item['definitionId'] in stale_ids else now, now))


def concept_sbc(requirements=None):
    return {'formation': [0] * 11, 'brickIndices': [], 'constraints': requirements or []}


def test_concept_pool_uses_full_catalog_with_rating_diversity_and_explicit_scope(tmp_path):
    catalog = Catalog(tmp_path)
    raw = []
    for identifier in range(1, 101):
        item = player(identifier, 50 + (identifier % 45))
        item['basePlayerEaId'] = identifier
        item['position'] = 0 if identifier % 2 else 25
        item['leagueEaId'] = identifier % 8 + 1
        item['nationEaId'] = identifier % 10 + 1
        item['uniqueClubEaId'] = identifier % 13 + 1
        raw.append(item)
    seed_candidates(catalog, raw)
    result = catalog.concept_candidates(concept_sbc(), {'allowConcept': True}, limit=30)
    assert len(result['players']) == 30
    assert result['coverage']['totalEligible'] == 100 and result['coverage']['complete'] is False
    assert min(p['rating'] for p in result['players']) < 65
    assert max(p['rating'] for p in result['players']) >= 85
    assert all(p['concept'] is True and p['rarityGroupsKnown'] is False for p in result['players'])
    assert all('groups' not in p for p in result['players'])
    entire = catalog.concept_candidates(concept_sbc(), {'allowConcept': True}, limit=3000)
    assert len(entire['players']) == 100 and entire['coverage']['complete'] is True


def test_concepts_require_actual_fresh_quotes_and_respect_limits_and_locks(tmp_path):
    catalog = Catalog(tmp_path)
    raw = [player(i, 80 + i) for i in range(1, 8)]
    raw[6]['rarityEaId'] = 3
    seed_candidates(catalog, raw, amounts={2: None, 3: 50000}, stale_ids={4})
    result = catalog.concept_candidates(concept_sbc(), {'allowConcept': True, 'maxRating': 86,
                                         'maxPlayerPrice': 1000, 'lockedDefinitionIds': [5]}, 100)
    assert {p['definitionId'] for p in result['players']} == {1, 6}
    assert result['coverage']['totalEligible'] == 2
    assert result['coverage']['excludedCounts']['missingOrStaleMarketQuote'] == 2
    assert catalog.concept_candidates(concept_sbc(), {'allowConcept': False}, 100)['players'] == []
    assert catalog.concept_candidates(concept_sbc(), {'allowConcept': True, 'onlyStorage': True}, 100)['players'] == []


def test_sbc_specific_pool_preserves_required_nationality_and_unknown_groups_stay_excluded(tmp_path):
    catalog = Catalog(tmp_path)
    raw = [player(i) for i in range(1, 101)]
    for index, item in enumerate(raw):
        item['basePlayerEaId'] = item['eaId']
        item['nationEaId'] = 95 if index >= 78 else 1
    seed_candidates(catalog, raw, amounts={item['eaId']: 10000 if item['nationEaId'] == 95 else 200 for item in raw})
    request = {'requirementKey': 'NATION_ID', 'eligibilityValues': [95], 'count': 11, 'scope': 'GREATER'}
    result = catalog.concept_candidates(concept_sbc([request]), {'allowConcept': True}, 30)
    assert sum(p['nationId'] == 95 for p in result['players']) >= 11
    assert result['coverage']['complete'] is False
    request = {'requirementKey': 'PLAYER_RARITY_GROUP', 'eligibilityValues': [23], 'count': 0, 'scope': 'EXACT'}
    unknown = catalog.concept_candidates(concept_sbc([request]), {'allowConcept': True}, 30)
    assert unknown['players'] == []
    assert unknown['coverage']['excludedCounts']['unknownRarityGroups'] == 100


def test_season_and_platform_quotes_never_cross_even_when_definition_ids_match(tmp_path):
    fc26 = Catalog(tmp_path, game_year=26, platform='ps5')
    fc27 = Catalog(tmp_path, game_year=27, platform='ps5')
    pc = Catalog(tmp_path, game_year=26, platform='pc')
    seed_candidates(fc26, [player(10)], amounts={10: 500})
    next_season = player(10); next_season['game'] = '27'
    seed_candidates(fc27, [next_season], amounts={10: None})
    seed_candidates(pc, [player(10)], amounts={10: 1700})
    assert fc26.search()[0]['marketPrice'] == 500
    assert pc.search()[0]['marketPrice'] == 1700
    future = fc27.search()[0]
    assert future['marketPrice'] is None and future['quoteReady'] is False
    assert future['gameYear'] == future['priceGameYear'] == 27
    assert future['platform'] == future['pricePlatform'] == 'ps5'
    assert fc27.status()['readiness'] == 'awaiting_market_prices'
    assert fc27.status()['readyForConcepts'] is False
    assert fc27.concept_candidates(concept_sbc(), {'allowConcept': True})['players'] == []
    with pytest.raises(ValueError, match='seasons'):
        fc26.enrich([{'definitionId': 10, 'gameYear': 27}])
    with pytest.raises(ValueError, match='platforms'):
        fc26.enrich([{'definitionId': 10, 'pricePlatform': 'pc'}])
    with pytest.raises(ValueError, match='seasons'):
        fc27.enrich([{'definitionId': 10, 'priceGameYear': 26, 'marketPrice': 500}])


def test_copied_database_cannot_be_relabelled_as_another_season(tmp_path):
    import shutil
    original = Catalog(tmp_path, game_year=26)
    seed_candidates(original, [player(10)])
    with original._connect() as db:
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    shutil.copyfile(original.path, tmp_path / 'catalog-fc27-ps5.sqlite3')
    with pytest.raises(ValueError, match='scope'):
        Catalog(tmp_path, game_year=27)


def test_provider_card_season_is_required_and_verified_before_sync_writes(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.catalog.time.sleep', lambda seconds: None)
    session = PublicSession({(80, 1): {'data': [player()], 'total': 1, 'next': None}})
    catalog = Catalog(tmp_path, game_year=27, session=session)
    with pytest.raises(ValueError, match='FC26 data for an FC27'):
        catalog.sync(1)
    assert catalog.status()['count'] == 0
    raw = player(); raw.pop('game')
    with pytest.raises(ValueError, match='missing its game year'):
        normalize_player(raw, game_year=27, platform='ps5')


def test_readiness_distinguishes_unsynced_missing_market_and_stale_quotes(tmp_path):
    unsynced = Catalog(tmp_path, game_year=27)
    assert unsynced.status()['readiness'] == 'not_synced'
    raw = player(10); raw['game'] = '27'
    seed_candidates(unsynced, [raw], amounts={10: None})
    assert unsynced.status()['readiness'] == 'awaiting_market_prices'
    seed_candidates(unsynced, [raw], stale_ids={10})
    assert unsynced.status()['readiness'] == 'stale_prices'
    assert unsynced.status()['freshPricedCount'] == 0
    assert unsynced.concept_candidates(concept_sbc(), {'allowConcept': True})['players'] == []
    seed_candidates(unsynced, [raw])
    assert unsynced.status()['readiness'] == 'partial_ready'
    assert unsynced.status()['freshPricedCount'] == 1


def test_large_concept_pool_exact_definition_exclusion_retains_other_versions(tmp_path):
    catalog = Catalog(tmp_path)
    raw = [player(i, 50 + i % 45) for i in range(1, 4201)]
    for item in raw:
        item['basePlayerEaId'] = item['eaId']
    raw[1]['basePlayerEaId'] = raw[0]['basePlayerEaId']
    seed_candidates(catalog, raw)
    result = catalog.concept_candidates(concept_sbc(), {'allowConcept': True}, limit=12000, excluded_definition_ids=[1])
    ids = {p['definitionId'] for p in result['players']}
    assert len(ids) == 4199 and 1 not in ids and 2 in ids
    assert result['coverage']['complete'] is True
    assert result['coverage']['excludedOwnedDefinitionCount'] == 1
    assert result['coverage']['gameYear'] == 26 and result['coverage']['platform'] == 'ps5'
    assert all(p['gameYear'] == p['priceGameYear'] == 26 for p in result['players'])
    with pytest.raises(ValueError, match='20000'):
        catalog.concept_candidates(concept_sbc(), {'allowConcept': True}, limit=20001)


def test_future_source_404_is_unavailable_without_falling_back_to_current_season(tmp_path):
    import requests
    current = Catalog(tmp_path, game_year=26)
    seed_candidates(current, [player(10)], amounts={10: 500})
    class MissingSeason:
        def get(self, url, **kwargs):
            response = requests.Response()
            response.status_code = 404
            response.url = url
            response._content = b'Not found'
            return response
    future = Catalog(tmp_path, game_year=27, session=MissingSeason())
    with pytest.raises(requests.HTTPError):
        future.sync(1)
    status = future.status()
    assert status['readiness'] == 'unavailable'
    assert status['count'] == status['priceIndexCount'] == 0
    assert future.search() == [] and future.rating_fallbacks() == {}
    assert current.search()[0]['marketPrice'] == 500


def test_csv_preserves_explicit_season_and_platform_quote_provenance(tmp_path):
    catalog = Catalog(tmp_path, game_year=27, platform='pc')
    raw = player(10); raw['game'] = '27'
    seed_candidates(catalog, [raw])
    row = next(csv.DictReader(io.StringIO(catalog.csv_text())))
    assert row['gameYear'] == row['priceGameYear'] == '27'
    assert row['platform'] == row['pricePlatform'] == 'pc'
    assert row['priceSnapshotAt'] and row['priceFetchedAt']


@pytest.mark.parametrize('field,policy_field,target', [
    ('nationEaId', 'lockedNationIds', 38), ('uniqueClubEaId', 'lockedTeamIds', 111),
    ('leagueEaId', 'lockedLeagueIds', 13), ('rarityEaId', 'lockedRarityIds', 1),
])
def test_concept_pool_honors_paletools_category_protections(tmp_path, field, policy_field, target):
    catalog = Catalog(tmp_path)
    first, second = player(10), player(20)
    first[field] = target
    second[field] = 0 if field == 'rarityEaId' else target + 1
    seed_candidates(catalog, [first, second])
    result = catalog.concept_candidates(concept_sbc(), {'allowConcept': True, policy_field: [str(target)]}, 100)
    assert [item['definitionId'] for item in result['players']] == [20]
    assert result['coverage']['excludedCounts']['lockedCategory'] == 1


def test_provider_zero_total_with_returned_cards_is_disclosed_not_hidden(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.catalog.time.sleep', lambda seconds: None)
    catalog = Catalog(tmp_path, session=PublicSession({(80, 1): {'data': [player(10)], 'total': 0, 'next': None}}))
    status = catalog.sync(7)
    assert status['complete'] is True
    assert status['count'] == status['observedTotal'] == 1
    assert status['reportedTotal'] == 0
    assert status['sourceTotalsConsistent'] is False
    assert len(status['sourceCountWarnings']) == 1
