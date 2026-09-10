"""Load public definition/rating pairs for owned-card valuation fallbacks only."""
import gzip
import json
from pathlib import Path


def seed_ratings(catalog, directory=None):
    directory = Path(directory or Path(__file__).resolve().parents[1] / "deploy")
    path = directory / f"public-ratings-fc{catalog.game_year}.json.gz"
    if not path.is_file():
        raise ValueError(f"Hosted public rating seed is missing for FC {catalog.game_year}.")
    with gzip.open(path, "rt", encoding="utf-8") as source:
        raw = source.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Hosted public rating seed exceeds its size limit.")
    data = json.loads(raw)
    pairs = data.get("cards")
    if (data.get("format") != "autosbc-public-ratings-v1" or data.get("gameYear") != catalog.game_year
            or data.get("source") != "https://www.fut.gg/players/"
            or not isinstance(pairs, list) or not 1 <= len(pairs) <= 50000):
        raise ValueError("Hosted public rating seed has an invalid scope or format.")
    ids = set()
    for pair in pairs:
        if (not isinstance(pair, list) or len(pair) != 2 or type(pair[0]) is not int
                or not 0 < pair[0] < 2 ** 53 or type(pair[1]) is not int
                or not 0 <= pair[1] <= 99 or pair[0] in ids):
            raise ValueError("Hosted public rating seed contains invalid or duplicate definitions.")
        ids.add(pair[0])
    with catalog._connect() as db:
        # These aren't concept candidates or ownership records. The hosted
        # profile disables concepts; complete catalog rows, if present, survive.
        db.executemany("INSERT OR IGNORE INTO cards VALUES (?, ?, ?, ?, ?)", [
            (definition, f"Definition {definition}", rating,
             json.dumps({"definitionId": definition, "rating": rating, "name": f"Definition {definition}"}),
             data.get("exportedAt", "")) for definition, rating in pairs])
        catalog._set_meta(db, "hostingSeed", {"format": data["format"], "definitionCount": len(pairs),
                                               "source": data["source"], "conceptMetadata": False})
