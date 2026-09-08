"""Live observations are ephemeral purchase suggestions, never market orders."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend import live_market


def card(definition_id, rating=70, *, concept=True):
    return {'id': f'concept:{definition_id}' if concept else f'owned:{definition_id}',
            'definitionId': definition_id, 'assetId': 10000 + definition_id,
            'name': f'Silver {definition_id}', 'rating': rating,
            'teamId': 10, 'normalizeClubId': 10, 'leagueId': 20, 'nationId': 30,
            'rarityId': 1, 'groups': [4], 'possiblePositions': [0],
            'gameYear': 26, 'platform': 'ps5', 'isSpecial': False,
            'concept': concept, 'isUntradeable': not concept, 'marketPrice': 1000,
            'url': f'https://example.test/cards/{definition_id}'}


def body(ids=(1,), size=1, price=400):
    return {'gameYear': 26, 'platform': 'ps5', 'clubPlayers': [],
            'sbcData': {'formation': [0] * size + [-1] * (11-size),
                        'brickIndices': list(range(size,11)), 'constraints': []},
            'maxSolveTime': 3, 'solverPolicy': {'allowConcept': True},
            'liveMarket': {'gameYear': 26, 'platform': 'ps5',
                           'observedAt': datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
                           'quality': 'silver', 'searchMaxBuy': 1000, 'pagesRead': 1,
                           'quotes': [{'definitionId': value, 'buyNowPrice': price} for value in ids]}}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


def insert_cards(client, cards):
    catalog = client.app.state.get_catalog(26, 'ps5')
    with catalog._connect() as db:
        for row in cards:
            db.execute('INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?)',
                       (row['definitionId'], row['name'], row['rating'], json.dumps(row), datetime.now(timezone.utc).isoformat()))
    return catalog


def test_live_quotes_override_cached_market_prices_without_persisting(client):
    catalog = insert_cards(client, [card(1)])
    stamp = datetime.now(timezone.utc).isoformat()
    with catalog._connect() as db:
        db.execute('INSERT INTO prices VALUES (?, ?, ?, ?, ?, ?)', (1, 9999, 9999, 0, stamp, stamp))
    result = client.post('/solve', json=body(price=350)).json()
    assert result['status_key'] == 'FEASIBLE_LIVE_POOL', result
    assert result['summary']['purchaseCost'] == 350
    assert result['conceptCandidates'][0]['marketPrice'] == 350
    assert result['shoppingList'][0]['source'] == 'EA Transfer Market'
    assert result['shoppingList'][0]['liveQuoteExpiresAt'] == result['conceptCandidates'][0]['liveQuoteExpiresAt']
    assert result['liveMarket']['wholeMarketOptimality'] is False
    assert result['liveMarket']['pagesRead'] == 1
    with catalog._connect() as db:
        row = db.execute('SELECT market_price FROM prices WHERE definition_id=1').fetchone()
        assert row['market_price'] == 9999


def test_live_quotes_work_when_futgg_price_index_is_empty(client):
    catalog = insert_cards(client, [card(1)])
    assert catalog.status()['priceIndexCount'] == 0
    result = client.post('/solve', json=body()).json()
    assert result['status_code'] == 2, result
    assert result['summary']['purchaseCost'] == 400
    assert result['database']['readyForConcepts'] is False
    assert result['solution'][0]['id'] == 'concept:1'
    assert result['solution'][0]['concept'] is True
    assert catalog.status()['priceIndexCount'] == 0


def test_live_quotes_combine_nine_owned_and_two_purchases_with_chemistry(client):
    insert_cards(client, [card(10), card(11)])
    request = body((10,11), size=11)
    request['clubPlayers'] = [card(i, concept=False) for i in range(1,10)]
    request['solverPolicy']['maxPurchasePrice'] = 800
    request['sbcData']['constraints'] = [{'requirementKey':'CHEMISTRY_POINTS','scope':'GREATER','count':11,'eligibilityValues':[33]}]
    result = client.post('/solve', json=request).json()
    assert result['status_code'] == 2, result
    assert result['summary']['ownedPlayers'] == 9
    assert result['summary']['conceptPlayers'] == 2
    assert result['summary']['chemistry'] == 33
    assert result['summary']['purchaseCost'] == 800
    assert {p['definitionId'] for p in result['conceptCandidates']} == {10,11}


def test_unknown_definition_never_falls_back_to_an_unobserved_catalog_quote(client):
    catalog = insert_cards(client, [card(1)])
    stamp = datetime.now(timezone.utc).isoformat()
    with catalog._connect() as db:
        db.execute('INSERT INTO prices VALUES (?, ?, ?, ?, ?, ?)', (1, 150, 150, 0, stamp, stamp))
    result = client.post('/solve', json=body((999,))).json()
    assert result['status_key'] == 'LIVE_POOL_NO_SOLUTION', result
    assert result['solution'] == result['shoppingList'] == result['conceptCandidates'] == []
    assert result['liveMarket']['unknownDefinitionIds'] == [999]
    assert result['liveMarket']['excludedCounts']['unknownDefinition'] == 1


def test_duplicate_definition_observations_use_the_lowest_actual_buy_now(client):
    insert_cards(client, [card(1)])
    request = body()
    request['liveMarket']['quotes'] += [{'definitionId':1,'buyNowPrice':250}, {'definitionId':1,'buyNowPrice':900}]
    result = client.post('/solve', json=request).json()
    assert result['summary']['purchaseCost'] == 250
    assert result['liveMarket']['quotesReceived'] == 3
    assert result['liveMarket']['distinctQuotedDefinitions'] == 1


@pytest.mark.parametrize('seconds', [-121, 6])
def test_live_snapshot_rejects_expired_or_future_observations(client, seconds):
    request = body()
    request['liveMarket']['observedAt'] = (datetime.now(timezone.utc)+timedelta(seconds=seconds)).isoformat()
    assert client.post('/solve', json=request).status_code == 422


@pytest.mark.parametrize('stamp', ['not a timestamp', '2026-09-09T12:00:00', '2026-09-09T12:00:00+03:00'])
def test_live_snapshot_requires_utc_timestamp(client, stamp):
    request=body(); request['liveMarket']['observedAt']=stamp
    assert client.post('/solve', json=request).status_code == 422


@pytest.mark.parametrize('field,value', [('pagesRead',0),('pagesRead',21),('pagesRead',True),('searchMaxBuy',0),('searchMaxBuy',1000.0),('quality','platinum')])
def test_live_search_bounds_are_strict(client, field, value):
    request=body(); request['liveMarket'][field]=value
    assert client.post('/solve', json=request).status_code == 422


@pytest.mark.parametrize('field,value', [('buyNowPrice',True),('buyNowPrice',400.0),('buyNowPrice','400'),('buyNowPrice',0),('buyNowPrice',1001),('definitionId',True),('definitionId',1.5),('definitionId',-1)])
def test_live_quote_numbers_are_real_positive_integers_within_search_cap(client, field, value):
    request=body(); request['liveMarket']['quotes'][0][field]=value
    assert client.post('/solve', json=request).status_code == 422


def test_live_quote_count_and_extra_credentials_fields_are_rejected(client):
    request=body(); request['liveMarket']['quotes']*=501
    assert client.post('/solve', json=request).status_code == 422
    request=body(); request['liveMarket']['quotes'][0]['auctionId']=123
    assert client.post('/solve', json=request).status_code == 422
    request=body(); request['liveMarket']['authToken']='not-a-token'
    assert client.post('/solve', json=request).status_code == 422


def test_live_scope_and_quality_mismatches_fail_closed(client):
    insert_cards(client, [card(1, rating=80)])
    assert client.post('/solve', json=body()).status_code == 422
    request=body(); request['gameYear']=27
    assert client.post('/solve', json=request).status_code == 422
    request=body(); request['platform']='pc'
    assert client.post('/solve', json=request).status_code == 422
    request=body(); request['sbcData']['gameYear']=27
    assert client.post('/solve', json=request).status_code == 422


def test_live_scope_can_fill_top_level_scope_but_requires_concept_permission(client):
    insert_cards(client, [card(1)])
    request=body(); request.pop('gameYear'); request.pop('platform')
    result=client.post('/solve', json=request).json()
    assert result['gameYear']==26 and result['platform']=='ps5'
    assert result['status_code']==2
    request['solverPolicy']['allowConcept']=False
    assert client.post('/solve', json=request).status_code == 422


def test_live_purchase_budget_and_category_locks_remain_hard(client):
    insert_cards(client, [card(1)])
    request=body(); request['solverPolicy']['maxPurchasePrice']=399
    assert client.post('/solve', json=request).json()['status_key']=='LIVE_POOL_NO_SOLUTION'
    request=body(); request['solverPolicy']['lockedLeagueIds']=[20]
    assert client.post('/solve', json=request).json()['shoppingList']==[]


def test_live_result_is_discarded_if_observations_expire_during_solving(client, monkeypatch):
    insert_cards(client, [card(1)])
    request=body()
    observed=datetime.fromisoformat(request['liveMarket']['observedAt'].replace('Z','+00:00'))
    original=live_market.setup.runAutoSBC
    class ExpiredClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return observed+timedelta(seconds=121)
    def solve_then_expire(*args,**kwargs):
        result=original(*args,**kwargs)
        monkeypatch.setattr(live_market,'datetime',ExpiredClock)
        return result
    monkeypatch.setattr(live_market.setup,'runAutoSBC',solve_then_expire)
    result=client.post('/solve', json=request).json()
    assert result['status_key']=='LIVE_QUOTES_EXPIRED'
    assert result['shoppingList']==result['solution']==result['conceptCandidates']==[]
