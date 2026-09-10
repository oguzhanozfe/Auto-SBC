#!/usr/bin/env python3
"""Download public card metadata and prices without accessing an EA account."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.catalog import Catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-pages', type=int, default=10, help='Bounded card-page budget; interrupted sync resumes (0–1000).')
    parser.add_argument('--platform', choices=('ps5', 'pc'), default='ps5')
    parser.add_argument('--game-year', type=int, default=26, help='Exact FC season; another season is never used as a fallback.')
    parser.add_argument('--data-dir')
    parser.add_argument('--csv', type=Path, help='Optional public concept catalog CSV export; no ownership claims.')
    parser.add_argument('--prices-only', action='store_true', help='Refresh only this season/platform price snapshot and readiness, without card pages.')
    parser.add_argument('--status', action='store_true', help='Show existing local metadata without network access.')
    args = parser.parse_args()
    catalog = Catalog(args.data_dir, args.game_year, args.platform)
    try:
        result = catalog.status() if args.status else catalog.sync(0 if args.prices_only else args.max_pages)
    except Exception as error:
        print(json.dumps({'error': str(error), 'database': catalog.status()}, indent=2), file=sys.stderr)
        return 1
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        args.csv.write_text(catalog.csv_text(), encoding='utf-8')
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
