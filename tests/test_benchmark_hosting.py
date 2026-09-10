"""The hosting script replays real request shapes without exporting club data."""
import hashlib
import json

import pytest

from scripts import benchmark_hosting as benchmark


def request_fixture():
    return {"gameYear": 26, "platform": "ps5", "maxSolveTime": 1,
            "sbcData": {"challengeId": 987654321, "challengeName": "PRIVATE CHALLENGE",
                        "formation": [14] + [-1] * 10, "brickIndices": list(range(1, 11)),
                        "constraints": [{"requirementKey": "PLAYER_QUALITY", "scope": "EXACT",
                                         "count": 1, "eligibilityValues": [1]}]},
            "solverPolicy": {"protectPlayed": True, "maxPlayerPrice": 1000},
            "clubPlayers": [{"id": 887766550 + index, "assetId": 776655440 + index,
                             "definitionId": 665544330 + index, "name": "PRIVATE CARD",
                             "rating": 60, "teamId": 443322110, "leagueId": 332211990,
                             "nationId": 221199880, "rarityId": 0, "ratingTier": 1,
                             "possiblePositions": [14], "groups": [0], "concept": False,
                             "isUntradeable": True, "gamesPlayed": 1 if index == 0 else 0,
                             "marketPrice": 2000 if index == 1 else 500}
                            for index in range(3)]}


@pytest.fixture
def catalog_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTOSBC_DATA_DIR", str(tmp_path))
    from backend.catalog import Catalog
    Catalog(data_dir=tmp_path, game_year=26, platform="ps5")
    return tmp_path


def test_generation_requires_explicit_synthetic_and_request_cannot_be_changed():
    for arguments in ([], ["--players", "3000"], ["--request", "private.json", "--seconds", "2"],
                      ["--request", "private.json", "--chemistry"],
                      ["--request", "private.json", "--players", "11"],
                      ["--synthetic", "--seconds", "nan"]):
        with pytest.raises(SystemExit) as exc:
            benchmark.parse_args(arguments)
        assert exc.value.code == 2
    assert benchmark.parse_args(["--synthetic"]).players == 3000
    assert benchmark.parse_args(["--request", "private.json"]).seconds is None


def test_observed_pipeline_applies_protection_and_prices_to_actual_model_pool(catalog_dir):
    source = catalog_dir / "catalog-fc26-ps5.sqlite3"
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    payload = request_fixture()
    original = json.dumps(payload, sort_keys=True)
    report = benchmark.benchmark(payload, mode="observed-request", catalog_dir=catalog_dir)
    assert json.dumps(payload, sort_keys=True) == original
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    assert report["mode"] == "observed-request"
    assert report["synthetic"] is False
    assert report["inputPlayers"] == 3
    assert report["policyEligibleCandidates"] == 1
    assert report["requiredPlayers"] == 1 and report["brickSlots"] == 10
    assert report["constraintKeys"] == ["PLAYER_QUALITY"]
    assert report["chemistryRequirements"] == []
    assert report["solveBudgetSeconds"] == 1
    assert report["policy"]["protectPlayed"] is True
    assert report["policy"]["maxPlayerPrice"] == 1000
    assert "lockedItemIds" not in report["policy"]
    assert report["statusCode"] == 4 and report["solutionPlayers"] == 1
    assert report["modelStages"][0]["modelCandidates"] == 1
    assert report["modelStages"][0]["positionOptions"] == 1
    assert report["modelStages"][0]["chemistryModelRequested"] is False
    serialized = json.dumps(report)
    assert "PRIVATE" not in serialized
    for row in payload["clubPlayers"]:
        for key in ("id", "assetId", "definitionId", "teamId", "leagueId", "nationId"):
            assert str(row[key]) not in serialized
    assert "987654321" not in serialized
    assert "not a cloud benchmark" in report["limitation"]


def test_real_chemistry_shape_keeps_native_position_options(catalog_dir):
    payload = request_fixture()
    positions = [0, 3, 5, 5, 7, 12, 14, 14, 16, 25, 25]
    payload["sbcData"] = {"formation": positions, "brickIndices": [], "constraints": [
        {"requirementKey": "CHEMISTRY_POINTS", "scope": "GREATER", "count": -1, "eligibilityValues": [18]}]}
    payload["clubPlayers"] = [{**payload["clubPlayers"][2], "id": index + 100,
                                "assetId": index + 200, "definitionId": index + 300,
                                "possiblePositions": [position]}
                               for index, position in enumerate(positions)]
    report = benchmark.benchmark(payload, mode="observed-request", catalog_dir=catalog_dir)
    assert report["chemistryRequirements"] == [{"key": "CHEMISTRY_POINTS", "scope": "GREATER", "values": [18], "count": -1}]
    assert report["modelStages"][0]["modelCandidates"] == 11
    assert report["modelStages"][0]["positionOptions"] == 11
    assert report["modelStages"][0]["chemistryModelRequested"] is True
    assert report["statusCode"] in (2, 4)


def test_synthetic_mode_is_labelled_and_does_not_need_a_real_catalog(tmp_path):
    report = benchmark.benchmark(benchmark.synthetic_request(11, False, 1),
                                 mode="synthetic-stress", catalog_dir=tmp_path)
    assert report["synthetic"] is True
    assert report["mode"] == "synthetic-stress"
    assert report["catalog"] == "empty-synthetic-catalog"
    assert report["catalogCards"] == 0


def test_missing_catalog_is_not_silently_replaced_for_observed_request(tmp_path):
    with pytest.raises(benchmark.BenchmarkError, match="MATCHING_LOCAL_CATALOG_REQUIRED"):
        benchmark.benchmark(request_fixture(), mode="observed-request", catalog_dir=tmp_path)


def test_validation_errors_and_backend_logs_never_reveal_input(tmp_path, monkeypatch, capsys):
    request = tmp_path / "request.json"
    request.write_text(json.dumps({**request_fixture(), "PRIVATE EXTRA FIELD": "PRIVATE VALUE"}))
    assert benchmark.main(["--request", str(request), "--catalog-dir", str(tmp_path)]) == 1
    output = capsys.readouterr()
    assert json.loads(output.out)["error"] == "REQUEST_VALIDATION_FAILED"
    assert "PRIVATE" not in output.out + output.err
    request.write_text(json.dumps(request_fixture()))

    def private_failure(*args, **kwargs):
        print("PRIVATE BACKEND LOG")
        raise ValueError("PRIVATE ERROR CARD 887766552")

    monkeypatch.setattr(benchmark, "benchmark", private_failure)
    assert benchmark.main(["--request", str(request)]) == 1
    output = capsys.readouterr()
    assert json.loads(output.out)["error"] == "PIPELINE_FAILED"
    assert "PRIVATE" not in output.out + output.err


def test_accidental_catalog_network_refresh_is_blocked(catalog_dir, monkeypatch):
    import requests
    from backend import planner

    def network_attempt(*args, **kwargs):
        return requests.get("https://example.invalid/private")

    monkeypatch.setattr(planner, "plan", network_attempt)
    with pytest.raises(benchmark.BenchmarkError, match="NETWORK_DISABLED"):
        benchmark.benchmark(request_fixture(), mode="observed-request", catalog_dir=catalog_dir)
