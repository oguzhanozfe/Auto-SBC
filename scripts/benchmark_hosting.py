"""Measure one synthetic solver process; never reads an EA club or sends data."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import resource
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.setup import runAutoSBC


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=int, default=3000)
    parser.add_argument("--chemistry", action="store_true")
    parser.add_argument("--seconds", type=float, default=5)
    args = parser.parse_args()
    if not 11 <= args.players <= 20000 or not 1 <= args.seconds <= 120:
        parser.error("Use 11–20,000 players and a 1–120 second solve budget.")
    positions = [0, 3, 5, 7, 10, 14, 16, 18, 22, 23, 25]
    players = [{
        "id": i + 1, "assetId": i + 1, "definitionId": i + 1,
        "name": f"Synthetic player {i + 1}", "rating": 80 + i % 10,
        "teamId": 1 + i % 10, "leagueId": 1, "nationId": 1 + i % 5,
        "rarityId": 1, "ratingTier": 3, "groups": [4],
        "possiblePositions": positions if args.chemistry else [positions[i % 11]],
        "isUntradeable": True, "concept": False, "gamesPlayed": 0,
        "marketPrice": 500 + (i % 10) * 500,
    } for i in range(args.players)]
    requirements = [{"requirementKey": "TEAM_RATING", "eligibilityValues": [83],
                     "scope": "GREATER", "count": 11}]
    if args.chemistry:
        requirements.append({"requirementKey": "CHEMISTRY_POINTS", "eligibilityValues": [33],
                             "scope": "GREATER", "count": 11})
    sbc = {"constraints": requirements, "formation": positions,
           "brickIndices": [], "currentSolution": []}
    started = time.monotonic()
    response = json.loads(runAutoSBC(sbc, players, args.seconds).body)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_bytes = rss if sys.platform == "darwin" else rss * 1024
    print(json.dumps({
        "synthetic": True, "platform": sys.platform, "players": args.players,
        "chemistry": args.chemistry, "solveBudgetSeconds": args.seconds,
        "wallSeconds": round(time.monotonic() - started, 3),
        "processPeakMiB": round(peak_bytes / 1024**2, 1),
        "status": response.get("status"), "statusCode": response.get("status_code"),
        "solutionPlayers": len(response.get("solution", [])),
        "limitation": "Local process measurement, not a cloud benchmark or a memory upper bound.",
    }, indent=2))


if __name__ == "__main__":
    main()
