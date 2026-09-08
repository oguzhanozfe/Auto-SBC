/* Auto-SBC Local — pure policy and response validation, MIT. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoSBCPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const key = value => String(value ?? '');
  const list = value => Array.isArray(value) ? value : [];
  const ids = value => new Set(list(value).map(key));
  const has = (values, value) => ids(values).has(key(value));
  const bool = value => value === true || value === 'true' || value === 1;
  const defaults = Object.freeze({
    allowTradeable: true, allowConcept: true, protectSpecial: true,
    protectEvolutions: true, prioritizeDuplicates: true, onlyStorage: false,
    maxRating: 89, maxPlayerPrice: 100000, maxTotalPrice: 0, maxPurchasePrice: 0,
    weights: { duplicateUntradeable: 0.1, untradeable: 0.7, tradeable: 1, concept: 2 },
    lockedItemIds: [], lockedAssetIds: [], lockedDefinitionIds: [],
    lockedNationIds: [], lockedTeamIds: [], lockedLeagueIds: [], lockedRarityIds: [],
    requiredItemIds: [], requiredAssetIds: []
  });
  function normalizePolicy(input = {}) {
    const policy = { ...defaults, ...input, weights: { ...defaults.weights, ...input.weights } };
    for (const field of ['lockedItemIds','lockedAssetIds','lockedDefinitionIds','lockedNationIds','lockedTeamIds','lockedLeagueIds','lockedRarityIds','requiredItemIds','requiredAssetIds']) {
      policy[field] = [...ids(policy[field])];
    }
    for (const field of ['maxRating','maxPlayerPrice','maxTotalPrice','maxPurchasePrice']) {
      if (!Number.isFinite(Number(policy[field])) || Number(policy[field]) < 0) throw new Error(`${field}: invalid number`);
      policy[field] = Number(policy[field]);
    }
    if (policy.maxRating < 1 || policy.maxRating > 99) throw new Error('Maximum rating must be 1–99.');
    for (const [field, value] of Object.entries(policy.weights)) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) throw new Error(`${field}: invalid weight`);
      policy.weights[field] = Number(value);
    }
    return policy;
  }
  function blockedReason(player, policy, pale = {}) {
    if (!player || !key(player.id)) return 'Missing item ID';
    if (bool(player.isLocked) || has(policy.lockedItemIds, player.id) ||
        has(policy.lockedAssetIds, player.assetId) || has(policy.lockedDefinitionIds, player.definitionId) ||
        has(policy.lockedNationIds, player.nationId) || has(policy.lockedTeamIds, player.teamId) ||
        has(policy.lockedLeagueIds, player.leagueId) || has(policy.lockedRarityIds, player.rarityId)) return 'Locked player';
    // Paletools uses definitionId, with a u suffix for evolved versions.
    if (has(pale.definitionIds, player.definitionId) ||
        (player.isEvolution && has(pale.definitionIds, `${player.definitionId}u`)) ||
        has(pale.nationIds, player.nationId) || has(pale.teamIds, player.teamId) ||
        has(pale.leagueIds, player.leagueId) || has(pale.rarityIds, player.rarityId)) return 'Paletools lock';
    if (bool(player.isLoan) || bool(player.isTimeLimited)) return 'Loan or time-limited player';
    if (bool(player.concept) && !policy.allowConcept) return 'Concept player';
    if (bool(player.isEvolution) && policy.protectEvolutions) return 'Protected evolution';
    if (bool(player.isSpecial) && policy.protectSpecial) return 'Protected special card';
    if (!bool(player.concept) && !bool(player.isUntradeable) && !policy.allowTradeable) return 'Tradeable player';
    if (policy.onlyStorage && !bool(player.isStorage)) return 'Outside SBC storage';
    if (Number(player.rating) > policy.maxRating) return 'Above maximum rating';
    const market = Number(player.marketPrice ?? player.futggPrice);
    if (policy.maxPlayerPrice > 0 && market > policy.maxPlayerPrice) return 'Above player price limit';
    return null;
  }
  function parsePaletools(entries, decode = value => atob(value)) {
    const result = { definitionIds: [], nationIds: [], teamIds: [], leagueIds: [], rarityIds: [], detected: false, warnings: [] };
    for (const [name, raw] of entries) {
      if (!name.startsWith('paletools:')) continue;
      result.detected = true;
      if (name.endsWith(':lockedItems')) {
        try {
          const values = JSON.parse(raw);
          if (!Array.isArray(values)) throw new Error('Expected lock list');
          result.definitionIds.push(...values.map(key));
        } catch { result.warnings.push(`Cannot read Paletools lock list: ${name}`); }
      }
      if (name === 'paletools:settings') {
        let settings;
        try { settings = JSON.parse(raw); }
        catch { try { settings = JSON.parse(decode(raw)); } catch { result.warnings.push('Cannot read Paletools lock rules.'); } }
        const visit = (value, depth = 0) => {
          if (!value || typeof value !== 'object' || depth > 12) return;
          for (const [field, target] of [['lockByNationIds','nationIds'],['lockByTeamIds','teamIds'],['lockByLeagueIds','leagueIds'],['lockByRarityIds','rarityIds']]) {
            result[target].push(...list(value[field]).map(key));
          }
          Object.values(value).forEach(child => visit(child, depth + 1));
        };
        visit(settings);
      }
    }
    // Conservatively combine saved accounts and retain explicit locks even if a
    // Paletools override temporarily unlocks them. Never write Paletools storage.
    for (const field of ['definitionIds','nationIds','teamIds','leagueIds','rarityIds']) result[field] = [...ids(result[field])];
    return result;
  }
  function errorMessage(body, status) {
    const detail = body?.detail ?? body?.error ?? body?.status ?? body?.message;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map(entry => typeof entry === 'string' ? entry : entry.msg || JSON.stringify(entry)).join('; ');
    if (detail && typeof detail === 'object') return detail.message || JSON.stringify(detail);
    return `Local solver returned HTTP ${status || 'error'}.`;
  }
  function validateConcept(candidate, input, response, now = Date.now()) {
    const scope = { gameYear: Number(input.gameYear), platform: input.platform };
    if (![26,27].includes(scope.gameYear) || !['ps5','pc'].includes(scope.platform)) throw new Error('Concept prices need an explicit game season and platform.');
    if (candidate.concept !== true || key(candidate.id) !== `concept:${candidate.definitionId}` ||
        !Number.isFinite(Number(candidate.assetId)) || Number(candidate.assetId) <= 0) throw new Error('Invalid server catalog concept identity.');
    if (Number(candidate.gameYear) !== scope.gameYear || candidate.platform !== scope.platform ||
        Number(candidate.priceGameYear) !== scope.gameYear || candidate.pricePlatform !== scope.platform) throw new Error('Concept quote belongs to another season or platform.');
    const market = Number(candidate.marketPrice);
    const snapshot = Date.parse(candidate.priceSnapshotAt), fetched = Date.parse(candidate.priceFetchedAt);
    if (candidate.priceSource === 'EA Transfer Market' || input.liveMarket) {
      const observation = input.liveMarket;
      const observed = Date.parse(observation?.observedAt), expiry = Date.parse(candidate.liveQuoteExpiresAt);
      const quote = list(observation?.quotes).filter(item => key(item.definitionId) === key(candidate.definitionId));
      if (candidate.priceSource !== 'EA Transfer Market' || Number(observation?.gameYear) !== scope.gameYear || observation?.platform !== scope.platform ||
          quote.length !== 1 || Number(quote[0].buyNowPrice) !== market || market > Number(observation?.searchMaxBuy) ||
          !Number.isFinite(observed) || observed !== snapshot || fetched !== observed ||
          !Number.isFinite(expiry) || expiry <= now || expiry <= observed || expiry > observed + 120000 ||
          observed > now + 5000 || now - observed > 120000) {
        throw new Error('EA live quote expired or differs from the observed market search. Run a fresh live search.');
      }
    }
    const hours = Number(response.database?.priceMaxAgeHours ?? 6);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Invalid market-price freshness policy.');
    if (candidate.priceStale !== false || !Number.isFinite(market) || market <= 0 ||
        !candidate.priceSource || !candidate.catalogSource || bool(candidate.isSbc) || bool(candidate.isObjective) || bool(candidate.isExtinct) ||
        !Number.isFinite(snapshot) || !Number.isFinite(fetched) || snapshot > now + 300000 || fetched > now + 300000 ||
        now - snapshot > hours * 3600000) throw new Error('Concept requires a fresh, positive market quote with source timestamps.');
    return { ...candidate, isSpecial: bool(candidate.isSpecial) || Number(candidate.rarityId) > 1, concept: true };
  }
  function validateSolution(response, input, policy, pale = {}) {
    if (![2,4].includes(Number(response?.status_code))) throw new Error(errorMessage(response));
    let rows = response.solution;
    if (!Array.isArray(rows)) {
      try { rows = typeof response.results === 'string' ? JSON.parse(response.results) : response.results; }
      catch { throw new Error('Solver returned malformed squad data.'); }
    }
    if (!Array.isArray(rows)) throw new Error('Solver returned no squad.');
    const formation = input.sbcData.formation;
    const bricks = new Set(input.sbcData.brickIndices || []);
    const free = formation.map((_, i) => i).filter(i => !bricks.has(i) && formation[i] !== -1);
    if (rows.length !== free.length) throw new Error(`Squad has ${rows.length} players; ${free.length} are required.`);
    // Uploaded concepts never establish ownership or prove a current quote.
    const candidates = new Map(input.clubPlayers.filter(player => !bool(player.concept)).map(player => [key(player.id), player]));
    for (const raw of list(response.conceptCandidates)) {
      const candidate = validateConcept(raw, input, response);
      if (candidates.has(key(candidate.id))) throw new Error('Repeated server catalog concept identity.');
      candidates.set(key(candidate.id), candidate);
    }
    const seenItems = new Set(), seenAssets = new Set(), seenSlots = new Set();
    let totalMarket = 0, purchaseCost = 0, unknownMarket = false;
    const checked = rows.map(row => {
      const player = candidates.get(key(row.id));
      if (!player) throw new Error(`Unknown player in response: ${row.id}`);
      if (bool(row.concept) !== bool(player.concept)) throw new Error('Response changed player ownership.');
      if (player.concept && (key(row.definitionId) !== key(player.definitionId) || key(row.assetId) !== key(player.assetId) ||
          Number(row.marketPrice) !== Number(player.marketPrice) || row.marketPriceSource !== player.priceSource ||
          Number(row.gameYear) !== Number(input.gameYear) || row.platform !== input.platform)) throw new Error('Concept quote or identity differs from the verified catalog card.');
      const blocked = blockedReason(player, policy, pale);
      if (blocked) throw new Error(`${player.name || player.id}: ${blocked}`);
      if (seenItems.has(key(player.id))) throw new Error('Response repeats an inventory item.');
      seenItems.add(key(player.id));
      if (player.assetId && seenAssets.has(key(player.assetId))) throw new Error('Response repeats the same athlete.');
      if (player.assetId) seenAssets.add(key(player.assetId));
      const market = Number(row.marketPrice ?? row.futggPrice ?? player.marketPrice ?? player.futggPrice);
      if (Number.isFinite(market) && market > 0) {
        totalMarket += market;
        if (player.concept) purchaseCost += market;
        if (policy.maxPlayerPrice > 0 && market > policy.maxPlayerPrice) throw new Error('Response exceeds the player price limit.');
      } else unknownMarket = true;
      let slot = row.squadPosition;
      if (slot !== undefined) {
        slot = Number(slot);
        if (!Number.isInteger(slot) || !free.includes(slot) || seenSlots.has(slot)) throw new Error('Invalid or repeated squad position.');
        seenSlots.add(slot);
      }
      return { ...row, player, squadPosition: slot };
    });
    if (policy.maxTotalPrice > 0 && (unknownMarket || totalMarket > policy.maxTotalPrice)) throw new Error('Response exceeds the squad budget or has unknown prices.');
    if (policy.maxPurchasePrice > 0 && purchaseCost > policy.maxPurchasePrice) throw new Error('Response exceeds the market purchase budget.');
    // Legacy positional responses: place restricted (in-position) cards first.
    checked.filter(row => row.squadPosition === undefined).sort((a,b) => Number(b.Is_Pos) - Number(a.Is_Pos)).forEach(row => {
      const slots = free.filter(slot => !seenSlots.has(slot));
      const position = Number(row.possiblePositions);
      const slot = slots.find(slot => !Number(row.Is_Pos) || Number(formation[slot]) === position);
      if (slot === undefined) throw new Error('Solver positions do not match the challenge formation.');
      row.squadPosition = slot;
      seenSlots.add(slot);
    });
    for (const id of policy.requiredItemIds) if (!seenItems.has(key(id))) throw new Error('Required inventory item is missing.');
    for (const id of policy.requiredAssetIds) if (!seenAssets.has(key(id))) throw new Error('Required athlete is missing.');
    const concepts = checked.filter(row => row.player.concept);
    if (list(response.conceptCandidates).length !== concepts.length) throw new Error('Catalog proof contains unselected concept cards.');
    if (concepts.length) {
      const shopping = list(response.shoppingList);
      if (shopping.length !== concepts.length) throw new Error('Shopping list does not match the selected concept cards.');
      for (const row of concepts) {
        const matches = shopping.filter(item => key(item.definitionId) === key(row.player.definitionId));
        const item = matches[0];
        if (matches.length !== 1 || Number(item.quantity) !== 1 || Number(item.marketPrice) !== Number(row.player.marketPrice) ||
            key(item.assetId) !== key(row.player.assetId) || Number(item.squadPosition) !== row.squadPosition ||
            Number(item.gameYear) !== Number(input.gameYear) || item.platform !== input.platform ||
            item.source !== row.player.priceSource || item.priceSnapshotAt !== row.player.priceSnapshotAt ||
            item.priceFetchedAt !== row.player.priceFetchedAt) throw new Error('Shopping list quote, quantity or season does not match the selected cards.');
      }
      if (response.summary?.purchaseCost !== undefined && Number(response.summary.purchaseCost) !== purchaseCost) throw new Error('Shopping list purchase total is inconsistent.');
    }
    return checked.sort((a,b) => a.squadPosition - b.squadPosition);
  }
  return { defaults, normalizePolicy, blockedReason, parsePaletools, validateConcept, validateSolution, errorMessage };
});
