"""Benchmark an exported solve request locally; generated stress requires --synthetic.

Only anonymous measurements reach stdout. No EA requests, catalog sync, uploads,
or solution exports occur. Run each measurement in a separate Python process.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import json
import math
import os
from pathlib import Path
import platform
import re
import resource
import sqlite3
import sys
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
MAX_REQUEST_BYTES = 24 * 1024 * 1024
LIMITATION = (
    "Local process measurement, not a cloud benchmark or a memory upper bound. "
    "Pipeline timing excludes Python imports, catalog snapshot preparation, HTTP, "
    "job scheduling and polling; peak RSS includes this whole Python process. "
    "The exported club pool was already filtered by the extension and is not a full club count. "
    "Current cached catalog prices are used; historical prices and live-quote freshness are not frozen."
)


class BenchmarkError(Exception):
    """Contains only a fixed, non-private error code."""


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--request", type=Path, help="JSON from the extension's Export solve request button")
    mode.add_argument("--synthetic", action="store_true", help="Explicitly generate an artificial stress case")
    parser.add_argument("--players", type=int, help="Synthetic only; default 3000")
    parser.add_argument("--chemistry", action="store_true", help="Synthetic only: 33 chemistry and all positions per card")
    parser.add_argument("--seconds", type=float, help="Synthetic only; default 5. Observed requests keep their exported budget.")
    parser.add_argument("--catalog-dir", type=Path, help="Existing local public catalogs; defaults to AUTOSBC_DATA_DIR or data/")
    parser.add_argument("--request-profile", choices=("single-preview", "daily-preset"),
                        help="Optional capture context; recorded explicitly, never inferred from the SBC name")
    args = parser.parse_args(argv)
    if args.request and (args.players is not None or args.chemistry or args.seconds is not None):
        parser.error("--players, --chemistry and --seconds require --synthetic; exported requests are not altered.")
    if args.synthetic and args.request_profile:
        parser.error("--request-profile requires --request.")
    if args.synthetic:
        args.players = 3000 if args.players is None else args.players
        args.seconds = 5 if args.seconds is None else args.seconds
        if not 11 <= args.players <= 20000 or not math.isfinite(args.seconds) or not 1 <= args.seconds <= 120:
            parser.error("Use 11–20,000 players and a 1–120 second synthetic solve budget.")
    return args


def load_request(path):
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise BenchmarkError("REQUEST_TOO_LARGE")
        payload = json.loads(raw)
    except (OSError, ValueError, UnicodeError):
        raise BenchmarkError("REQUEST_UNREADABLE") from None
    if not isinstance(payload, dict):
        raise BenchmarkError("REQUEST_MUST_BE_AN_OBJECT")
    return payload


def synthetic_request(players, chemistry, seconds):
    positions = [0, 3, 5, 7, 10, 14, 16, 18, 22, 23, 25]
    cards = [{
        "id": i + 1, "assetId": i + 1, "definitionId": i + 1,
        "name": f"Synthetic player {i + 1}", "rating": 80 + i % 10,
        "teamId": 1 + i % 10, "leagueId": 1, "nationId": 1 + i % 5,
        "rarityId": 1, "ratingTier": 3, "groups": [4],
        "possiblePositions": positions if chemistry else [positions[i % 11]],
        "isUntradeable": True, "concept": False, "gamesPlayed": 0,
        "marketPrice": 500 + (i % 10) * 500,
    } for i in range(players)]
    requirements = [{"requirementKey": "TEAM_RATING", "eligibilityValues": [83],
                     "scope": "GREATER", "count": 11}]
    if chemistry:
        requirements.append({"requirementKey": "CHEMISTRY_POINTS", "eligibilityValues": [33],
                             "scope": "GREATER", "count": 11})
    return {"sbcData": {"constraints": requirements, "formation": positions,
                        "brickIndices": [], "currentSolution": []},
            "clubPlayers": cards, "maxSolveTime": seconds, "solverPolicy": {},
            "gameYear": 26, "platform": "ps5"}


@contextmanager
def temporary_data_dir(directory):
    previous = os.environ.get("AUTOSBC_DATA_DIR")
    os.environ["AUTOSBC_DATA_DIR"] = str(directory)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("AUTOSBC_DATA_DIR", None)
        else:
            os.environ["AUTOSBC_DATA_DIR"] = previous


def snapshot_catalog(source, target):
    """Read a consistent committed SQLite snapshot, including any WAL pages."""
    try:
        with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as original:
            with sqlite3.connect(target) as copied:
                original.backup(copied)
    except sqlite3.Error:
        raise BenchmarkError("LOCAL_CATALOG_UNREADABLE") from None


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def status_key(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Z_]{1,64}", value) else None


def benchmark(payload, *, mode, catalog_dir=None, request_profile=None):
    if mode not in ("observed-request", "synthetic-stress"):
        raise BenchmarkError("INVALID_BENCHMARK_MODE")
    catalog_root = Path(catalog_dir or os.environ.get("AUTOSBC_DATA_DIR") or ROOT / "data")
    with tempfile.TemporaryDirectory(prefix="autosbc-benchmark-") as temporary:
        # Importing backend.main creates its default app/catalog. Isolate that
        # public-data initialization too, then use the production request model.
        with temporary_data_dir(temporary):
            from backend.main import SolveRequest
            from backend.catalog import Catalog
            from backend import planner, setup
            from backend.solver_model import CHEMISTRY_KEYS, SUPPORTED_KEYS
            from backend.solver_policy import DEFAULT_POLICY, flag, normalize_policy
            try:
                body = SolveRequest.model_validate(payload)
                normalized_policy = normalize_policy(body.solverPolicy)
            except (ValueError, TypeError):
                raise BenchmarkError("REQUEST_VALIDATION_FAILED") from None
            year = body.gameYear or int(os.environ.get("AUTOSBC_GAME_YEAR", "26"))
            market = body.platform or os.environ.get("AUTOSBC_PLATFORM", "ps5")
            filename = f"catalog-fc{year}-{market}.sqlite3"
            source = catalog_root / filename
            if mode == "observed-request":
                if not source.is_file():
                    raise BenchmarkError("MATCHING_LOCAL_CATALOG_REQUIRED")
                snapshot_catalog(source, Path(temporary) / filename)
            # Planner reads only SQLite; reject accidental future network use.
            with patch("requests.sessions.Session.request", side_effect=BenchmarkError("NETWORK_DISABLED")):
                catalog = Catalog(data_dir=temporary, game_year=year, platform=market)
                constraints = body.sbcData.get("constraints", [])
                constraints = constraints if isinstance(constraints, list) else []
                known = [req for req in constraints if isinstance(req, dict) and req.get("requirementKey") in SUPPORTED_KEYS]
                chemistry = [{"key": req["requirementKey"],
                              "scope": req.get("scope") if req.get("scope") in ("GREATER", "LOWER", "EXACT") else None,
                              "values": [number(value) for value in req.get("eligibilityValues", [])],
                              "count": number(req.get("count"))}
                             for req in known if req["requirementKey"] in CHEMISTRY_KEYS
                             and isinstance(req.get("eligibilityValues"), list)]
                bricks = body.sbcData.get("brickIndices", [])
                brick_count = len(bricks) if isinstance(bricks, list) else None
                stages = []
                original_solve = setup.optimize.solve

                def measured_solve(rows, sbc, max_solve_time, policy, diagnostics):
                    stage = {"modelCandidates": len(rows),
                             "ownedModelCandidates": sum(not row["concept"] for row in rows),
                             "conceptModelCandidates": sum(row["concept"] for row in rows),
                             "positionOptions": sum(len(row["possiblePositions"]) for row in rows),
                             "chemistryModelRequested": any(req["requirementKey"] in CHEMISTRY_KEYS for req in sbc["constraints"]),
                             "solveBudgetSeconds": round(max_solve_time, 3)}
                    stages.append(stage)
                    started = time.monotonic()
                    try:
                        return original_solve(rows, sbc, max_solve_time, policy, diagnostics)
                    finally:
                        stage.update(wallSeconds=round(time.monotonic() - started, 3),
                                     searchStatus=status_key(diagnostics.get("searchStatus")),
                                     solverSeconds=number(diagnostics.get("solveTimeSeconds")),
                                     chemistryExcludedCount=len(diagnostics.get("unsupportedChemistryItemIds", [])),
                                     rarityMetadataExcludedCount=len(diagnostics.get("unknownRarityGroupItemIds", [])))

                started, cpu_started = time.monotonic(), time.process_time()
                with patch.object(setup.optimize, "solve", measured_solve):
                    result = planner.plan(body, catalog)
                wall_seconds, cpu_seconds = time.monotonic() - started, time.process_time() - cpu_started
                diagnostics = result.get("diagnostics") or {}
                rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                peak_bytes = rss if sys.platform == "darwin" else rss * 1024
                return {"mode": mode, "synthetic": mode == "synthetic-stress",
                        "requestProfile": request_profile or "unspecified",
                        "platform": sys.platform, "architecture": platform.machine(),
                        "pythonVersion": platform.python_version(), "solverWorkers": min(8, os.cpu_count() or 1),
                        "inputPlayers": len(body.clubPlayers),
                        "inputOwnedPlayers": sum(not flag(row.get("concept")) for row in body.clubPlayers),
                        "inputConceptPlayers": sum(flag(row.get("concept")) for row in body.clubPlayers),
                        "allowConcept": body.solverPolicy.get("allowConcept") is True,
                        "policy": {key: normalized_policy.get(key) for key in (
                            *DEFAULT_POLICY, "minRating", "maxRating", "maxPlayerPrice", "maxTotalPrice", "maxPurchasePrice")},
                        "liveQuoteCount": len(body.liveMarket.quotes) if body.liveMarket is not None else 0,
                        "requiredPlayers": 11 - brick_count if brick_count is not None else None,
                        "brickSlots": brick_count, "constraintKeys": sorted({req["requirementKey"] for req in known}),
                        "unknownConstraintCount": len(constraints) - len(known),
                        "chemistryRequirements": chemistry, "solveBudgetSeconds": body.maxSolveTime,
                        "catalog": "local-public-snapshot" if mode == "observed-request" else "empty-synthetic-catalog",
                        "catalogCards": number((result.get("database") or {}).get("count")),
                        "wallSeconds": round(wall_seconds, 3), "cpuSeconds": round(cpu_seconds, 3),
                        "processPeakMiB": round(peak_bytes / 1024**2, 1),
                        "status": status_key(result.get("status_key")), "statusCode": number(result.get("status_code")),
                        "policyEligibleCandidates": number(diagnostics.get("candidateCount")),
                        "modelStages": stages, "solutionPlayers": len(result.get("solution", [])),
                        "limitation": LIMITATION}


def main(argv=None):
    args = parse_args(argv)
    mode = "synthetic-stress" if args.synthetic else "observed-request"
    try:
        # Never forward backend error details/logs: they may contain card IDs.
        with open(os.devnull, "w") as sink, redirect_stdout(sink), redirect_stderr(sink):
            payload = synthetic_request(args.players, args.chemistry, args.seconds) if args.synthetic else load_request(args.request)
            report = benchmark(payload, mode=mode, catalog_dir=args.catalog_dir, request_profile=args.request_profile)
    except Exception as exc:
        report = {"mode": mode, "status": "BENCHMARK_FAILED",
                  "error": str(exc) if isinstance(exc, BenchmarkError) else "PIPELINE_FAILED",
                  "limitation": LIMITATION}
        print(json.dumps(report, indent=2))
        return 1
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
