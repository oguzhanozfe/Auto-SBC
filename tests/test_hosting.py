"""Hosted boundaries with synthetic cards; no EA data or network requests."""
import gzip
import json
import threading

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.catalog import Catalog
from backend.hosted_seed import seed_ratings
from backend.runtime_config import RuntimeConfig, solver_workers


TOKEN = "test-owner-token-" + "a" * 40
ORIGIN = "https://autosbc-test.onrender.com"
HEADERS = {"Authorization": "Bearer " + TOKEN}


@pytest.fixture
def hosted(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTOSBC_HOSTED", "1")
    monkeypatch.setenv("AUTOSBC_PUBLIC_ORIGIN", ORIGIN)
    monkeypatch.setenv("AUTOSBC_API_TOKEN", TOKEN)
    monkeypatch.setenv("AUTOSBC_EXTENSION_IDS", "a" * 32)
    monkeypatch.setenv("AUTOSBC_SOLVER_WORKERS", "1")
    # No public sync or private account traffic belongs in unit tests.
    monkeypatch.setattr(Catalog, "_fetch", lambda *args, **kwargs: pytest.fail("Unexpected network request"))
    app = create_app(tmp_path)
    with TestClient(app, base_url=ORIGIN) as client:
        yield client


def squad(chemistry=False):
    positions = [0, 3, 5, 5, 5, 7, 10, 14, 14, 25, 25]
    constraints = [{"requirementKey": "TEAM_RATING", "scope": "GREATER", "count": -1, "eligibilityValues": [81]}]
    if chemistry:
        constraints += [{"requirementKey": key, "scope": scope, "count": -1 if key != "PLAYER_RARITY_GROUP" else 4, "eligibilityValues": [value]}
                        for key, scope, value in [("CHEMISTRY_POINTS", "GREATER", 31), ("SAME_LEAGUE_COUNT", "GREATER", 5),
                                                   ("NATION_COUNT", "LOWER", 6), ("CLUB_COUNT", "LOWER", 4),
                                                   ("PLAYER_RARITY_GROUP", "GREATER", 4)]]
    return {"gameYear": 26, "platform": "ps5", "maxSolveTime": 3,
            "sbcData": {"formation": positions, "brickIndices": [], "constraints": constraints},
            "solverPolicy": {"allowConcept": False},
            "clubPlayers": [{"id": i + 1, "definitionId": i + 1000, "assetId": i + 2000,
                             "name": f"Synthetic player {i}", "rating": 81, "teamId": 1, "leagueId": 1,
                             "nationId": 1, "rarityId": 1, "ratingTier": 3, "groups": [4],
                             "isUntradeable": True, "concept": False, "possiblePositions": [position],
                             "marketPrice": 500} for i, position in enumerate(positions)]}


def test_hosted_requires_explicit_secure_configuration(monkeypatch):
    monkeypatch.setenv("AUTOSBC_HOSTED", "1")
    monkeypatch.delenv("AUTOSBC_API_TOKEN", raising=False)
    monkeypatch.delenv("AUTOSBC_PUBLIC_ORIGIN", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    with pytest.raises(ValueError, match="exact HTTPS"):
        RuntimeConfig.read()
    monkeypatch.setenv("AUTOSBC_PUBLIC_ORIGIN", ORIGIN)
    with pytest.raises(ValueError, match="access|AUTOSBC_API_TOKEN"):
        RuntimeConfig.read()
    monkeypatch.setenv("AUTOSBC_API_TOKEN", TOKEN)
    assert TOKEN not in repr(RuntimeConfig.read())
    for value in ["http://example.com", "https://*.example.com", "https://example.com/path", "https://user@example.com", "https://example.com:443"]:
        monkeypatch.setenv("AUTOSBC_PUBLIC_ORIGIN", value)
        with pytest.raises(ValueError, match="exact HTTPS"):
            RuntimeConfig.read()
    monkeypatch.delenv("AUTOSBC_PUBLIC_ORIGIN")
    monkeypatch.setenv("RENDER_EXTERNAL_URL", ORIGIN)
    assert RuntimeConfig.read().hostname == "autosbc-test.onrender.com"
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    with pytest.raises(ValueError, match="WEB_CONCURRENCY"):
        RuntimeConfig.read()


def test_auth_precedes_body_parsing_and_protects_results_and_downloads(hosted):
    for method, path in [("GET", "/api/database/status"), ("GET", "/api/players"), ("GET", "/api/solve/jobs/example"),
                         ("GET", "/solver-logs"), ("GET", "/download/chrome-extension"), ("GET", "/conceptPlayers.csv"),
                         ("GET", "/docs"), ("GET", "/openapi.json"), ("POST", "/api/solve/jobs"), ("POST", "/clear-logs")]:
        response = hosted.request(method, path, content="broken-json")
        assert response.status_code == 401, path
        assert TOKEN not in response.text
    assert hosted.get("/health").json() == {"status": "ok", "version": hosted.app.version, "mode": "hosted"}
    assert hosted.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401
    data = hosted.get("/health", headers=HEADERS).json()
    assert data["database"]["count"] > 0
    assert data["capabilities"] == {"allowConcept": False, "allowChemistry": True, "maxSolveTime": 30,
                                    "maxClubPlayers": 5000, "maxChemistryPlayers": 200}
    assert TOKEN not in json.dumps(data)


def test_hosted_landing_and_privacy_explain_remote_mode_without_data_ui(hosted):
    landing = hosted.get("/")
    assert landing.status_code == 200
    assert "Your private solver endpoint" in landing.text
    assert "Check server" in landing.text and "AUTOSBC_EXTENSION_IDS" in landing.text
    assert "/static/app.js" not in landing.text and "<form" not in landing.text
    assert "frame-ancestors 'none'" in landing.headers["content-security-policy"]
    privacy = hosted.get("/privacy")
    assert privacy.status_code == 200
    assert "In local mode" in privacy.text and "In hosted mode" in privacy.text
    assert "server operator and hosting provider" in privacy.text
    assert "trusted extension contexts" in privacy.text
    assert "has no hosted club-data service" not in privacy.text
    assert TOKEN not in landing.text + privacy.text
    assert hosted.get("/api/database/status").status_code == 401


def test_default_local_mode_keeps_interactive_dashboard(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTOSBC_HOSTED", "0")
    with TestClient(create_app(tmp_path)) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "/static/app.js" in response.text and "Build your next SBC" in response.text
        assert "Your private solver endpoint" not in response.text


def test_hosted_cors_accepts_only_exact_origins_and_authorization(hosted):
    for origin in [ORIGIN, "https://www.ea.com", "chrome-extension://" + "a" * 32]:
        response = hosted.options("/api/solve/jobs", headers={"Origin": origin,
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
    for origin in ["https://evil.example", "http://127.0.0.1:8000", "chrome-extension://" + "b" * 32]:
        assert hosted.get("/health", headers={**HEADERS, "Origin": origin}).status_code == 403
    assert hosted.get("/health", headers={"Host": "evil.example"}).status_code == 400
    assert hosted.post("/api/solve/jobs", content=b"{}", headers={**HEADERS, "Content-Length": str(8 * 1024 * 1024 + 1)}).status_code == 413


def test_hosted_real_shaped_small_chemistry_and_rating_requests_solve(hosted):
    for chemistry in [False, True]:
        response = hosted.post("/solve", headers=HEADERS, json=squad(chemistry))
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status_code"] in (2, 4), result
        assert len(result["solution"]) == 11
        assert result["summary"]["estimatedRating"] >= 81
        if chemistry:
            assert result["summary"]["chemistry"] >= 31


def test_hosted_limits_reject_without_trimming_or_starting_solver(hosted, monkeypatch):
    monkeypatch.setattr("backend.main.planner.plan", lambda *args, **kwargs: pytest.fail("Oversized/disabled request reached solver"))
    cases = []
    request = squad(); request["maxSolveTime"] = 31; cases.append(request)
    request = squad(); request["clubPlayers"] *= 455; cases.append(request)
    request = squad(True); request["clubPlayers"] *= 19; cases.append(request)
    request = squad(); request["solverPolicy"]["allowConcept"] = True; cases.append(request)
    for request in cases:
        for path in ["/solve", "/api/solve/jobs"]:
            assert hosted.post(path, headers=HEADERS, json=request).status_code == 422
    assert not hosted.app.state.solve_lock.locked()
    assert hosted.post("/api/database/sync", headers=HEADERS, json={}).status_code == 403
    assert hosted.get("/api/solve/jobs/expired", headers=HEADERS).status_code == 410


def test_hosted_one_job_and_authenticated_polling(hosted, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    def plan(*args, **kwargs):
        assert kwargs["refresh_prices"] is True
        entered.set(); assert release.wait(5)
        return {"solution": [], "status_code": 0}
    monkeypatch.setattr("backend.main.planner.plan", plan)
    response = hosted.post("/api/solve/jobs", headers=HEADERS, json=squad())
    assert response.status_code == 202
    job = response.json()["jobId"]
    try:
        assert entered.wait(5)
        assert hosted.get(f"/api/solve/jobs/{job}").status_code == 401
        assert hosted.get(f"/api/solve/jobs/{job}", headers=HEADERS).json()["status"] == "running"
        assert hosted.post("/api/solve/jobs", headers=HEADERS, json=squad()).status_code == 409
    finally:
        release.set()


def test_job_lost_after_restart_does_not_recreate_work(hosted, monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr("backend.main.planner.plan", lambda *args, **kwargs: calls.append(1) or {"solution": []})
    response = hosted.post("/api/solve/jobs", headers=HEADERS, json=squad())
    job = response.json()["jobId"]
    with TestClient(create_app(tmp_path / "restarted"), base_url=ORIGIN) as restarted:
        assert restarted.get(f"/api/solve/jobs/{job}", headers=HEADERS).status_code == 410
        assert len(calls) == 1


def test_hosted_seed_contains_only_public_definition_rating_pairs(tmp_path):
    catalog = Catalog(tmp_path, 26, "ps5")
    seed_ratings(catalog)
    with catalog._connect() as db:
        rows = db.execute("SELECT payload FROM cards").fetchall()
        assert rows
        for row in rows:
            assert set(json.loads(row[0])) == {"definitionId", "rating", "name"}
        assert db.execute("SELECT COUNT(*) FROM prices").fetchone()[0] == 0
    bad = {"format": "autosbc-public-ratings-v1", "gameYear": 27, "source": "https://www.fut.gg/players/", "cards": [[100, 80]]}
    (tmp_path / "public-ratings-fc26.json.gz").write_bytes(gzip.compress(json.dumps(bad).encode()))
    with pytest.raises(ValueError, match="scope"):
        seed_ratings(catalog, tmp_path)


def test_solver_workers_are_bounded_and_hosted_is_single_worker(monkeypatch):
    monkeypatch.setenv("AUTOSBC_HOSTED", "1")
    monkeypatch.delenv("AUTOSBC_SOLVER_WORKERS", raising=False)
    assert solver_workers() == 1
    for invalid in ["0", "2", "9", "1.5", "yes"]:
        monkeypatch.setenv("AUTOSBC_SOLVER_WORKERS", invalid)
        with pytest.raises(ValueError):
            solver_workers()
    monkeypatch.setenv("AUTOSBC_HOSTED", "0")
    monkeypatch.setenv("AUTOSBC_SOLVER_WORKERS", "2")
    assert solver_workers() == 2
