"""Local public FC card catalog; this database never represents club ownership.

Read-only sources are the same versioned CDN and player-definition routes used by
https://www.fut.gg/players/. No authenticated endpoint or browser session is used.
The public client decodes price index ``id0`` + cumulative ``d`` with parallel
``p``/``s`` arrays; status 1 is SBC cost and 2 is an objective, not market price.
"""
from __future__ import annotations

import csv
from contextlib import contextmanager
import fcntl
import io
import json
import math
import os
from pathlib import Path
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import urljoin, urlsplit

import requests

from .solver_policy import owned_price_stale, positive_price

SOURCE = 'https://www.fut.gg/players/'
# FUT.GG's public FC position enum; definition-data supplies these numeric IDs.
POSITIONS = {'GK': 0, 'RWB': 2, 'RB': 3, 'CB': 5, 'LB': 7, 'LWB': 8,
             'CDM': 10, 'RM': 12, 'CM': 14, 'LM': 16, 'CAM': 18, 'CF': 21,
             'RW': 23, 'ST': 25, 'LW': 27}
POSITION_NAMES = {value: key for key, value in POSITIONS.items()}
PRICE_REFRESH_COOLDOWN_SECONDS = 300
PRICE_REFRESH_TIMEOUT = (3, 5)
# Each partition is below the search API's 10,000-result ceiling. Prioritize fodder.
BANDS = [(80, 84), (85, 89), (75, 79), (65, 74), (0, 64), (90, 94), (95, 99)]
PAGE_SIZE = 100
CSV_FIELDS = ['', 'id', 'name', 'cardType', 'assetId', 'definitionId', 'rating',
              'teamId', 'leagueId', 'nationId', 'rarityId', 'ratingTier',
              'isDuplicate', 'isStorage', 'preferredPosition', 'possiblePositions',
              'groups', 'isFixed', 'concept', 'price', 'futggPrice', 'maxChem',
              'normalizeClubId', 'teamChem.calculationType', 'teamChem.contribution',
              'teamChem.parameterId', 'leagueChem.calculationType',
              'leagueChem.contribution', 'leagueChem.parameterId',
              'nationChem.calculationType', 'nationChem.contribution', 'nationChem.parameterId', 'gameYear', 'platform', 'priceGameYear', 'pricePlatform',
              'priceSnapshotAt', 'priceFetchedAt', 'priceStale']


def _now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _iso_timestamp(value):
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00', 'Z')
    return None


def _positive_price(value):
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0 else None


def decode_prices(index, blob):
    """Decode public v2 price blobs, rejecting mismatched versions/array lengths."""
    if not isinstance(index, dict) or not isinstance(blob, dict):
        raise ValueError('Invalid FUT.GG price objects; existing prices were retained.')
    if index.get('v') != 2 or blob.get('v') != 2:
        raise ValueError('Unsupported FUT.GG price format; existing prices were retained.')
    deltas, values, states = index.get('d'), blob.get('p'), blob.get('s')
    if not all(isinstance(item, list) for item in (deltas, values, states)):
        raise ValueError('Invalid FUT.GG price arrays.')
    expected = len(deltas) + 1 if values else 0
    if len(values) != expected or len(states) != expected or (not values and deltas):
        raise ValueError('FUT.GG price index/blob length mismatch; existing prices were retained.')
    if not values:
        return []
    identifier = index.get('id0')
    if not isinstance(identifier, int) or identifier <= 0:
        raise ValueError('Invalid initial price definition ID.')
    rows = []
    for offset, (value, state) in enumerate(zip(values, states)):
        if offset:
            delta = deltas[offset - 1]
            if not isinstance(delta, int) or delta <= 0:
                raise ValueError('Price definition IDs must increase.')
            identifier += delta
        if not isinstance(state, int) or isinstance(state, bool) or state < 0:
            raise ValueError('Invalid price acquisition status.')
        amount = _positive_price(value)
        rows.append((identifier, amount if state == 0 else None, amount, state))
    return rows


