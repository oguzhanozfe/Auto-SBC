/* Auto-SBC Local. EA adapter adapted from TitiroMonkey's MIT Auto-SBC.
 * This panel makes no submissions, purchases, pack or inventory-move requests.
 */
(function () {
  'use strict';
  if (window.__autoSBCLocalLoaded) return;
  window.__autoSBCLocalLoaded = true;
  const P = window.AutoSBCPolicy;
  const BASE = 'http://127.0.0.1:8000';
  const STORAGE = 'autosbc.local.policy.v1';
  const SCOPE_STORAGE = 'autosbc.local.scope.v1';
  const state = { busy: false, sets: [], challenges: [], preview: null, input: null, cancel: 0, backendScope: null, nativeActive: null };

  function http(path, method = 'GET', data, timeout = 15000) {
    if (!['/health','/api/solve/jobs'].includes(path.split('?')[0]) && !/^\/api\/solve\/jobs\/[a-zA-Z0-9-]+$/.test(path)) throw new Error('Unsupported local endpoint.');
    // The extension's isolated bridge avoids EA's page CSP for localhost requests.
    if (window.__autoSBCExtension) return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Local solver request timed out.')); }, timeout);
      const receive = event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'autosbc-local-response' || event.data.id !== id) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        if (event.data.error) reject(new Error(event.data.error));
        else if (!event.data.ok) reject(new Error(P.errorMessage(event.data.body, event.data.status)));
        else resolve(event.data.body);
      };
      window.addEventListener('message', receive);
      window.postMessage({ source: 'autosbc-local-request', id, path, method, data, timeout }, location.origin);
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
      body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal
    }).then(async response => {
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { throw new Error('Local solver returned a non-JSON response.'); }
      if (!response.ok) throw new Error(P.errorMessage(body, response.status));
      return body;
    }).catch(error => {
      if (error.name === 'AbortError') throw new Error('Local solver request timed out.');
      if (error instanceof TypeError) throw new Error('Cannot reach the local solver. Start the local server; if EA blocks access, use the bundled Chrome extension.');
      throw error;
    }).finally(() => clearTimeout(timer));
  }

  function observe(request, label) {
    return new Promise((resolve, reject) => {
      if (!request || typeof request.observe !== 'function') { reject(new Error(`${label}: EA adapter unavailable.`)); return; }
      const owner = {};
      const timer = setTimeout(() => { request.unobserve?.(owner); reject(new Error(`${label}: EA did not respond within 20 seconds.`)); }, 20000);
      request.observe(owner, (sender, result) => {
        clearTimeout(timer); request.unobserve?.(owner);
        if (!result || result.success === false || (result.status >= 400)) {
          reject(new Error(`${label}: EA returned ${result?.status || result?.error?.code || 'an error'}.`)); return;
        }
        resolve(result.data ?? result.response ?? result);
      });
    });
  }
  function ready() {
    return typeof services !== 'undefined' && services.SBC && services.Club && services.Item &&
      typeof UTBucketedItemSearchViewModel !== 'undefined' && typeof UTSBCSquadOverviewViewController !== 'undefined';
  }
  function activeChallengeContext() {
    try {
      if (!ready() || typeof getAppMain !== 'function') return null;
      // This controller path and _challenge are from the MIT upstream adapter.
      const current = getAppMain().getRootViewController().getPresentedViewController().getCurrentViewController();
      const challenge = current.getCurrentController().childViewControllers?.[0]?._challenge;
      if (!challenge || !challenge.id || !challenge.setId || challenge.status === 'COMPLETED' ||
          !Array.isArray(challenge.eligibilityRequirements) || !Array.isArray(challenge.squad?._formation?.generalPositions) ||
          !challenge.squad._formation.generalPositions.length) return null;
      return { setId: challenge.setId, challengeId: challenge.id };
    } catch { return null; }
  }
  function assertNativeContext(context) {
    if (!context) return;
    const current = activeChallengeContext();
    if (!current || String(current.setId) !== String(context.setId) || String(current.challengeId) !== String(context.challengeId)) {
      throw new Error('SBC ekranı değişti. Eski görevin çözümü uygulanmadı; açık görev için yeniden çözün.');
    }
  }
  async function pages(storage) {
    if (!storage) {
      // The upstream EA adapter refreshes club statistics before every inventory
      // traversal. Otherwise a second traversal can return the already cached
      // cumulative item list without advancing its retrieval flags.
      if (typeof services.Club.clubDao?.resetStatsCache !== 'function' || typeof services.Club.getStats !== 'function') {
        throw new Error('Club cache refresh: EA adapter unavailable. Nothing was applied.');
      }
      services.Club.clubDao.resetStatsCache();
      const refreshed = services.Club.getStats();
      if (refreshed && typeof refreshed.observe === 'function') await observe(refreshed, 'Refresh club statistics');
    }
    const found = new Map();
    for (let offset = 0, page = 0; page < 500; page++, offset += 91) {
      const criteria = new UTBucketedItemSearchViewModel().searchCriteria;
      criteria.count = 91; criteria.offset = offset;
      const response = await observe(storage ? services.Item.searchStorageItems(criteria) : services.Club.search(criteria), storage ? 'SBC storage' : 'Club players');
      if (!Array.isArray(response.items)) throw new Error('EA player response format changed.');
      const before = found.size;
      response.items.forEach(item => { if (item?.id && (!item.isPlayer || item.isPlayer())) found.set(String(item.id), item); });
      status(`Kulüp okunuyor: ${found.size} ${storage ? 'depo' : 'kulüp'} kartı`);
      if (response.retrievedAll || response.endOfList || response.items.length === 0) return [...found.values()];
      if (before === found.size) throw new Error(`EA pagination stopped advancing. ${storage ? 'SBC storage' : 'Club players'}: offset=${offset}, rows=${response.items.length}, unique=${found.size}, retrievedAll=${response.retrievedAll ?? 'missing'}, endOfList=${response.endOfList ?? 'missing'}. Refresh the Web App and try again.`);
    }
    throw new Error('Club pagination limit reached.');
  }
  async function inventory() {
    // Sequential to avoid competing EA service/cache operations.
    const club = await pages(false);
    const storage = await pages(true);
    const unassigned = await observe(services.Item.requestUnassignedItems(), 'Unassigned items');
    const duplicates = new Set((unassigned.items || []).filter(item => item.duplicateId > 0).map(item => String(item.duplicateId)));
    const storageIds = new Set(storage.map(item => String(item.id)));
    const unique = new Map([...club, ...storage].map(item => [String(item.id), item]));
    const squadService = services.Squad;
    if (!squadService || typeof squadService.requestSquadList !== 'function' ||
        typeof squadService.getActiveSquadId !== 'function' || typeof squadService.requestSquadById !== 'function') {
      throw new Error('Aktif kadro okunamıyor. Kadronuzdaki oyuncuları korumak için işlem durduruldu.');
    }
    await observe(squadService.requestSquadList(), 'Active squad list');
    const activeId = squadService.getActiveSquadId();
    if (activeId == null || String(activeId).trim() === '') throw new Error('Aktif kadro kimliği okunamadı. İşlem durduruldu.');
    const active = await observe(squadService.requestSquadById(activeId), 'Active squad players');
    const slots = active.squad?._players;
    if (!Array.isArray(slots) || slots.some(slot => !slot?._item || slot._item.id == null)) {
      throw new Error('Aktif kadro oyuncuları okunamadı. İşlem durduruldu.');
    }
    const activeSquadIds = new Set(slots.map(slot => String(slot._item.id)).filter(id => id !== '0' && id !== ''));
    return { items: [...unique.values()], storageIds, duplicates, activeSquadIds };
  }
  function athleteId(item) {
    // EA databaseId is the athlete ID (definitionId & ItemIdMask.DATABASE).
    // PlayerMeta may be keyed by a full card revision; getAssetId() instead
    // returns cardassetid, which is not a player identity.
    return item?.databaseId ?? item?.assetId ?? item?._metaData?.id ?? item?._staticData?.id;
  }
  function card(item, inventoryState, chem) {
    const rawRarity = item.rareflag ?? item._rareflag;
    const rarity = (typeof rawRarity === 'number' || typeof rawRarity === 'string' && /^\d+$/.test(rawRarity)) &&
      Number.isInteger(Number(rawRarity)) && Number(rawRarity) >= 0 ? Number(rawRarity) : undefined;
    const reportedSpecial = typeof item.isSpecial === 'function' ? item.isSpecial() : undefined;
    const special = reportedSpecial === true || (rarity === undefined ? reportedSpecial !== false : rarity > 1);
    const tier = typeof item.getTier === 'function' ? item.getTier() : (item.rating >= 75 ? 3 : item.rating >= 65 ? 2 : 1);
    const cardType = rarity === undefined ? 'Unknown rarity' : services.Localization?.localize('item.raretype' + rarity) || String(rarity);
    const profile = chem?.getChemProfileForPlayer(item);
    // EA currently exposes `tradable`; older adapters used `untradeable`.
    // Missing/nonboolean/conflicting metadata never earns an untradeable discount.
    const tradable = typeof item.tradable === 'boolean' ? item.tradable :
      typeof item.untradeable === 'boolean' ? !item.untradeable : null;
    const conflicting = typeof item.tradable === 'boolean' && typeof item.untradeable === 'boolean' && item.tradable === item.untradeable;
    const tradeabilityKnown = tradable !== null && !conflicting;
    return {
      id: item.id, definitionId: item.definitionId, assetId: athleteId(item),
      name: item._staticData?.name ?? item.name ?? String(item.definitionId), cardType,
      rating: item.rating, teamId: item.teamId, leagueId: item.leagueId, nationId: item.nationId,
      rarityId: rarity, ratingTier: tier, isUntradeable: tradeabilityKnown && !tradable, tradeabilityKnown,
      isLocked: inventoryState.activeSquadIds.has(String(item.id)),
      isDuplicate: inventoryState.duplicates.has(String(item.id)), isStorage: inventoryState.storageIds.has(String(item.id)),
      isLoan: !Number.isFinite(Number(item.loans)) || Number(item.loans) >= 0, isTimeLimited: Boolean(item.isTimeLimited?.()),
      isSpecial: Boolean(special), isEvolution: Boolean(item.upgrades || (typeof item.isEvolution === 'function' && item.isEvolution()) || /evolution/i.test(cardType)),
      preferredPosition: item.preferredPosition, possiblePositions: item.possiblePositions || [item.preferredPosition],
      groups: Array.isArray(item.groups) && item.groups.length ? item.groups : undefined,
      rarityGroupsKnown: Array.isArray(item.groups) && item.groups.length > 0,
      concept: Boolean(item.concept),
      // No stale embedded prices: the backend enriches from its local database.
      price: null, marketPrice: null, futggPrice: null,
      maxChem: Boolean(profile?.maxChem), teamChem: profile?.rules?.[0], leagueChem: profile?.rules?.[1],
      nationChem: profile?.rules?.[2], normalizeClubId: chem?.normalizeClubId(item.teamId) ?? item.teamId
    };
  }
  function chemistry() {
    if (typeof UTSquadChemCalculatorUtils === 'undefined') throw new Error('EA chemistry adapter unavailable. Reload the Web App.');
    const util = new UTSquadChemCalculatorUtils();
    util.chemService = services.Chemistry; util.teamConfigRepo = repositories.TeamConfig;
    return util;
  }
  async function liveMarketQuotes(selectedScope, currentPolicy, pale, assertCurrent) {
    if (!currentPolicy.allowConcept || currentPolicy.onlyStorage) throw new Error('Anlık piyasa için konseptleri açın ve yalnızca depo seçeneğini kapatın.');
    if (typeof UTSearchCriteriaDTO === 'undefined' || typeof ItemSearchFeature === 'undefined' || typeof ItemType === 'undefined' ||
        typeof SearchLevel === 'undefined' || typeof ItemRatingTier === 'undefined' ||
        typeof services.Item.searchTransferMarket !== 'function' || typeof services.Item.clearTransferMarketCache !== 'function') {
      throw new Error('EA anlık piyasa araması henüz hazır değil.');
    }
    const quality = ui.marketQuality.value, qualityKey = quality.toUpperCase();
    if (!['bronze','silver','gold'].includes(quality) || SearchLevel[qualityKey] === undefined || ItemRatingTier[qualityKey] === undefined) throw new Error('Piyasa kart kalitesini seçin.');
    const requestedCeiling = Number(ui.marketCeiling.value);
    if (!Number.isSafeInteger(requestedCeiling) || requestedCeiling < 1 || requestedCeiling > 15000000) throw new Error('Anlık arama fiyat tavanı 1–15.000.000 arasında tam sayı olmalı.');
    const limits = [currentPolicy.maxPlayerPrice,currentPolicy.maxPurchasePrice,currentPolicy.maxTotalPrice].filter(value => value > 0);
    const ceiling = Math.min(requestedCeiling,...limits);
    if (!Number.isSafeInteger(ceiling) || ceiling < 1) throw new Error('Piyasa fiyat limiti pozitif bir tam sayı olmalı.');
    const thresholds = [...new Set([150,200,250,300,400,600,1000,1500,ceiling].filter(value => value <= ceiling))].sort((a,b)=>a-b);
    let pagesRead = 0, observedAt = null, searchedMaxBuy = 0;
    const quotes = new Map();
    search: for (const maxBuy of thresholds) {
      assertCurrent();
      // Official EA service cache is indexed by page: reset it when the query changes.
      services.Item.clearTransferMarketCache();
      for (let page = 1; pagesRead < 9; page++) {
        assertCurrent();
        const criteria = new UTSearchCriteriaDTO();
        criteria.type = ItemType.PLAYER; criteria.level = SearchLevel[qualityKey]; criteria.maxBuy = maxBuy;
        if (currentPolicy.protectSpecial) criteria.rarities = [0,1];
        const model = new UTBucketedItemSearchViewModel();
        model.searchFeature = ItemSearchFeature.MARKET;
        model.defaultSearchCriteria.type = criteria.type;
        model.updateSearchCriteria(criteria);
        const query = model.searchCriteria;
        query.disableOverrides = true; // Paletools' documented read-only lookup path.
        status(`EA anlık piyasa: ${quality} · en fazla ${maxBuy.toLocaleString()} coin · arama ${pagesRead + 1}/9`);
        const response = await observe(services.Item.searchTransferMarket(query, page), 'EA anlık piyasa');
        const receivedAt = new Date().toISOString();
        pagesRead++; searchedMaxBuy = maxBuy; assertCurrent();
        if (!Array.isArray(response.items)) throw new Error('EA piyasa yanıtı okunamadı.');
        for (const item of response.items) {
          if (typeof item?.getTier !== 'function' || item.getTier() !== ItemRatingTier[qualityKey] || typeof item.getAuctionData !== 'function') continue;
          const auction = item.getAuctionData();
          if (!auction || typeof auction.isActiveTrade !== 'function' || !auction.isActiveTrade() ||
              typeof auction.getSecondsRemaining !== 'function' || !(auction.getSecondsRemaining() > 0)) continue;
          const price = Number(auction.buyNowPrice), definitionId = Number(item.definitionId);
          if (!Number.isSafeInteger(price) || price <= 0 || price > maxBuy || !Number.isSafeInteger(definitionId) || definitionId <= 0) continue;
          const rawRarity = item.rareflag ?? item._rareflag;
          const rarity = rawRarity != null && rawRarity !== '' && Number.isInteger(Number(rawRarity)) ? Number(rawRarity) : undefined;
          const special = typeof item.isSpecial === 'function' ? item.isSpecial() : undefined;
          const candidate = {id:`concept:${definitionId}`,definitionId,concept:true,assetId:athleteId(item),
            rating:item.rating,teamId:item.teamId,leagueId:item.leagueId,nationId:item.nationId,rarityId:rarity,marketPrice:price,
            isSpecial:special === true || (rarity === undefined ? special !== false : rarity > 1),
            isEvolution:Boolean(item.upgrades || typeof item.isEvolution === 'function' && item.isEvolution()),
            isLoan:typeof item.isLimitedUse === 'function' && item.isLimitedUse()};
          if (!Number.isFinite(Number(candidate.rating)) || P.blockedReason(candidate,currentPolicy,pale)) continue;
          if (!observedAt) observedAt = receivedAt;
          const prior = quotes.get(definitionId);
          if (!prior || price < prior.buyNowPrice) quotes.set(definitionId,{definitionId,buyNowPrice:price});
        }
        // This is a bounded observed pool, not a claim about every market listing.
        if (quotes.size) break search;
        if (response.items.length === 0 || Number.isInteger(query.count) && response.items.length < query.count) break;
      }
      if (pagesRead >= 9) break;
    }
    if (!quotes.size) throw new Error('Taranan EA ilanlarında politikaya uygun fiyatlı kart bulunamadı. Fiyat limiti veya kart kalitesini değiştirin.');
    return {...selectedScope,observedAt,quality,searchMaxBuy:searchedMaxBuy,pagesRead,quotes:[...quotes.values()]};
  }
  async function challengeData(challenge, set) {
    await observe(services.SBC.loadChallenge(challenge), 'Load SBC');
    const squad = challenge.squad;
    if (!squad?._formation?.generalPositions || !Array.isArray(challenge.eligibilityRequirements)) throw new Error('EA challenge data format changed.');
    const constraints = [];
    for (const eligibility of challenge.eligibilityRequirements) {
      const pairs = eligibility.kvPairs?._collection;
      if (!pairs || !Object.keys(pairs).length) throw new Error('EA challenge requirement is unreadable.');
      for (const [id, values] of Object.entries(pairs)) {
        const requirementKey = SBCEligibilityKey[id], scope = SBCEligibilityScope[eligibility.scope];
        if (!requirementKey || !scope) throw new Error(`Unrecognized EA requirement ${id}.`);
        constraints.push({ scope, count: eligibility.count, requirementKey, eligibilityValues: values });
      }
    }
    const brickIndices = squad.simpleBrickIndices || [];
    return { constraints, formation: squad._formation.generalPositions.map((value,index) => brickIndices.includes(index) ? -1 : value),
      challengeId: challenge.id, setId: set.id, brickIndices, sbcName: set.name, challengeName: challenge.name,
      currentSolution: (squad._players || []).slice(0,11).map(slot => athleteId(slot?._item) || 0),
      subs: (squad._players || []).slice(11).map(slot => slot?._item?.definitionId).filter(Boolean) };
  }
  function readPaletools() {
    const entries = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i);
        if (name?.startsWith('paletools:') && (name.endsWith(':lockedItems') || name === 'paletools:settings')) entries.push([name, storage.getItem(name)]);
      }
    }
    return P.parsePaletools(entries);
  }
  function legacyLocks() {
    try {
      const settings = JSON.parse(localStorage.getItem('sbcSolverSettings') || '{}');
      const old = settings.sbcSettings || {};
      const set = ui.set.value, challenge = ui.challenge.value;
      return [...(old[0]?.[0]?.excludePlayers || []), ...(old[set]?.[0]?.excludePlayers || []), ...(old[set]?.[challenge]?.excludePlayers || [])];
    } catch { throw new Error('Existing Auto-SBC locks could not be read. Repair saved settings before solving.'); }
  }
  function policy() {
    const input = {};
    for (const [name, control] of Object.entries(ui.settings)) input[name] = control.type === 'checkbox' ? control.checked : Number(control.value);
    input.weights = {};
    for (const [name, control] of Object.entries(ui.weights)) input.weights[name] = Number(control.value);
    const parseIds = value => value.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean);
    input.lockedItemIds = parseIds(ui.locked.value);
    input.requiredItemIds = parseIds(ui.required.value);
    input.lockedDefinitionIds = legacyLocks();
    const result = P.normalizePolicy(input);
    localStorage.setItem(STORAGE, JSON.stringify(result));
    return result;
  }
  function status(text, error = false) { ui.status.textContent = text; ui.status.style.color = error ? '#ffb7b7' : '#bbd0cc'; }
  function fail(error) { status(error?.message || String(error), true); }
  async function action(callback) {
    if (state.busy) return;
    state.busy = true;
    [ui.refresh,ui.solve,ui.liveSolve,ui.apply].forEach(button => { button.disabled = true; });
    try { await callback(); } catch (error) { fail(error); }
    finally { state.busy = false; state.nativeActive = null; ui.refresh.disabled = false; ui.solve.disabled = false; ui.liveSolve.disabled = false; ui.apply.disabled = !state.preview; }
  }
  function invalidate() { state.cancel++; state.preview = null; ui.apply.disabled = true; ui.export.disabled = true; ui.review.replaceChildren(); ui.poolInfo.textContent = ''; }
  function scope(required = true) {
    const value = { gameYear: Number(ui.season.value), platform: ui.platform.value };
    if (![26,27].includes(value.gameYear) || !['ps5','pc'].includes(value.platform)) {
      if (required) throw new Error('Önce oynadığınız sezonu ve fiyat platformunu seçin.');
      return null;
    }
    localStorage.setItem(SCOPE_STORAGE, JSON.stringify(value));
    return value;
  }
  async function health() {
    ui.health.textContent = 'Yerel sunucu kontrol ediliyor…';
    try {
      const selected = scope(false);
      const result = await http('/health' + (selected ? `?gameYear=${selected.gameYear}&platform=${selected.platform}` : ''));
      const currentScope = scope(false);
      if (`${selected?.gameYear}:${selected?.platform}` !== `${currentScope?.gameYear}:${currentScope?.platform}`) return result;
      state.backendScope = result.status === 'ok' && selected ? `${selected.gameYear}:${selected.platform}` : null;
      const db = result.database || {};
      ui.health.textContent = selected ? `Sunucu bağlı · FC ${selected.gameYear} / ${selected.platform.toUpperCase()} · ${db.count ?? '?'} kart · ${db.pricedCount ?? '?'} piyasa fiyatı${result.solverBusy ? ' · çözücü meşgul' : ''}` : 'Sunucu bağlı. Sezon ve platform seçimini yapın.';
      if (selected && (db.readiness === 'awaiting_market_prices' || db.readyForConcepts === false)) ui.marketNotice.textContent = `FC ${selected.gameYear} / ${selected.platform.toUpperCase()} için FUT.GG fiyatları henüz hazır değil. Veri tabanı modunda fiyatlı konsept önerilmez; Anlık piyasadan çöz açık EA ilanlarını ayrı arar. Diğer sezonun fiyatları kullanılmaz.`;
      else ui.marketNotice.textContent = selected ? `Fiyatlar yalnızca FC ${selected.gameYear} / ${selected.platform.toUpperCase()} kaynağından alınır.` : '';
      return result;
    } catch (error) { state.backendScope = null; ui.health.textContent = 'Yerel sunucuya bağlanılamadı'; throw error; }
  }
  async function loadSets() {
    if (!ready()) throw new Error('EA Web App hesabına giriş yapıp kulüp ekranının yüklenmesini bekleyin.');
    invalidate();
    const data = await observe(services.SBC.requestSets(), 'SBC sets');
    state.sets = (data.sets || []).filter(set => typeof set.isComplete !== 'function' || !set.isComplete());
    options(ui.set, state.sets);
    await loadChallenges();
  }
  async function loadChallenges() {
    invalidate();
    const set = state.sets.find(set => String(set.id) === ui.set.value);
    if (!set) { options(ui.challenge, []); return; }
    const data = await observe(services.SBC.requestChallengesForSet(set), 'SBC challenges');
    state.challenges = (data.challenges || []).filter(challenge => challenge.status !== 'COMPLETED');
    options(ui.challenge, state.challenges);
    status(`${state.challenges.length} görev hazır. Kart politikalarını kontrol edip çözebilirsiniz.`);
  }
  async function solve(nativeContext = null, liveMode = false) {
    invalidate();
    state.nativeActive = nativeContext;
    const version = state.cancel;
    if (!ready()) throw new Error('EA Web App henüz hazır değil.');
    const selectedScope = scope();
    if (typeof APP_YEAR !== 'undefined') {
      const detectedYear = Number(String(APP_YEAR).slice(-2));
      if ([26,27].includes(detectedYear) && detectedYear !== selectedScope.gameYear) throw new Error(`EA Web App FC ${detectedYear} bildiriyor. Sezon seçimini düzeltin.`);
    }
    await health();
    assertNativeContext(nativeContext);
    if (nativeContext) {
      const data = await observe(services.SBC.requestSets(), 'Current SBC set');
      assertNativeContext(nativeContext);
      state.sets = data.sets || [];
      const selectedSet = state.sets.find(set => String(set.id) === String(nativeContext.setId));
      if (!selectedSet) throw new Error('Açık SBC seti artık bulunamıyor. EA ekranını yenileyin.');
      options(ui.set, state.sets); ui.set.value = selectedSet.id;
      const challenges = await observe(services.SBC.requestChallengesForSet(selectedSet), 'Current SBC challenge');
      assertNativeContext(nativeContext);
      state.challenges = (challenges.challenges || []).filter(challenge => challenge.status !== 'COMPLETED');
      options(ui.challenge, state.challenges); ui.challenge.value = nativeContext.challengeId;
    }
    const currentPolicy = policy(), pale = readPaletools();
    if (pale.warnings.length) throw new Error(pale.warnings.join(' '));
    const set = state.sets.find(set => String(set.id) === ui.set.value);
    const challenge = state.challenges.find(challenge => String(challenge.id) === ui.challenge.value);
    if (!set || !challenge) throw new Error('Önce SBC listesini yükleyip bir görev seçin.');
    const sbcData = await challengeData(challenge, set);
    assertNativeContext(nativeContext);
    const inv = await inventory(), chem = chemistry();
    assertNativeContext(nativeContext);
    currentPolicy.lockedItemIds = [...new Set([...currentPolicy.lockedItemIds, ...inv.activeSquadIds])];
    let players = inv.items.map(item => card(item, inv, chem));
    // Existing reserves are protected: never silently consume a substitute.
    players = players.filter(player => !sbcData.subs.map(String).includes(String(player.definitionId)));
    const rejected = {};
    for (const player of players) {
      const reason = P.blockedReason(player, currentPolicy, pale);
      if (reason) rejected[reason] = (rejected[reason] || 0) + 1;
    }
    players = players.filter(player => !P.blockedReason(player, currentPolicy, pale));
    const present = new Set(players.map(player => String(player.id)));
    for (const required of currentPolicy.requiredItemIds) if (!present.has(String(required))) throw new Error(`Must-use kart ${required} mevcut değil veya korunuyor.`);
    // Send explicit Paletools locks too; duplicate preference never overrides locks.
    currentPolicy.lockedDefinitionIds = [...new Set([...currentPolicy.lockedDefinitionIds, ...pale.definitionIds.filter(value => /^\d+$/.test(value))])];
    Object.assign(currentPolicy, { lockedNationIds: pale.nationIds, lockedTeamIds: pale.teamIds,
      lockedLeagueIds: pale.leagueIds, lockedRarityIds: pale.rarityIds });
    const maxSolveTime = Number(ui.time.value);
    if (!Number.isFinite(maxSolveTime) || maxSolveTime < 1 || maxSolveTime > 120) throw new Error('Çözüm süresi 1–120 saniye olmalı.');
    state.input = { clubPlayers: players, sbcData, maxSolveTime, solverPolicy: currentPolicy, ...selectedScope };
    if (liveMode) state.input.liveMarket = await liveMarketQuotes(selectedScope,currentPolicy,pale,() => {
      if (version !== state.cancel) throw new Error('Piyasa araması iptal edildi.');
      assertNativeContext(nativeContext);
    });
    ui.export.disabled = false;
    status(`${players.length} kulüp adayı; ${inv.items.length - players.length} korunan kart. ${liveMode ? `${state.input.liveMarket.quotes.length} anlık EA fiyatı. ` : currentPolicy.allowConcept ? 'FUT.GG veri tabanından fiyatlı piyasa adayları ekleniyor. ' : ''}Çözüm aranıyor…`);
    // Short polling requests keep Chrome MV3's worker alive even for long solves.
    // Never retry the creation POST: a lost response must not launch two jobs.
    if (version !== state.cancel) { status('İptal edildi. Yeni çözüm işi başlatılmadı.'); return; }
    assertNativeContext(nativeContext);
    const job = await http('/api/solve/jobs', 'POST', state.input);
    if (!job.jobId || !/^[a-zA-Z0-9-]+$/.test(job.jobId)) throw new Error('Local server returned an invalid solve job ID.');
    let result;
    const deadline = Date.now() + (state.input.maxSolveTime + 60) * 1000;
    while (Date.now() < deadline) {
      if (version !== state.cancel) { status('İptal edildi. Sonuç uygulanmadı; yerel çözücü mevcut işini süre sınırına kadar tamamlayabilir.'); return; }
      const progress = await http(`/api/solve/jobs/${job.jobId}`);
      if (progress.status === 'done') { result = progress.result; break; }
      if (progress.status === 'error') throw new Error(P.errorMessage(progress));
      if (progress.status !== 'running') throw new Error('Local server returned an unknown job status.');
      if (progress.progress) status(`Çözüm aranıyor: ${progress.progress.ownedCandidates ?? players.length} kulüp kartı + ${progress.progress.conceptCandidates ?? 0} piyasa adayı · ${Math.round(progress.progress.elapsedSeconds || 0)} sn`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!result) throw new Error('Yerel çözüm süresi doldu. Sunucu durumunu kontrol edin.');
    if (version !== state.cancel) { status('İptal edildi. Sonuç uygulanmadı.'); return; }
    assertNativeContext(nativeContext);
    const conceptCoverage = result.diagnostics?.conceptCoverage ?? result.conceptCoverage ?? result.conceptPool ?? null;
    if (conceptCoverage) ui.poolInfo.textContent = `Piyasa adayları: ${conceptCoverage.returned ?? conceptCoverage.addedToPool ?? '?'} / ${conceptCoverage.totalEligible ?? '?'} uygun kart. ${conceptCoverage.complete ? 'Politikaya uygun katalog adayları tarandı.' : 'Sınırlı, çeşitlendirilmiş havuz; tüm piyasada en ucuz çözüm garantisi yok.'}`;
    const rows = P.validateSolution(result, state.input, currentPolicy, pale);
    state.preview = { rows, set, challenge, input: state.input, policy: currentPolicy, time: Date.now(), result, rejected, conceptCoverage, nativeContext };
    renderReview(state.preview);
    status('Çözüm hazır. Listeyi inceleyin; Uygula yalnızca SBC kadrosunu kaydeder. Gönderme işlemi EA ekranında size aittir.');
  }
  async function apply() {
    const preview = state.preview;
    const version = state.cancel;
    if (!preview) throw new Error('Önce bir çözüm oluşturun.');
    const assertCurrent = () => {
      if (version !== state.cancel) throw new Error('Uygulama iptal edildi.');
      assertNativeContext(preview.nativeContext);
      if (Date.now() - preview.time > 5 * 60 * 1000) { invalidate(); throw new Error('Önizleme 5 dakikadan eski. Kulübü yeniden okuyup çözün.'); }
      const selected = scope();
      if (selected.gameYear !== preview.input.gameYear || selected.platform !== preview.input.platform) throw new Error('Sezon veya platform değişti. Yeniden çözün.');
    };
    assertCurrent();
    const pale = readPaletools();
    if (pale.warnings.length) throw new Error(pale.warnings.join(' '));
    P.validateSolution(preview.result, preview.input, policy(), pale);
    const concepts = preview.rows.filter(row => row.player.concept), resolvedConcepts = new Map();
    for (const row of concepts) {
      const definitionId = Number(row.player.definitionId);
      if (!Number.isSafeInteger(definitionId) || definitionId <= 0 || typeof services.Item.searchConceptItems !== 'function') throw new Error('EA konsept kart araması kullanılamıyor. Kadro değiştirilmedi.');
      const criteria = new UTBucketedItemSearchViewModel().searchCriteria;
      criteria.defId = [definitionId];
      const response = await observe(services.Item.searchConceptItems(criteria), 'EA konsept kartı');
      assertCurrent();
      if (!Array.isArray(response.items)) throw new Error('EA konsept kart yanıtı okunamadı. Kadro değiştirilmedi.');
      const matches = response.items.filter(item => String(item?.definitionId) === String(definitionId));
      if (matches.length !== 1) throw new Error(`${row.player.name}: EA tam olarak bir eşleşen konsept kart döndürmedi. Kadro değiştirilmedi.`);
      const item = matches[0];
      // Keep the actual EA search entity. Never turn catalog JSON into an item,
      // mark an owned card as a concept, or substitute another card version.
      const assetId = athleteId(item);
      const rarity = item.rareflag ?? item._rareflag;
      const mismatches = [];
      const describe = value => value == null ? 'yok' : typeof value === 'boolean' ? String(value) :
        typeof value === 'number' || typeof value === 'string' ? String(value).slice(0,60) : 'geçersiz';
      const mismatch = (field, expected, actual) => mismatches.push(`${field}: beklenen ${describe(expected)}, gelen ${describe(actual)}`);
      if (item.concept !== true) mismatch('konsept', true, item.concept);
      if (item.id == null) mismatch('EA kart kimliği', 'mevcut', item.id);
      const isPlayer = typeof item.isPlayer === 'function' ? item.isPlayer() : undefined;
      if (isPlayer !== true) mismatch('oyuncu kartı', true, isPlayer);
      if (!Number.isSafeInteger(Number(assetId)) || Number(assetId) <= 0 || String(assetId) !== String(row.player.assetId)) mismatch('oyuncu kimliği', row.player.assetId, assetId);
      if (item.rating != null && Number(item.rating) !== Number(row.player.rating)) mismatch('reyting', row.player.rating, item.rating);
      if (rarity != null && Number(rarity) !== Number(row.player.rarityId)) mismatch('nadirlik', row.player.rarityId, rarity);
      if (mismatches.length) {
        throw new Error(`${row.player.name}: EA konsept kart kimliği uyuşmuyor (${mismatches.join('; ')}). Kadro değiştirilmedi.`);
      }
      resolvedConcepts.set(String(row.id), item);
    }
    const inv = await inventory(), chem = chemistry();
    assertCurrent();
    const currentItems = new Map(inv.items.map(item => [String(item.id), item]));
    const fresh = await challengeData(preview.challenge, preview.set);
    if (JSON.stringify(fresh.constraints) !== JSON.stringify(preview.input.sbcData.constraints) ||
        JSON.stringify(fresh.formation) !== JSON.stringify(preview.input.sbcData.formation)) throw new Error('SBC koşulları değişti. Yeniden çözün.');
    const controller = new UTSBCSquadOverviewViewController();
    controller.initWithSBCSet(preview.set, preview.challenge.id);
    const { _squad, _challenge } = controller;
    if (!_squad || !_challenge || String(_challenge.id) !== String(preview.challenge.id) || String(_challenge.setId) !== String(preview.set.id)) throw new Error('EA squad adapter changed. Nothing was applied.');
    assertCurrent();
    const currentPolicy = policy(), currentLocks = readPaletools();
    if (currentLocks.warnings.length) throw new Error(currentLocks.warnings.join(' '));
    P.validateSolution(preview.result, preview.input, currentPolicy, currentLocks);
    for (const row of preview.rows) {
      if (row.player.concept) {
        const item = resolvedConcepts.get(String(row.id));
        if (currentItems.has(String(item.id)) || inv.items.includes(item)) throw new Error(`${row.player.name}: EA konsept araması bir kulüp kartı döndürdü. Kadro değiştirilmedi.`);
        if (currentPolicy.protectSpecial && typeof item.isSpecial === 'function' && item.isSpecial() === true ||
            currentPolicy.protectEvolutions && (item.upgrades || typeof item.isEvolution === 'function' && item.isEvolution() === true)) {
          throw new Error(`${row.player.name}: EA kart koruması bu konsepti engelliyor. Kadro değiştirilmedi.`);
        }
      } else {
        const item = currentItems.get(String(row.id));
        if (!item) throw new Error(`${row.player.name} kulüpte artık yok. Yeniden çözün.`);
        const current = card(item, inv, chem);
        if (String(current.definitionId) !== String(row.player.definitionId) || String(current.assetId) !== String(row.player.assetId)) throw new Error(`${row.player.name}: kulüp kartı değişti. Yeniden çözün.`);
        const reason = P.blockedReason(current, currentPolicy, currentLocks);
        if (reason) throw new Error(`${row.player.name}: ${reason}. Yeniden çözün.`);
      }
    }
    const oldItems = (_squad._players || []).map(slot => slot?._item);
    const squad = Array.from({ length: 11 }, () => new UTItemEntity());
    preview.rows.forEach(row => { squad[row.squadPosition] = row.player.concept ? resolvedConcepts.get(String(row.id)) : currentItems.get(String(row.id)); });
    squad.push(...oldItems.slice(11));
    const reserves = oldItems.slice(11).filter(item => typeof item?.isPlayer === 'function' && item.isPlayer());
    for (const row of preview.rows) {
      const selected = squad[row.squadPosition];
      for (const reserve of reserves) {
        if (typeof selected.compareResourceTo !== 'function' || selected.compareResourceTo(reserve)) throw new Error('Seçilen kart yedekteki korunan oyuncuyla çakışıyor veya karşılaştırılamıyor. Kadro değiştirilmedi.');
      }
    }
    if (typeof _squad.removeAllItems !== 'function') throw new Error('EA kadro temizleme yöntemi kullanılamıyor. Kadro değiştirilmedi.');
    const sameItem = (expected, actual) => {
      const expectedPlayer = typeof expected?.isPlayer === 'function' && expected.isPlayer();
      const actualPlayer = typeof actual?.isPlayer === 'function' && actual.isPlayer();
      return !expectedPlayer && !actualPlayer || expectedPlayer && actualPlayer && String(expected.id) === String(actual.id) &&
        String(expected.definitionId) === String(actual.definitionId) && Boolean(expected.concept) === Boolean(actual.concept);
    };
    try {
      // EA setPlayers does not empty incoming blank slots, and can omit variants
      // of an existing reserve. Clear players explicitly while keeping manager.
      _squad.removeAllItems(true);
      _squad.setPlayers(squad, true);
      if (!squad.every((item,index) => sameItem(item,_squad._players?.[index]?._item))) throw new Error('EA kadroyu beklenen kartlarla dolduramadı; kayıt gönderilmedi.');
      await observe(services.SBC.saveChallenge(_challenge), 'Save SBC squad');
    } catch (error) {
      _squad.removeAllItems(true);
      _squad.setPlayers(oldItems, true);
      throw error;
    }
    if (concepts.length) {
      // Keep the reviewed shopping list visible without leaving Apply actionable.
      state.cancel++; state.preview = null; ui.apply.disabled = true; ui.export.disabled = true;
    } else invalidate();
    try {
      const view = new UTSBCSquadSplitViewController(); view.initWithSBCSet(preview.set, preview.challenge.id);
      const current = getAppMain().getRootViewController().getPresentedViewController().getCurrentViewController();
      current.rootController.getRootNavigationController().pushViewController(view);
    } catch { /* The saved squad remains accessible via EA's own SBC screen. */ }
    status(concepts.length ? 'Konseptler SBC kadrosuna yerleştirildi. Coin harcanmadı. Konseptler gerçek kartlarla değiştirilmeden kadro teslim edilemez.' : 'Kadronuz SBC’ye kaydedildi. EA ekranında koşulları kontrol edip isterseniz kendiniz gönderin.');
  }

  function el(tag, text, parent) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node; }
  function options(select, entries) { select.replaceChildren(); entries.forEach(entry => { const option = el('option', entry.name, select); option.value = entry.id; }); }
  function renderReview(preview) {
    ui.review.replaceChildren();
    el('h3', preview.input.sbcData.challengeName, ui.review);
    el('p', `FC ${preview.input.gameYear} · ${preview.input.platform.toUpperCase()} · Kulüp + piyasa kadrosu`, ui.review).className = 'muted';
    if (preview.input.liveMarket) el('p', `Anlık EA piyasası · ${preview.input.liveMarket.pagesRead} aramada gözlenen ${preview.input.liveMarket.quotes.length} fiyat. Yalnızca taranan ilanlar karşılaştırıldı; tüm piyasadaki en ucuz kart garantisi yok. Fiyatlar en fazla 120 saniye geçerlidir.`, ui.review);
    const table = el('table', undefined, ui.review), head = el('tr', undefined, table);
    ['Slot','Oyuncu','RTG','Tür','Fiyat'].forEach(label => el('th', label, head));
    for (const row of preview.rows) {
      const tr = el('tr', undefined, table);
      const type = row.player.concept ? 'Konsept' : row.player.tradeabilityKnown === false ? 'Kulüp · satış durumu bilinmiyor' : row.player.isStorage ? 'Depo' : row.player.isDuplicate ? 'Dupe' : row.player.isUntradeable ? 'Kulüp · satılamaz' : 'Kulüp · satılabilir';
      const price = Number(row.marketPrice ?? row.futggPrice ?? row.player.marketPrice);
      [row.squadPosition + 1, row.player.name, row.player.rating, type, price > 0 ? Math.round(price).toLocaleString() : 'Tahmini'].forEach(value => el('td', String(value), tr));
    }
    const shopping = preview.result.shoppingList || [];
    const purchase = shopping.reduce((sum,item) => sum + Number(item.marketPrice) * Number(item.quantity), 0);
    const owned = preview.rows.filter(row => !row.player.concept);
    const ownedCost = owned.reduce((sum,row) => sum + (Number(row.marketPrice ?? row.futggPrice) || 0),0);
    el('p', `${owned.length} kulüp kartı + ${shopping.length} alınacak kart · Satın alma toplamı: ${purchase.toLocaleString()} coin`, ui.review);
    el('p', `Kulüp kartlarının tahmini piyasa değeri: ${ownedCost.toLocaleString()} coin. Bu tutar satın alma harcaması değildir. Önizleme 5 dakika geçerlidir.`, ui.review);
    if (shopping.length) {
      el('h3', 'Alışveriş listesi', ui.review);
      for (const item of shopping) {
        const box = el('div', undefined, ui.review);
        el('p', `${item.quantity} × ${item.name} (${item.rating}) — ${Number(item.marketPrice).toLocaleString()} coin`, box);
        const age = Math.max(0, Math.round((Date.now() - Date.parse(item.priceSnapshotAt))/60000));
        el('p', `${item.source} · FC ${item.gameYear} / ${item.platform.toUpperCase()} · Kaynak fiyatı ${age} dk önce · ${new Date(item.priceSnapshotAt).toLocaleString()}`, box).className = 'muted';
        try {
          const url = new URL(item.url);
          if (url.protocol === 'https:' && ['www.fut.gg','fut.gg'].includes(url.hostname)) {
            const link = el('a', preview.input.liveMarket ? 'Kart bilgilerini aç ↗' : 'Kart ve fiyat kaynağını aç ↗', box); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          }
        } catch { /* A missing source link never becomes an arbitrary navigation. */ }
      }
      el('p', 'Konseptleri kadroya yerleştir düğmesi gerçek EA konsept kartlarını SBC’ye kaydeder. Bu işlem coin harcamaz. Konseptler gerçek kartlarla değiştirilmeden kadro teslim edilemez; alışveriş listesi yalnızca fiyat bilgisidir.', ui.review);
    } else el('p', 'Alınacak kart yok; çözüm kulübünüzdeki kartlardan oluşuyor.', ui.review);
    if (preview.conceptCoverage) el('p', `Piyasa havuzu: ${preview.conceptCoverage.returned ?? preview.conceptCoverage.addedToPool ?? '?'} / ${preview.conceptCoverage.totalEligible ?? '?'} uygun aday. ${preview.conceptCoverage.complete ? 'Politikaya uygun katalog adayları tarandı.' : 'Sınırlı aday seçimi: tüm piyasadaki en ucuz çözüm garantisi değildir.'}`, ui.review);
    if (preview.result.summary) {
      const summary = preview.result.summary;
      el('p', `Takım reytingi: ${summary.estimatedRating ?? '?'} · Kimya: ${summary.chemistry ?? '?'} · Dupe: ${summary.duplicatesUsed ?? 0} · Politika maliyeti: ${Math.round(summary.weightedCost || 0).toLocaleString()}`, ui.review);
      if (Number.isFinite(summary.marketCost)) el('p', `Tahmini toplam piyasa değeri: ${Math.round(summary.marketCost).toLocaleString()} coin`, ui.review);
    }
    const diagnostics = preview.result.diagnostics;
    if (diagnostics && (Array.isArray(diagnostics) ? diagnostics.length : true)) el('pre', JSON.stringify(diagnostics, null, 2), ui.review);
    const details = el('details', undefined, ui.review); el('summary', 'Korunan kartlar ve Paletools', details);
    el('pre', JSON.stringify(preview.rejected, null, 2), details);
    el('p', 'Aktif kadrodaki kartlar korunur ve Uygula öncesi yeniden okunur. Bu kontrol geçmişte oynanmış tüm kartları tespit etmez. Satış bilgisi bilinmeyen kartlar satılabilir kart politikasıyla değerlendirilir.', details);
    el('p', 'Paletools kayıtlı kart/ülke/takım/lig/nadirlik kilitleri okunur. Farklı hesapların kayıtlı kilitleri de korunur. Paletools ayarları değiştirilmez.', details);
    ui.apply.textContent = shopping.length ? 'Konseptleri kadroya yerleştir' : 'İnceledim · Kadroyu SBC’ye uygula';
    ui.apply.disabled = false;
  }

  const host = document.createElement('div'); host.id = 'autosbc-local-panel'; document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style', undefined, root);
  style.textContent = `:host{all:initial;position:fixed;z-index:2147483000;right:18px;bottom:18px;font:13px/1.5 system-ui,sans-serif;color:#ecf6f3}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{background:#24443d;color:#ecf6f3;border:1px solid #56736b;border-radius:8px;padding:8px 12px;cursor:pointer}button:hover{background:#345c50}button:disabled{opacity:.45;cursor:default}.launch{background:#bdf576;color:#162210;font-weight:700}.panel{width:min(470px,calc(100vw - 36px));max-height:82vh;overflow:auto;background:#10231e;border:1px solid #3c6054;box-shadow:0 12px 50px #0008;border-radius:16px;padding:18px;margin-bottom:8px}.hidden{display:none}h2{font-size:21px;margin:0 0 2px}h3{font-size:16px}p{margin:8px 0}a{color:#bdf576}label{display:block;margin:9px 0}select,textarea,input[type=number]{background:#1c342d;color:#fff;border:1px solid #4e6f62;border-radius:6px;padding:6px;width:100%}input[type=checkbox]{margin-right:8px;accent-color:#bdf576}input[type=number]{width:100px;float:right}.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}details{border-top:1px solid #375348;margin-top:12px;padding-top:10px}summary{cursor:pointer;color:#d6e6de}.muted{font-size:12px;color:#a3c3b6}.status{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:5px 3px;border-bottom:1px solid #375348}pre{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}.apply{background:#bdf576;color:#122010;font-weight:700}`;
  const panel = el('section', undefined, root); panel.className = 'panel hidden';
  const ui = { settings: {}, weights: {} };
  const launch = el('button', 'Auto-SBC Local', root); launch.className = 'launch';
  launch.addEventListener('click', () => { panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) health().catch(fail); });
  el('h2', 'Auto-SBC Local', panel); el('p', 'Kulüp + piyasa · gerçek fiyat · açık alışveriş listesi', panel).className = 'muted';
  ui.season = el('select', undefined, el('label', 'Oynadığınız sezon', panel));
  options(ui.season, [{id:'',name:'Sezon seçin'},{id:26,name:'EA FC 26'},{id:27,name:'EA FC 27'}]);
  ui.platform = el('select', undefined, el('label', 'Fiyat platformu', panel));
  options(ui.platform, [{id:'',name:'Platform seçin'},{id:'ps5',name:'Konsol piyasası (PS / Xbox)'},{id:'pc',name:'PC piyasası'}]);
  try {
    const selected = JSON.parse(localStorage.getItem(SCOPE_STORAGE) || '{}');
    if ([26,27].includes(Number(selected.gameYear)) && ['ps5','pc'].includes(selected.platform)) {
      ui.season.value = selected.gameYear; ui.platform.value = selected.platform;
    }
  } catch { /* Require explicit selection for missing or malformed saved scope. */ }
  ui.health = el('p', 'Yerel sunucu kontrol edilmedi.', panel); ui.health.className = 'muted';
  ui.marketNotice = el('p', '', panel); ui.marketNotice.className = 'muted';
  const dashboard = el('a', 'Yerel kontrol paneli ve veri tabanı ↗', panel); dashboard.href = BASE; dashboard.target = '_blank'; dashboard.rel = 'noopener';
  const top = el('div', undefined, panel); top.className = 'row';
  ui.refresh = el('button', 'SBC listesini yükle', top);
  const check = el('button', 'Sunucuyu kontrol et', top); check.addEventListener('click', () => health().catch(fail));
  ui.set = el('select', undefined, el('label', 'SBC seti', panel));
  ui.challenge = el('select', undefined, el('label', 'Görev', panel));
  ui.marketQuality = el('select', undefined, el('label', 'Anlık piyasada kart kalitesi', panel));
  options(ui.marketQuality,[{id:'bronze',name:'Bronz'},{id:'silver',name:'Gümüş'},{id:'gold',name:'Altın'}]); ui.marketQuality.value = 'silver';
  ui.marketCeiling = el('input', undefined, el('label','Anlık arama fiyat tavanı (coin)',panel));
  ui.marketCeiling.type='number'; ui.marketCeiling.min=1; ui.marketCeiling.max=15000000; ui.marketCeiling.value=2000;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch { /* Use safe defaults. */ }
  const settings = { ...P.defaults, ...saved, weights: { ...P.defaults.weights, ...saved.weights } };
  const policySection = el('details', undefined, panel); policySection.open = true; el('summary', 'Kart politikası', policySection);
  for (const [name,label] of [['prioritizeDuplicates','Dupe ve satılamaz kartlara öncelik ver'],['onlyStorage','Yalnızca SBC deposu'],['allowTradeable','Satılabilir kartlara izin ver'],['protectSpecial','Özel kartları koru'],['protectEvolutions','Evolution kartlarını koru'],['allowConcept','Eksik yerleri fiyatlı piyasa kartlarıyla tamamla']]) {
    const row = el('label', undefined, policySection), input = el('input', undefined, row); input.type = 'checkbox'; input.checked = Boolean(settings[name]); row.append(document.createTextNode(label)); ui.settings[name] = input;
  }
  for (const [name,label,max] of [['maxRating','En yüksek oyuncu reytingi',99],['maxPlayerPrice','Kart başına değer limiti (0 = limitsiz)',15000000],['maxPurchasePrice','Satın alma bütçesi (0 = limitsiz)',165000000],['maxTotalPrice','Toplam kadro değeri limiti (0 = limitsiz)',165000000]]) {
    const labelNode = el('label', label, policySection), input = el('input', undefined, labelNode); input.type = 'number'; input.min = name === 'maxRating' ? 1 : 0; input.max = max; input.value = settings[name]; ui.settings[name] = input;
  }
  const weights = el('details', undefined, panel); el('summary', 'Maliyet ağırlıkları ve kilitler', weights);
  el('p', '1 = tam piyasa değeri; 0,1 = maliyetin %10’u. Kilitler ve korumalar her zaman önceliklidir.', weights).className = 'muted';
  for (const [name,label] of [['duplicateUntradeable','Dupe satılamaz'],['untradeable','Satılamaz'],['tradeable','Satılabilir'],['concept','Konsept']]) {
    const labelNode = el('label', label, weights), input = el('input', undefined, labelNode); input.type = 'number'; input.min = 0; input.max = 100; input.step = .1; input.value = settings.weights[name]; ui.weights[name] = input;
  }
  ui.locked = el('textarea', undefined, el('label', 'Korunan envanter ID’leri (virgülle ayır)', weights)); ui.locked.rows = 2; ui.locked.value = (settings.lockedItemIds || []).join(', ');
  ui.required = el('textarea', undefined, el('label', 'Mutlaka kullanılacak envanter ID’leri', weights)); ui.required.rows = 2; ui.required.value = (settings.requiredItemIds || []).join(', ');
  const timeLabel = el('label', 'En fazla çözüm süresi (saniye)', panel); ui.time = el('input', undefined, timeLabel); ui.time.type = 'number'; ui.time.min = 1; ui.time.max = 120; ui.time.value = 30;
  const controls = el('div', undefined, panel); controls.className = 'row';
  ui.solve = el('button', 'Çöz ve önizle', controls); ui.solve.className = 'launch';
  ui.liveSolve = el('button', 'Anlık piyasadan çöz', controls);
  el('p','Çöz ve önizle: FUT.GG veri tabanı. Anlık piyasadan çöz: EA’nın açık ilanları; arama tavanı, kart ve toplam bütçe limitlerinin en düşüğü kullanılır.',panel).className='muted';
  const cancel = el('button', 'İptal', controls); cancel.addEventListener('click', () => { invalidate(); status('İptal edildi. Bekleyen sonuç uygulanmayacak.'); });
  ui.export = el('button', 'İsteği dışa aktar', controls); ui.export.disabled = true;
  ui.export.addEventListener('click', () => {
    if (!state.input) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.input,null,2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `autosbc-request-${state.input.sbcData.challengeId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  ui.status = el('p', 'EA hesabına giriş yaptıktan sonra SBC listesini yükleyin.', panel); ui.status.className = 'status';
  ui.poolInfo = el('p', '', panel); ui.poolInfo.className = 'muted';
  ui.review = el('div', undefined, panel);
  ui.apply = el('button', 'İnceledim · Kadroyu SBC’ye uygula', panel); ui.apply.className = 'apply'; ui.apply.disabled = true;
  el('p', 'Gönderme, satın alma ve paket açma otomasyonu içermez. TitiroMonkey Auto-SBC tabanlı · MIT.', panel).className = 'muted';
  ui.refresh.addEventListener('click', () => action(loadSets));
  ui.set.addEventListener('change', () => action(loadChallenges));
  ui.challenge.addEventListener('change', invalidate);
  for (const select of [ui.season,ui.platform]) select.addEventListener('change', () => { invalidate(); health().catch(fail); });
  ui.solve.addEventListener('click', () => action(solve));
  ui.liveSolve.addEventListener('click', () => action(() => solve(activeChallengeContext(),true)));
  ui.apply.addEventListener('click', () => action(apply));
  for (const input of [...Object.values(ui.settings),...Object.values(ui.weights),ui.locked,ui.required,ui.time,ui.marketQuality,ui.marketCeiling]) input.addEventListener('change', invalidate);
  if (window.AutoSBCNative) {
    window.AutoSBCNative.install({
      document,
      getPrototype: () => typeof UTSBCSquadDetailPanelView !== 'undefined' ? UTSBCSquadDetailPanelView.prototype : null,
      resolveContext: activeChallengeContext,
      getGate: () => {
        if (state.busy) return { ready: false, reason: 'Mevcut çözüm işlemi bitene kadar bekleyin.' };
        const gameYear = Number(ui.season.value), platform = ui.platform.value;
        if (![26,27].includes(gameYear) || !['ps5','pc'].includes(platform)) return { ready: false, reason: 'Auto-SBC panelinden sezon ve platform seçin.' };
        if (state.backendScope !== `${gameYear}:${platform}`) return { ready: false, reason: 'Auto-SBC panelinden yerel sunucu bağlantısını kontrol edin.' };
        return { ready: true };
      },
      onMount: () => { health().catch(fail); },
      onSolveCurrent: context => { panel.classList.remove('hidden'); return action(() => solve(context)); },
      onContextChanged: () => { if (state.nativeActive || state.preview?.nativeContext) invalidate(); },
      onError: fail
    });
  }
})();
