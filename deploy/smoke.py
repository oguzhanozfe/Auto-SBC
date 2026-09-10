"""Test the hosted API with synthetic cards only. No EA session or club export."""
import argparse
import os
import time
from urllib.parse import urlsplit

import requests


def fixture(chemistry=False):
    positions = [0, 3, 5, 5, 5, 7, 10, 14, 14, 25, 25]
    target_rating = 81 if chemistry else 91
    requirements = [{"requirementKey": "TEAM_RATING", "scope": "GREATER", "count": -1, "eligibilityValues": [target_rating]}]
    if chemistry:
        requirements.extend({"requirementKey": key, "scope": scope, "count": count, "eligibilityValues": [value]}
                            for key, scope, count, value in [("CHEMISTRY_POINTS", "GREATER", -1, 31),
                            ("SAME_LEAGUE_COUNT", "GREATER", -1, 5), ("NATION_COUNT", "LOWER", -1, 6),
                            ("CLUB_COUNT", "LOWER", -1, 4), ("PLAYER_RARITY_GROUP", "GREATER", 4, 4)])
    return {"gameYear": 26, "platform": "ps5", "maxSolveTime": 15,
            "sbcData": {"name": "Synthetic hosting check", "formation": positions,
                        "brickIndices": [], "constraints": requirements},
            "solverPolicy": {"allowConcept": False}, "clubPlayers": [
                {"id": i + 1, "definitionId": 990000 + i, "assetId": 980000 + i,
                 "name": f"Synthetic {i}", "rating": target_rating if chemistry else 90 + i % 3, "ratingTier": 3,
                 "nationId": 1, "leagueId": 1, "teamId": 1, "rarityId": 1,
                 "groups": [4], "possiblePositions": [position], "concept": False,
                 "isUntradeable": True, "marketPrice": 500 + i % 7 * 50}
                for i, position in enumerate(positions * 2)]}


def bronze_fixture():
    body = fixture()
    body["sbcData"] = {"name": "Synthetic one-card Bronze daily", "formation": [0] + [-1] * 10,
                       "brickIndices": list(range(1, 11)), "constraints": [
                           {"requirementKey": "PLAYER_QUALITY", "scope": "EXACT", "count": -1, "eligibilityValues": [1]}]}
    body["solverPolicy"].update(protectPlayed=True, protectEvolutions=True, protectSpecial=True,
                               maxRating=64, maxPlayerPrice=1000)
    for player in body["clubPlayers"]:
        player.update(rating=60 + player["id"] % 4, ratingTier=1, rarityId=0, gamesPlayed=0,
                      isEvolution=False, isSpecial=False, possiblePositions=[25], marketPrice=200)
    return body


def checked_origin(value, local_container=False):
    origin = value.rstrip("/")
    parts = urlsplit(origin)
    scheme_ok = parts.scheme == "https"
    if local_container:
        scheme_ok = parts.scheme == "http" and parts.hostname == "127.0.0.1"
    if (not scheme_ok or not parts.hostname or parts.path or parts.query or parts.fragment
            or parts.username or parts.password or parts.port is not None and not 1 <= parts.port <= 65535):
        raise ValueError("Use an exact HTTPS origin; --local-container permits only http://127.0.0.1 with an optional port.")
    return origin


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("origin", help="The exact deployed HTTPS origin.")
    parser.add_argument("--local-container", action="store_true", help="CI only: allow HTTP solely on literal 127.0.0.1.")
    parser.add_argument("--wait-ready", type=int, default=0, choices=range(0, 121), metavar="0..120",
                        help="Bounded health-only startup wait; never retries a solve POST.")
    args = parser.parse_args()
    try:
        origin = checked_origin(args.origin, args.local_container)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    token = os.environ.get("AUTOSBC_API_TOKEN")
    if not token:
        raise SystemExit("Set AUTOSBC_API_TOKEN in the environment; never put it in a URL.")
    session = requests.Session()
    session.trust_env = False
    def request(method, path, *, owner=True, **kwargs):
        kwargs.setdefault("timeout", (10, 90))
        response = session.request(method, origin + path,
            headers={"Authorization": "Bearer " + token} if owner else {},
            allow_redirects=False, **kwargs)
        if 300 <= response.status_code < 400:
            raise SystemExit("Redirect refused; verify the exact service origin.")
        return response
    ready_deadline = time.monotonic() + args.wait_ready
    while True:
        try:
            response = request("GET", "/health", owner=False, timeout=(2, 5))
            if response.status_code == 200:
                break
        except (requests.ConnectionError, requests.Timeout):
            if not args.wait_ready:
                raise
        if time.monotonic() >= ready_deadline:
            raise SystemExit("The service did not become ready within the health-check deadline.")
        time.sleep(1)
    response.raise_for_status()
    public = response.json()
    assert set(public) == {"status", "version", "mode"} and public["mode"] == "hosted"
    assert request("GET", "/solver-logs", owner=False).status_code == 401
    response = request("GET", "/health"); response.raise_for_status()
    assert response.json()["capabilities"]["allowChemistry"] is True
    print(f"Hosted API {public['version']}: public health and owner authentication passed.")
    for label, body, expected_cards in [("Bronze", bronze_fixture(), 1),
                                         ("91-rated", fixture(), 11), ("31-chemistry", fixture(True), 11)]:
        started = time.monotonic()
        response = request("POST", "/api/solve/jobs", json=body); response.raise_for_status()
        job_id = response.json()["jobId"]
        while time.monotonic() - started < 90:
            response = request("GET", f"/api/solve/jobs/{job_id}")
            if response.status_code in (404, 410):
                raise SystemExit("Service lost this job. Stopped; the solve was not automatically restarted.")
            response.raise_for_status(); job = response.json()
            if job["status"] == "done":
                result = job["result"]
                assert result["status_code"] in (2, 4) and len(result["solution"]) == expected_cards
                if label == "31-chemistry":
                    assert result["summary"]["chemistry"] >= 31
                if label == "91-rated":
                    assert result["summary"]["estimatedRating"] >= 91
                if label == "Bronze":
                    assert result["solution"][0]["rating"] <= 64
                print(f"Synthetic {label} job passed in {time.monotonic()-started:.1f}s.")
                break
            if job["status"] == "error":
                raise SystemExit("Synthetic solve failed; inspect authenticated service diagnostics.")
            time.sleep(1)
        else:
            raise SystemExit("Synthetic job polling deadline reached; no automatic resubmission.")


if __name__ == "__main__":
    main()