def normalize_player(raw, game_year=None, platform=None):
    """Keep sourced chemistry flags as metadata, without fabricating EA rules."""
    if game_year is not None and raw.get('game') is None:
        raise ValueError('Provider card is missing its game year; season could not be verified.')
    source_year = int(raw['game']) if raw.get('game') is not None else game_year
    if game_year is not None and source_year != game_year:
        raise ValueError(f'Provider returned FC{source_year} data for an FC{game_year} catalog.')
    definition_id = int(raw['eaId'])
    rating = int(raw['overall'])
    if definition_id <= 0 or not 0 <= rating <= 99:
        raise ValueError('Invalid card definition/rating.')
    primary = raw.get('position')
    if isinstance(primary, str):
        primary = POSITIONS.get(primary)
    alternatives = raw.get('alternativePositionIds', raw.get('alternativePositions', [])) or []
    positions = []
    for value in [primary, *alternatives]:
        number = POSITIONS.get(value) if isinstance(value, str) else value
        if number in POSITION_NAMES and number not in positions:
            positions.append(number)
    rarity, club, league, nation = (raw.get(key) or {} for key in ('rarity', 'club', 'league', 'nation'))
    full_name = ' '.join(str(raw.get(key) or '').strip() for key in ('firstName', 'lastName')).strip()
    image = raw.get('cardImageUrl')
    if not image and raw.get('futggCardImagePath'):
        image = 'https://game-assets.fut.gg/' + raw['futggCardImagePath'].lstrip('/')
    return {
        'id': f'concept:{definition_id}', 'definitionId': definition_id,
        'gameYear': source_year, 'platform': platform,
        'assetId': raw.get('basePlayerEaId'), 'name': raw.get('commonName') or raw.get('nickname') or full_name,
        'rating': rating, 'cardType': raw.get('rarityName') or rarity.get('name') or '',
        'teamId': raw.get('uniqueClubEaId') or raw.get('clubEaId', club.get('eaId')),
        'normalizeClubId': raw.get('clubEaId', club.get('eaId')),
        'uniqueClubId': raw.get('uniqueClubEaId'),
        'leagueId': raw.get('leagueEaId', league.get('eaId')),
        'nationId': raw.get('nationEaId', nation.get('eaId')),
        'rarityId': raw.get('rarityEaId'),
        'clubName': (raw.get('uniqueClub') or club).get('name'), 'chemistryClubName': club.get('name'),
        'leagueName': league.get('name'), 'nationName': nation.get('name'),
        'preferredPosition': primary if primary in POSITION_NAMES else None,
        'possiblePositions': positions, 'position': POSITION_NAMES.get(primary),
        'positions': [POSITION_NAMES[value] for value in positions],
        'concept': True, 'catalogSource': SOURCE, 'url': urljoin(SOURCE, raw.get('url') or ''),
        'imageUrl': image, 'isSpecial': rarity.get('isSpecial'),
        'isFullChemistry': raw.get('isFullChemistry'),
        'chemistryMetadata': {key: raw.get(key) for key in ('extraNationChemistry', 'extraLeagueChemistry',
                              'extraClubChemistry', 'extraSquadNationChemistry', 'extraSquadLeagueChemistry')},
    }


