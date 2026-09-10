"""The CI smoke sends synthetic shapes only and HTTP is confined to loopback."""
import pytest

from backend.main import SolveRequest
from backend.planner import plan
from backend.catalog import Catalog
from deploy.smoke import bronze_fixture, checked_origin, fixture


@pytest.mark.parametrize("value", ["http://example.com", "http://127.0.0.2:18000", "http://localhost:18000",
                                    "http://127.0.0.1.evil.example", "http://user@127.0.0.1:18000",
                                    "http://127.0.0.1:18000/path", "http://127.0.0.1:99999"])
def test_container_http_exception_never_allows_other_origins(value):
    with pytest.raises(ValueError):
        checked_origin(value, local_container=True)


def test_remote_smoke_still_requires_https():
    assert checked_origin("https://service.onrender.com") == "https://service.onrender.com"
    assert checked_origin("http://127.0.0.1:18000", local_container=True) == "http://127.0.0.1:18000"
    with pytest.raises(ValueError):
        checked_origin("http://127.0.0.1:18000")


@pytest.mark.parametrize("kind", ["bronze", "rating", "chemistry"])
def test_smoke_fixtures_solve_with_real_engine_without_network(tmp_path, monkeypatch, kind):
    monkeypatch.setenv("AUTOSBC_SOLVER_WORKERS", "1")
    monkeypatch.setattr(Catalog, "_fetch", lambda *args, **kwargs: pytest.fail("Unexpected public or private network"))
    raw = bronze_fixture() if kind == "bronze" else fixture(kind == "chemistry")
    assert len(raw["clubPlayers"]) == 22
    result = plan(SolveRequest(**raw), Catalog(tmp_path), refresh_prices=True)
    assert result["status_code"] in (2, 4), result
    assert len(result["solution"]) == (1 if kind == "bronze" else 11)
    if kind == "bronze":
        assert len(raw["sbcData"]["brickIndices"]) == 10
        assert result["solution"][0]["rating"] <= 64
    elif kind == "rating":
        assert result["summary"]["estimatedRating"] >= 91
    else:
        assert result["summary"]["chemistry"] >= 31
