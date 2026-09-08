import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend.main import create_app


def payload():
    positions = [0, 3, 5, 5, 7, 12, 14, 14, 16, 25, 25]
    return {
        'sbcData': {'name': 'API integration fixture', 'formation': positions,
                    'brickIndices': [], 'currentSolution': [], 'constraints': [
                        {'requirementKey': 'TEAM_RATING', 'scope': 'GREATER', 'count': 11, 'eligibilityValues': [84]},
                        {'requirementKey': 'CHEMISTRY_POINTS', 'scope': 'GREATER', 'count': 11, 'eligibilityValues': [18]}]},
        'clubPlayers': [{'id': i + 1000, 'assetId': i + 2000, 'definitionId': i + 3000,
                         'name': f'Fixture {i}', 'rating': 84, 'teamId': 10,
                         'leagueId': 20, 'nationId': 30, 'rarityId': 1,
                         'ratingTier': 3, 'possiblePositions': [position],
                         'groups': [0], 'isUntradeable': True, 'concept': False,
                         'marketPrice': 1500} for i, position in enumerate(positions)],
        'maxSolveTime': 3, 'solverPolicy': {'allowTradeable': False},
    }


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


def test_real_solver_api_returns_reviewable_squad_and_no_inventory_file(client, tmp_path):
    response = client.post('/solve', json=payload())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['status_code'] in [2, 4], data
    assert len(data['solution']) == 11
    assert {row['id'] for row in data['solution']} == set(range(1000, 1011))
    assert data['summary']['chemistry'] >= 18
    assert data['summary']['estimatedRating'] >= 84
    assert data['reviewRequired'] is True
    assert json.loads(data['results']) == data['solution']
    assert not (tmp_path / 'allPlayers.csv').exists()
    assert client.get('/allPlayers.csv').status_code == 404


def test_explicit_locks_make_full_pool_infeasible(client):
    body = payload()
    body['solverPolicy']['lockedItemIds'] = [1000]
    data = client.post('/solve', json=body).json()
    assert data['solution'] == []
    assert data['status_code'] not in [2, 4]


def test_origin_host_and_input_boundaries(client):
    assert client.get('/health', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/health', headers={'Host': 'evil.example'}).status_code == 400
    for origin in ['https://www.ea.com', 'chrome-extension://' + 'a' * 32]:
        response = client.get('/health', headers={'Origin': origin})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == origin
    bad = payload()
    bad['maxSolveTime'] = 100000
    assert client.post('/solve', json=bad).status_code == 422
    bad['maxSolveTime'] = 3
    bad['clubPlayers'] = []
    assert client.post('/solve', json=bad).status_code == 422
    assert client.post('/relay', json={'url': 'http://localhost'}).status_code == 404
    assert client.post('/solve', content=b'{}', headers={'Content-Length': str(25 * 1024 * 1024)}).status_code == 413


def test_concurrent_solves_return_busy_instead_of_overlapping(client, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    def slow(*args):
        entered.set()
        assert release.wait(5)
        return JSONResponse({'solution': [], 'status': 'fixture', 'status_code': 0})
    monkeypatch.setattr('backend.main.setup.runAutoSBC', slow)
    with ThreadPoolExecutor() as pool:
        first = pool.submit(client.post, '/solve', json=payload())
        try:
            assert entered.wait(5)
            assert client.get('/health').json()['solverBusy']
            assert client.post('/solve', json=payload()).status_code == 409
            assert client.post('/clear-logs').status_code == 409
        finally:
            release.set()
        assert first.result().status_code == 200
    assert not client.get('/health').json()['solverBusy']


def test_error_releases_solver_and_catalog_failure_keeps_service(client, monkeypatch):
    def fail(*args, **kwargs):
        raise ValueError('fixture invalid input')
    monkeypatch.setattr('backend.main.setup.runAutoSBC', fail)
    assert client.post('/solve', json=payload()).status_code == 422
    assert not client.get('/health').json()['solverBusy']
    monkeypatch.setattr(client.app.state.catalog, 'sync', fail)
    assert client.post('/api/database/sync', json={'maxPages': 1}).status_code == 502
    assert not client.get('/api/database/status').json()['syncing']
    assert client.get('/health').status_code == 200


def test_dashboard_and_empty_catalog(client):
    response = client.get('/')
    assert response.status_code == 200
    assert 'frame-ancestors' in response.headers['content-security-policy']
    assert 'Her karta doğru yer' in response.text
    assert client.get('/static/app.js').status_code == 200
    assert client.get('/static/missing.js').status_code == 404
    assert client.get('/api/players?limit=1000').json()['players'] == []
    assert client.get('/api/players?limit=1001').status_code == 422


def test_async_job_returns_quickly_and_polls_result(client, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    def slow(*args):
        entered.set()
        assert release.wait(5)
        return JSONResponse({'solution': [], 'status': 'fixture result', 'status_code': 0})
    monkeypatch.setattr('backend.main.setup.runAutoSBC', slow)
    response = client.post('/api/solve/jobs', json=payload())
    assert response.status_code == 202
    job = response.json()['jobId']
    try:
        assert entered.wait(5)
        assert client.get(f'/api/solve/jobs/{job}').json()['status'] == 'running'
        assert client.post('/api/solve/jobs', json=payload()).status_code == 409
    finally:
        release.set()
    import time
    for _ in range(100):
        result = client.get(f'/api/solve/jobs/{job}').json()
        if result['status'] != 'running':
            break
        time.sleep(.01)
    assert result['status'] == 'done'
    assert result['result']['reviewRequired'] is True
    assert client.get('/api/solve/jobs/not-a-job').status_code == 404


def test_async_job_exposes_errors_and_releases_lock(client, monkeypatch):
    def fail(*args):
        raise ValueError('bad chemistry input')
    monkeypatch.setattr('backend.main.setup.runAutoSBC', fail)
    job = client.post('/api/solve/jobs', json=payload()).json()['jobId']
    import time
    for _ in range(100):
        result = client.get(f'/api/solve/jobs/{job}').json()
        if result['status'] != 'running':
            break
        time.sleep(.01)
    assert result['status'] == 'error'
    assert 'bad chemistry' in result['detail']
    assert not client.get('/health').json()['solverBusy']


def test_concept_endpoint_validates_and_forwards_sbc_policy(client, monkeypatch):
    calls = []
    def candidates(sbc, policy, limit):
        calls.append((sbc, policy, limit))
        return {'players': [], 'coverage': {'returned': 0, 'totalEligible': 0, 'complete': True}}
    monkeypatch.setattr(client.app.state.catalog, 'concept_candidates', candidates, raising=False)
    body = {'sbcData': payload()['sbcData'], 'solverPolicy': {'maxRating': 84}, 'limit': 200}
    result = client.post('/api/concepts', json=body)
    assert result.status_code == 200
    assert result.json()['coverage']['complete']
    assert calls[0] == (body['sbcData'], body['solverPolicy'], 200)
    body['limit'] = 3001
    assert client.post('/api/concepts', json=body).status_code == 422
