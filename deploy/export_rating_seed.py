"""Export only public definition IDs and ratings; never export club payloads."""
import argparse
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import sqlite3


def export_seed(database, destination, game_year):
    with sqlite3.connect(f"file:{Path(database).resolve()}?mode=ro", uri=True) as db:
        scope = json.loads(db.execute("SELECT value FROM metadata WHERE key='scope'").fetchone()[0])
        if scope.get("gameYear") != game_year:
            raise ValueError("Public catalog season does not match the requested seed.")
        pairs = db.execute("SELECT definition_id, rating FROM cards ORDER BY definition_id").fetchall()
    if not pairs:
        raise ValueError("The public catalog is empty.")
    data = {"format": "autosbc-public-ratings-v1", "gameYear": game_year,
            "source": "https://www.fut.gg/players/", "exportedAt": datetime.now(timezone.utc).isoformat(),
            "cards": pairs}
    Path(destination).write_bytes(gzip.compress(json.dumps(data, separators=(",", ":")).encode(), mtime=0))
    return len(pairs)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--game-year", type=int, required=True, choices=(26, 27))
    args = parser.parse_args()
    print(f"Exported {export_seed(args.database, args.destination, args.game_year)} public definition/rating pairs.")