class Catalog:
    def __init__(self, data_dir=None, game_year=26, platform='ps5', *, session=None):
        if platform not in ('ps5', 'pc'):
            raise ValueError('Platform must be ps5 or pc.')
        self.game_year = int(game_year)
        if isinstance(game_year, bool) or float(game_year) != self.game_year or not 20 <= self.game_year <= 99:
            raise ValueError('Invalid FC game year.')
        self.platform = platform
        self.data_dir = Path(data_dir or os.environ.get('AUTOSBC_DATA_DIR') or Path(__file__).resolve().parents[1] / 'data')
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / f'catalog-fc{self.game_year}-{platform}.sqlite3'
        self.session = session or requests.Session()
        self.max_price_age_hours = float(os.environ.get('AUTOSBC_PRICE_MAX_AGE_HOURS', '6'))
        with self._connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS cards (
                    definition_id INTEGER PRIMARY KEY, name TEXT NOT NULL, rating INTEGER NOT NULL,
                    payload TEXT NOT NULL, fetched_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS coverage (definition_id INTEGER PRIMARY KEY, band TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS cards_name ON cards(name COLLATE NOCASE);
                CREATE TABLE IF NOT EXISTS prices (
                    definition_id INTEGER PRIMARY KEY, market_price INTEGER,
                    acquisition_price INTEGER, acquisition_state INTEGER NOT NULL,
                    published_at TEXT, fetched_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            ''')
            expected_scope = {'gameYear': self.game_year, 'platform': self.platform}
            stored_scope = self._get_meta(db, 'scope')
            if stored_scope is not None and stored_scope != expected_scope:
                raise ValueError('Catalog file scope does not match the requested game year/platform.')
            old_prices = self._get_meta(db, 'prices', {})
            old_url = old_prices.get('url')
            if old_url and (not urlsplit(old_url).path.startswith(f'/{self.game_year}/') or
                            f'player-prices-{self.platform}-' not in urlsplit(old_url).path):
                raise ValueError('Existing price provenance belongs to a different season/platform.')
            self._set_meta(db, 'scope', expected_scope)

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _get_meta(db, key, default=None):
        row = db.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
        return json.loads(row['value']) if row else default

    @staticmethod
    def _set_meta(db, key, value):
        db.execute('INSERT OR REPLACE INTO metadata VALUES (?, ?)', (key, json.dumps(value)))

    def _stale(self, published_at):
        if not published_at:
            return True
        try:
            parsed = datetime.fromisoformat(published_at.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                return True
            age = (datetime.now(timezone.utc) - parsed).total_seconds()
            return age < -300 or age > self.max_price_age_hours * 3600
        except (TypeError, ValueError, AttributeError):
            return True

    def status(self):
        with self._connect() as db:
            sync = self._get_meta(db, 'sync', {})
            prices = self._get_meta(db, 'prices', {})
            cursor = self._get_meta(db, 'cursor', {})
            count = db.execute('SELECT COUNT(*) FROM cards').fetchone()[0]
            priced = db.execute('SELECT COUNT(*) FROM cards JOIN prices USING(definition_id) WHERE market_price IS NOT NULL').fetchone()[0]
            index_count = db.execute('SELECT COUNT(*) FROM prices').fetchone()[0]
            all_priced = db.execute('SELECT COUNT(*) FROM prices WHERE market_price IS NOT NULL').fetchone()[0]
            available = self._get_meta(db, 'availability', {})
            now = datetime.now(timezone.utc)
            fresh_priced = db.execute('''SELECT COUNT(*) FROM cards JOIN prices USING(definition_id)
                WHERE market_price IS NOT NULL AND julianday(published_at) BETWEEN julianday(?) AND julianday(?)''',
                ((now - timedelta(hours=self.max_price_age_hours)).isoformat(), (now + timedelta(minutes=5)).isoformat())).fetchone()[0]
        complete = bool(cursor) and all(value.get('done') for value in cursor.values())
        count_warnings = [f"Rating band {band}: provider reported {value.get('total', 0)}, returned {value.get('seen', 0)} cards."
                          for band, value in cursor.items() if value.get('done') and value.get('total', 0) != value.get('seen', 0)]
        if not count and available.get('available') is False:
            readiness = 'unavailable'
        elif not count and not prices and not sync:
            readiness = 'not_synced'
        elif not all_priced and (index_count or count):
            readiness = 'awaiting_market_prices'
        elif not count:
            readiness = 'catalog_empty'
        elif not fresh_priced:
            readiness = 'stale_prices'
        else:
            readiness = 'ready' if complete else 'partial_ready'
        return {'count': count, 'pricedCount': priced, 'priceIndexCount': index_count,
                'marketPriceCount': all_priced, 'freshPricedCount': fresh_priced, 'lastSync': sync.get('lastSync'),
                'readiness': readiness, 'readyForConcepts': fresh_priced > 0,
                'sourceCheckedAt': available.get('checkedAt') or prices.get('fetchedAt'),
                'priceMaxAgeHours': self.max_price_age_hours,
                'source': SOURCE, 'gameYear': self.game_year, 'platform': self.platform,
                'complete': complete,
                'completenessScope': 'All results exposed by the public FUT.GG definition search in rating bands 0–99; private/custom club cards are excluded.',
                'reportedTotal': sum(value.get('total', 0) for value in cursor.values()) if cursor else None,
                'observedTotal': sum(value.get('seen', 0) for value in cursor.values()) if cursor else None,
                'sourceTotalsConsistent': not count_warnings if cursor else None, 'sourceCountWarnings': count_warnings,
                'pricesPublishedAt': prices.get('publishedAt'), 'pricesFetchedAt': prices.get('fetchedAt'),
                'pricesStale': self._stale(prices.get('publishedAt')), 'priceSource': prices.get('url'),
                'lastError': sync.get('lastError'), 'pagesFetched': sync.get('pagesFetched', 0),
                'catalogIsClubInventory': False}

    def _price_fields(self, row):
        published = row['published_at']
        stale = self._stale(published)
        return {'gameYear': self.game_year, 'platform': self.platform,
                'priceGameYear': self.game_year, 'pricePlatform': self.platform,
                'quoteReady': row['market_price'] is not None and not stale,
                'marketPrice': row['market_price'], 'futggPrice': row['market_price'],
                'price': row['market_price'], 'acquisitionPrice': row['acquisition_price'],
                'isSbc': row['acquisition_state'] == 1, 'isObjective': row['acquisition_state'] == 2,
                'priceSource': 'FUT.GG', 'priceUpdatedAt': None,
                'priceSnapshotAt': published, 'priceFetchedAt': row['price_fetched_at'], 'priceStale': stale}

    def search(self, query='', limit=50, offset=0):
        limit, offset = min(max(int(limit), 1), 1000), max(int(offset), 0)
        escaped = str(query).replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        with self._connect() as db:
            rows = db.execute('''SELECT c.*, p.market_price, p.acquisition_price, p.acquisition_state,
                      p.published_at, p.fetched_at AS price_fetched_at FROM cards c LEFT JOIN prices p USING(definition_id)
                      WHERE c.name LIKE ? ESCAPE '\\' OR CAST(c.definition_id AS TEXT) = ?
                      ORDER BY c.rating DESC, c.name, c.definition_id LIMIT ? OFFSET ?''',
                      (f'%{escaped}%', str(query), limit, offset)).fetchall()
        return [dict(json.loads(row['payload']), catalogFetchedAt=row['fetched_at'], **self._price_fields(row)) for row in rows]

    def count(self, query=''):
        escaped = str(query).replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        with self._connect() as db:
            return db.execute("SELECT COUNT(*) FROM cards WHERE name LIKE ? ESCAPE '\\' OR CAST(definition_id AS TEXT)=?",
                              (f'%{escaped}%', str(query))).fetchone()[0]

    def definition_records(self, definition_ids):
        """Read exact card metadata without joining cached purchase prices."""
        if not isinstance(definition_ids, list) or len(definition_ids) > 500 or any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in definition_ids):
            raise ValueError('Definition lookup accepts at most 500 positive integer IDs.')
        if not definition_ids:
            return []
        ids = list(dict.fromkeys(definition_ids))
        with self._connect() as db:
            rows = db.execute('SELECT payload FROM cards WHERE definition_id IN (' + ','.join('?' for _ in ids) + ')', ids).fetchall()
        return [json.loads(row['payload']) for row in rows]

    def enrich(self, players):
        """Copy club rows; add only fresh prices. Never overwrite ownership/locks/IDs."""
        enriched = []
        with self._connect() as db:
            for player in players:
                item = dict(player)
                for field in ('gameYear', 'priceGameYear'):
                    value = player.get(field)
                    if value is not None and (isinstance(value, bool) or str(value) != str(self.game_year)):
                        raise ValueError(f'Player {field} differs from FC{self.game_year}; seasons cannot be mixed.')
                for field in ('platform', 'pricePlatform'):
                    if player.get(field) is not None and player[field] != self.platform:
                        raise ValueError(f'Player {field} differs from {self.platform}; market platforms cannot be mixed.')
                if item.get('gameYear') is None:
                    item['gameYear'] = self.game_year
                if item.get('platform') is None:
                    item['platform'] = self.platform
                supplied_stale = owned_price_stale(item)
                if supplied_stale:
                    item['priceStale'] = True
                try:
                    definition_id = int(player.get('definitionId'))
                except (TypeError, ValueError):
                    enriched.append(item)
                    continue
                row = db.execute('SELECT *, fetched_at AS price_fetched_at FROM prices WHERE definition_id=?', (definition_id,)).fetchone()
                if row:
                    fields = self._price_fields(row)
                    # A stale snapshot remains inspectable, but is not an optimizer quote.
                    item['catalogMarketPrice'] = fields['marketPrice']
                    if fields['priceStale']:
                        fields['marketPrice'] = fields['futggPrice'] = None
                    replace_quote = fields['quoteReady'] and (supplied_stale or not any(
                        positive_price(item.get(key)) for key in ('marketPrice', 'futggPrice', 'futBinPrice', 'price')))
                    for key in ('marketPrice', 'futggPrice', 'priceSource', 'priceUpdatedAt', 'priceSnapshotAt', 'priceFetchedAt', 'priceStale', 'priceGameYear', 'pricePlatform', 'quoteReady'):
                        if replace_quote or key not in item or item[key] is None:
                            item[key] = fields[key]
                    if replace_quote:
                        item['marketPriceSource'] = fields['priceSource']
                enriched.append(item)
        return enriched

    def rating_fallbacks(self):
        grouped = {}
        with self._connect() as db:
            rows = db.execute('SELECT rating, market_price, published_at FROM cards JOIN prices USING(definition_id) WHERE market_price IS NOT NULL').fetchall()
        for row in rows:
            if not self._stale(row['published_at']):
                grouped.setdefault(row['rating'], []).append(row['market_price'])
        # Nearest-rank P60 deliberately avoids treating the cheapest example as universal value.
        return {rating: sorted(values)[math.ceil(len(values) * .6) - 1] for rating, values in grouped.items()}

    def concept_candidates(self, sbc, policy, limit=1500, excluded_definition_ids=None):
        """A diverse, explicitly bounded pool from all fresh local market cards.

        This is candidate generation, not proof that the global cheapest squad
        lies in the pool. Ownership, purchases and EA submissions are untouched.
        """
        from collections import Counter, defaultdict
        from .solver_policy import normalize_policy, identifier, is_special
        from .solver_model import normalize_sbc, matches, MATCH_FIELDS, CHEMISTRY_KEYS, chemistry_profile

        policy = normalize_policy(policy)
        sbc = normalize_sbc(sbc)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20000:
            raise ValueError('Concept pool limit must be an integer between 1 and 20000.')
        if excluded_definition_ids is not None and not isinstance(excluded_definition_ids, (list, tuple, set, frozenset)):
            raise ValueError('excluded_definition_ids must be a list of owned definition IDs.')
        excluded_definitions = set()
        for value in excluded_definition_ids or []:
            if isinstance(value, bool):
                raise ValueError('Owned definition IDs must be positive integers.')
            try:
                number = int(value)
                if number <= 0 or float(value) != number:
                    raise ValueError
            except (TypeError, ValueError, OverflowError):
                raise ValueError('Owned definition IDs must be positive integers.') from None
            excluded_definitions.add(number)
        exclusions, eligible = Counter(), []
        needs_groups = any(req['requirementKey'] == 'PLAYER_RARITY_GROUP' for req in sbc['constraints'])
        needs_chemistry = any(req['requirementKey'] in CHEMISTRY_KEYS for req in sbc['constraints'])
        with self._connect() as db:
            rows = db.execute('''SELECT c.*, p.market_price, p.acquisition_price, p.acquisition_state,
                        p.published_at, p.fetched_at AS price_fetched_at
                        FROM cards c LEFT JOIN prices p USING(definition_id)''').fetchall()
        for row in rows:
            player = dict(json.loads(row['payload']), catalogFetchedAt=row['fetched_at'], **self._price_fields(row))
            reason = None
            if not policy['allowConcept']:
                reason = 'conceptsDisabled'
            elif player['definitionId'] in excluded_definitions:
                reason = 'alreadyOwnedDefinition'
            elif player['marketPrice'] is None or player['priceStale']:
                reason = 'missingOrStaleMarketQuote'
            elif policy['onlyStorage']:
                reason = 'storageOnly'
            elif policy['protectSpecial'] and is_special(player):
                reason = 'specialProtection'
            elif policy['protectEvolutions'] and player['rarityId'] == 60:
                reason = 'evolutionProtection'
            elif player['rating'] < policy.get('minRating', 0) or player['rating'] > policy.get('maxRating', 99):
                reason = 'ratingLimit'
            elif any(identifier(player[field]) in policy[f'locked{name}Ids'] for field, name in
                     (('id', 'Item'), ('assetId', 'Asset'), ('definitionId', 'Definition'))):
                reason = 'lockedIdentity'
            elif any(identifier(player[field]) in policy.get(key, []) for field, key in
                     (('nationId', 'lockedNationIds'), ('teamId', 'lockedTeamIds'),
                      ('leagueId', 'lockedLeagueIds'), ('rarityId', 'lockedRarityIds'))):
                reason = 'lockedCategory'
            elif any(player['marketPrice'] > policy[key] for key in ('maxPlayerPrice', 'maxTotalPrice') if key in policy):
                reason = 'priceLimit'
            elif needs_groups and ('groups' not in player or player.get('rarityGroupsKnown') is False):
                reason = 'unknownRarityGroups'
            elif needs_chemistry and chemistry_profile(player) is None:
                reason = 'unsupportedChemistryProfile'
            if reason:
                exclusions[reason] += 1
                continue
            player['rarityGroupsKnown'] = 'groups' in player and player.get('rarityGroupsKnown') is not False
            player['ratingTier'] = 1 if player['rating'] < 65 else 2 if player['rating'] < 75 else 3
            eligible.append(player)
        eligible.sort(key=lambda player: (player['marketPrice'], player['rating'], player['definitionId']))
        selected = {}
        def add(items, count):
            used, athletes = 0, set()
            # Within a bucket prefer distinct athletes before alternative card versions.
            deferred = []
            for player in items:
                if player['definitionId'] in selected:
                    continue
                if player['assetId'] in athletes:
                    deferred.append(player)
                    continue
                athletes.add(player['assetId'])
                selected[player['definitionId']] = player
                used += 1
                if used >= count or len(selected) >= limit:
                    return
            for player in deferred:
                if used >= count or len(selected) >= limit:
                    return
                selected[player['definitionId']] = player
                used += 1
        def spread(buckets, budget):
            start = len(selected)
            queues = [iter(bucket) for bucket in buckets if bucket]
            if len(queues) > budget:
                indexes = [len(queues) // 2] if budget == 1 else [round(index * (len(queues) - 1) / (budget - 1)) for index in range(budget)]
                queues = [queues[index] for index in indexes]
            while queues and len(selected) < limit and len(selected) - start < budget:
                remaining = []
                for queue in queues:
                    for player in queue:
                        if player['definitionId'] not in selected:
                            selected[player['definitionId']] = player
                            remaining.append(queue)
                            break
                    if len(selected) >= limit or len(selected) - start >= budget:
                        return
                queues = remaining

        required = [player for player in eligible if any(identifier(player[field]) in policy[f'required{name}Ids']
                    for field, name in (('id', 'Item'), ('assetId', 'Asset'), ('definitionId', 'Definition')))]
        add(required, limit)
        # Preserve enough cheap witnesses for each explicit count/identity condition.
        for req in sbc['constraints']:
            if len(selected) >= limit:
                break
            key = req['requirementKey']
            if key in MATCH_FIELDS or key in ('PLAYER_MIN_OVR', 'PLAYER_MAX_OVR', 'PLAYER_QUALITY', 'PLAYER_RARITY_GROUP'):
                bucket = [player for player in eligible if matches(player, req)]
                add(bucket, min(33, max(11, req['count'] * 2)))
            elif key == 'TEAM_RATING':
                target = req['eligibilityValues'][0]
                for rating in range(max(1, target - 3), min(99, target + 3) + 1):
                    if len(selected) >= limit:
                        break
                    add((player for player in eligible if player['rating'] == rating), 11)
        if needs_chemistry:
            # Coherent club/league blocks complement single-card attribute diversity.
            for field in ('normalizeClubId', 'leagueId'):
                buckets = defaultdict(list)
                for player in eligible:
                    buckets[player.get(field) or player['teamId']].append(player)
                ranked = sorted(buckets.values(), key=lambda bucket: (-min(len(bucket), 11),
                                sum(player['marketPrice'] for player in bucket[:11])))
                for bucket in ranked[:max(1, min(8, limit // 100))]:
                    if len(selected) >= limit:
                        break
                    add(bucket, 11)
        for field, fraction in (('rating', .25), ('possiblePositions', .15), ('leagueId', .15),
                                ('nationId', .1), ('teamId', .1)):
            if len(selected) >= limit:
                break
            buckets = defaultdict(list)
            for player in eligible:
                keys = player[field] if field == 'possiblePositions' else [player[field]]
                for key in keys:
                    buckets[key].append(player)
            ordered = [buckets[key] for key in sorted(buckets)] if field == 'rating' else sorted(buckets.values(), key=lambda bucket: (bucket[0]['marketPrice'], -len(bucket)))
            spread(ordered, max(1, int(limit * fraction)))
        if len(selected) < limit:
            add(eligible, limit - len(selected))
        players = list(selected.values())
        unavailable_required = {}
        for field, name in (('id', 'Item'), ('assetId', 'Asset'), ('definitionId', 'Definition')):
            available = {identifier(player[field]) for player in players}
            missing = sorted(set(policy[f'required{name}Ids']) - available)
            if missing:
                unavailable_required[field] = missing
        state = self.status()
        complete = len(players) == len(eligible)
        return {'players': players, 'coverage': {
            'returned': len(players), 'totalEligible': len(eligible), 'complete': complete,
            'limit': limit, 'selection': 'diverse-local-market-pool',
            'priceBasis': 'fresh market quotes only', 'excludedCounts': dict(exclusions),
            'catalogCount': state['count'], 'catalogComplete': state['complete'],
            'pricesPublishedAt': state['pricesPublishedAt'], 'pricesFetchedAt': state['pricesFetchedAt'],
            'gameYear': self.game_year, 'platform': self.platform, 'readiness': state['readiness'],
            'priceIndexCount': state['priceIndexCount'], 'freshPricedCount': state['freshPricedCount'],
            'sourceCountWarnings': state['sourceCountWarnings'],
            'excludedOwnedDefinitionCount': exclusions.get('alreadyOwnedDefinition', 0),
            'requiredIdsNotInConceptPool': unavailable_required,
            'optimalityScope': 'All locally eligible quoted concepts' if complete else 'Selected concept pool only; global cheapest squad is not established',
        }}

    def csv_text(self):
        stream = io.StringIO(newline='')
        writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS, extrasaction='ignore')
        writer.writeheader()
        offset = 0
        while True:
            players = self.search(limit=1000, offset=offset)
            if not players:
                break
            for index, player in enumerate(players, start=offset):
                row = dict(player)
                row.update({'': index, 'concept': 'True', 'possiblePositions': '|'.join(map(str, player['possiblePositions']))})
                # Do not fabricate rarity groups, chemistry contribution types or ownership.
                if player['priceStale']:
                    row['price'] = row['futggPrice'] = None
                writer.writerow(row)
            offset += len(players)
        return stream.getvalue()

    def _fetch(self, url, params=None, *, timeout=(10, 45)):
        response = self.session.get(url, params=params, timeout=timeout,
                                    headers={'User-Agent': 'Auto-SBC-Local-Catalog/1.0', 'Accept': 'application/json'})
        # No retries/challenge solving/alternate hosts on access denials or rate limiting.
        if response.status_code in (401, 403, 429):
            raise RuntimeError(f'FUT.GG returned HTTP {response.status_code}; sync stopped without bypass or retry.')
        response.raise_for_status()
        return response.json()

    def _sync_prices_unlocked(self, *, timeout=(10, 45)):
        """Exactly three fixed public requests; no club data or card-page crawl."""
        manifest_url = f'https://r2.fut.gg/{self.game_year}/manifest.json'
        manifest = self._fetch(manifest_url, timeout=timeout)
        if not isinstance(manifest, dict):
            raise ValueError('Invalid public CDN manifest.')
        published_at = manifest.get('_published_at') or {}
        if not isinstance(published_at, dict):
            raise ValueError('Invalid public CDN publication metadata.')
        with self._connect() as db:
            self._set_meta(db, 'availability', {'available': True, 'checkedAt': _now(), 'manifestUrl': manifest_url})
        def cdn(key):
            version, token = manifest.get('_version'), manifest.get(key)
            if not isinstance(version, int) or not isinstance(token, str) or not token.isalnum():
                raise ValueError(f'Invalid public CDN manifest entry: {key}')
            return f'https://r2.fut.gg/{self.game_year}/{key}.v{version}.{token}.json'
        index_url = cdn('player-prices-index')
        price_key = f'player-prices-{self.platform}-dyn'
        price_url = cdn(price_key)
        prices = decode_prices(self._fetch(index_url, timeout=timeout), self._fetch(price_url, timeout=timeout))
        published = _iso_timestamp(published_at.get(price_key))
        fetched = _now()
        with self._connect() as db:
            db.execute('DELETE FROM prices')
            db.executemany('INSERT INTO prices VALUES (?, ?, ?, ?, ?, ?)', [(*row, published, fetched) for row in prices])
            self._set_meta(db, 'prices', {'url': price_url, 'indexUrl': index_url, 'manifestUrl': manifest_url,
                                        'publishedAt': published, 'fetchedAt': fetched})

    def refresh_prices_if_stale(self):
        """One optional bulk refresh, sharing the manual-sync lock and cooldown.

        Failed attempts are also persisted so subsequent daily cycles and
        separate service processes cannot repeatedly hit an unavailable source.
        Existing prices are only replaced after the complete snapshot validates.
        """
        def report(state, attempted=False, **extra):
            current = self.status()
            return {'state': state, 'attempted': attempted,
                    'pricesPublishedAt': current['pricesPublishedAt'], **extra}
        def current_prices():
            current = self.status()
            return not current['pricesStale'] and current['marketPriceCount'] > 0
        if current_prices():
            return report('fresh')
        with self.path.with_suffix('.sync.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return report('busy')
            try:
                if current_prices():
                    return report('fresh')
                now = time.time()
                with self._connect() as db:
                    previous = self._get_meta(db, 'priceRefresh', {})
                    attempted_at = previous.get('attemptedAt')
                    if type(attempted_at) in (int, float) and math.isfinite(attempted_at):
                        elapsed = now - attempted_at
                        if elapsed < PRICE_REFRESH_COOLDOWN_SECONDS:
                            return report('cooldown', cooldownSeconds=math.ceil(min(PRICE_REFRESH_COOLDOWN_SECONDS,
                                          PRICE_REFRESH_COOLDOWN_SECONDS - elapsed)))
                    self._set_meta(db, 'priceRefresh', {'attemptedAt': now, 'state': 'refreshing'})
                try:
                    self._sync_prices_unlocked(timeout=PRICE_REFRESH_TIMEOUT)
                    current = self.status()
                    state = 'refreshed' if current_prices() else 'stale' if current['marketPriceCount'] else 'missing'
                    result = report(state, True)
                except (requests.RequestException, ValueError, KeyError, TypeError, RuntimeError, OverflowError, OSError):
                    result = report('failed', True, errorCode='PUBLIC_PRICE_REFRESH_FAILED')
                with self._connect() as db:
                    self._set_meta(db, 'priceRefresh', {'attemptedAt': now, **result})
                return result
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def sync(self, max_pages=10):
        """Refresh bulk prices and resume paced public card pages (maximum 1,000)."""
        with self.path.with_suffix('.sync.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError('A catalog sync is already running for this game/platform.') from error
            try:
                return self._sync_unlocked(max_pages)
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def _sync_unlocked(self, max_pages):
        max_pages = int(max_pages)
        if not 0 <= max_pages <= 1000:
            raise ValueError('max_pages must be between 0 and 1000.')
        started = time.monotonic()
        max_seconds = max(5, min(float(os.environ.get('AUTOSBC_SYNC_MAX_SECONDS', '900')), 3600))
        pace = max(.1, min(float(os.environ.get('AUTOSBC_SYNC_DELAY_SECONDS', '.35')), 10))
        pages_fetched = 0
        try:
            self._sync_prices_unlocked()
            with self._connect() as db:
                cursor = self._get_meta(db, 'cursor', {})
            if not cursor:
                cursor = {f'{low}-{high}': {'page': 1, 'done': False, 'total': 0, 'seen': 0} for low, high in BANDS}
            # Explicit sync after a completed pass starts another pass to pick up new releases.
            if max_pages and all(value.get('done') for value in cursor.values()):
                cursor = {f'{low}-{high}': {'page': 1, 'done': False, 'total': 0, 'seen': 0} for low, high in BANDS}
                with self._connect() as db:
                    db.execute('DELETE FROM coverage')
                    self._set_meta(db, 'cursor', cursor)
            while pages_fetched < max_pages and time.monotonic() - started < max_seconds:
                pending = [tuple(map(int, key.split('-'))) for key, value in cursor.items() if not value['done']]
                if not pending:
                    break
                for low, high in pending:
                    if pages_fetched >= max_pages or time.monotonic() - started >= max_seconds:
                        break
                    key, state = f'{low}-{high}', cursor[f'{low}-{high}']
                    time.sleep(pace)
                    url = f'https://www.fut.gg/api/fut/players/v2/{self.game_year}/definitions/'
                    result = self._fetch(url, {'page': state['page'], 'count': PAGE_SIZE,
                                              'overall__gte': low, 'overall__lte': high})
                    raw_players = result.get('data')
                    if not isinstance(raw_players, list):
                        raise ValueError('Player API returned an unexpected format.')
                    total = int(result.get('total', 0))
                    if total >= 10000:
                        if low == high:
                            raise ValueError(f'Rating {low} reached the provider result cap; completeness cannot be claimed.')
                        middle = (low + high) // 2
                        del cursor[key]
                        for band_low, band_high in ((low, middle), (middle + 1, high)):
                            cursor[f'{band_low}-{band_high}'] = {'page': 1, 'done': False, 'total': 0, 'seen': 0}
                        with self._connect() as db:
                            self._set_meta(db, 'cursor', cursor)
                        pages_fetched += 1
                        continue
                    normalized = [normalize_player(raw, self.game_year, self.platform) for raw in raw_players]
                    if any(not low <= player['rating'] <= high for player in normalized):
                        raise ValueError('Provider did not honor the rating-band filter.')
                    next_page = result.get('next')
                    if next_page is not None and (not isinstance(next_page, int) or next_page <= state['page']):
                        raise ValueError('Invalid pagination cursor from provider.')
                    if not raw_players and next_page is not None:
                        raise ValueError('Empty player page has a continuation cursor.')
                    state.update({'total': total, 'seen': state['seen'] + len(normalized),
                                  'page': next_page or state['page'], 'done': next_page is None})
                    if state['done'] and state['seen'] < total:
                        raise ValueError('Provider pagination ended before its reported total.')
                    fetched = _now()
                    with self._connect() as db:
                        db.executemany('INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?)',
                                       [(player['definitionId'], player['name'], player['rating'], json.dumps(player), fetched) for player in normalized])
                        db.executemany('INSERT OR REPLACE INTO coverage VALUES (?, ?)',
                                       [(player['definitionId'], key) for player in normalized])
                        # Cached rows from earlier resumable batches are also valid coverage.
                        cached_coverage = db.execute('SELECT COUNT(*) FROM cards WHERE rating BETWEEN ? AND ?', (low, high)).fetchone()[0]
                        if state['done'] and cached_coverage < total:
                            raise ValueError(f'Rating band {key} contains missing/duplicate results; rerun required.')
                        self._set_meta(db, 'cursor', cursor)
                        self._set_meta(db, 'sync', {'lastSync': fetched, 'lastError': None, 'pagesFetched': pages_fetched + 1})
                    pages_fetched += 1
            with self._connect() as db:
                self._set_meta(db, 'sync', {'lastSync': _now(), 'lastError': None, 'pagesFetched': pages_fetched})
        except (requests.RequestException, ValueError, KeyError, TypeError, RuntimeError) as error:
            with self._connect() as db:
                if isinstance(error, requests.HTTPError) and error.response is not None and error.response.status_code == 404:
                    self._set_meta(db, 'availability', {'available': False, 'checkedAt': _now(), 'status': 404, 'gameYear': self.game_year, 'platform': self.platform})
                prior = self._get_meta(db, 'sync', {})
                self._set_meta(db, 'sync', {**prior, 'lastError': str(error), 'pagesFetched': pages_fetched})
            raise
        return self.status()
