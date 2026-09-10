from copy import deepcopy
from datetime import datetime, timezone

from backend.main import SolveRequest
from backend import planner
from test_api import payload


class MarketFixture:
    game_year, platform = 26, 'ps5'

    def __init__(self, cards, second_stage=False):
        self.cards, self.calls, self.second_stage = cards, [], second_stage

    def enrich(self, players):
        return deepcopy(players)

    def rating_fallbacks(self):
        return {}

    def concept_candidates(self, sbc, policy, limit):
        self.calls.append(limit)
        cards = self.cards[:1] if self.second_stage and len(self.calls) == 1 else self.cards
        return {'players': deepcopy(cards), 'coverage': {
            'returned': len(cards), 'totalEligible': len(self.cards),
            'complete': len(cards) == len(self.cards), 'platform': self.platform}}

    def status(self):
        return {'gameYear': 26, 'platform': 'ps5', 'readyForConcepts': True, 'pricedCount': len(self.cards)}


def market_card(row):
    row = deepcopy(row)
    row.update(id=f"concept:{row['definitionId']}", concept=True, isUntradeable=False,
               gameYear=26, platform='ps5', priceGameYear=26, pricePlatform='ps5',
               marketPrice=400, priceSource='FUT.GG', priceStale=False,
               priceSnapshotAt=datetime.now(timezone.utc).isoformat(),
               priceFetchedAt=datetime.now(timezone.utc).isoformat())
    return row


def test_server_completes_nine_owned_with_two_real_market_quotes():
    body = payload()
    cards = [market_card(p) for p in body['clubPlayers'][9:]]
    body['clubPlayers'] = body['clubPlayers'][:9]
    body['solverPolicy'].update(allowConcept=True, maxPurchasePrice=800)
    result = planner.plan(SolveRequest(**body), MarketFixture(cards))
    assert result['status_code'] in (2, 4), result
    assert result['summary']['ownedPlayers'] == 9
    assert result['summary']['purchaseCost'] == 800
    assert len(result['conceptCandidates']) == len(result['shoppingList']) == 2
    assert {p['definitionId'] for p in result['conceptCandidates']} == {p['definitionId'] for p in cards}
    assert result['summary']['chemistry'] == 33


def test_infeasible_small_pool_expands_and_keeps_selected_proof():
    body = payload()
    cards = [market_card(p) for p in body['clubPlayers']]
    body.update(clubPlayers=[], solverPolicy={'allowConcept': True})
    catalog = MarketFixture(cards, second_stage=True)
    result = planner.plan(SolveRequest(**body), catalog)
    assert len(catalog.calls) == 2
    assert catalog.calls == [750, 2500]
    assert result['summary']['ownedPlayers'] == 0
    assert result['summary']['conceptPlayers'] == 11
    assert result['summary']['purchaseCost'] == 4400
    assert len(result['diagnostics']['searchStages']) == 2
    assert len(result['conceptCandidates']) == 11


def test_imported_concepts_are_replaced_by_server_catalog_quotes():
    body = payload()
    cards = [market_card(p) for p in body['clubPlayers']]
    body['clubPlayers'] = deepcopy(cards)
    for row in body['clubPlayers']:
        row['marketPrice'] = 1
    body['solverPolicy'] = {'allowConcept': True}
    result = planner.plan(SolveRequest(**body), MarketFixture(cards))
    assert result['summary']['purchaseCost'] == 4400
    assert any('Imported concept' in text for text in result['diagnostics']['warnings'])


def test_partial_pool_never_claims_market_optimal_or_global_infeasible():
    body = payload()
    body['solverPolicy']['allowConcept'] = True
    catalog = MarketFixture([])
    def partial(*args):
        return {'players': [], 'coverage': {'returned': 0, 'totalEligible': 25000, 'complete': False}}
    catalog.concept_candidates = partial
    result = planner.plan(SolveRequest(**body), catalog)
    assert result['status_code'] == 2
    assert result['status_key'] == 'FEASIBLE_POOL'
    body['clubPlayers'] = body['clubPlayers'][:3]
    result = planner.plan(SolveRequest(**body), catalog)
    assert result['status_code'] == 0
    assert result['status_key'] == 'POOL_INCOMPLETE'


def test_retained_solution_keeps_its_original_quote_proof():
    body = payload()
    cards = [market_card(p) for p in body['clubPlayers'][9:]]
    body['clubPlayers'] = body['clubPlayers'][:9]
    body['solverPolicy']['allowConcept'] = True
    catalog = MarketFixture(cards)
    calls = []
    def changing(*args):
        calls.append(1)
        current = deepcopy(cards)
        for row in current:
            row['marketPrice'] = 400 if len(calls) == 1 else 900
        return {'players': current, 'coverage': {'returned': 2, 'complete': len(calls) > 1}}
    catalog.concept_candidates = changing
    result = planner.plan(SolveRequest(**body), catalog)
    assert result['summary']['purchaseCost'] == 800
    assert [p['marketPrice'] for p in result['conceptCandidates']] == [400, 400]
    assert [p['marketPrice'] for p in result['shoppingList']] == [400, 400]


def test_missing_market_metadata_cannot_prove_no_solution():
    body = payload()
    body['clubPlayers'] = body['clubPlayers'][:9]
    body['solverPolicy']['allowConcept'] = True
    catalog = MarketFixture([])
    catalog.concept_candidates = lambda *args: {'players': [], 'coverage': {
        'returned': 0, 'complete': True, 'excludedCounts': {'unknownRarityGroups': 10}}}
    result = planner.plan(SolveRequest(**body), catalog)
    assert result['status_code'] == 0
    assert result['status_key'] == 'UNKNOWN_METADATA'
