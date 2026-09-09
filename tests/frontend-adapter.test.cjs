const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

class Element {
  constructor(tag, text = '') { this.tag = tag; this.children = []; this._text = text; this.listeners = {}; this.style = {}; this._value = ''; this.disabled = false;
    const classes = new Set(); this.classList = { toggle: value => classes.has(value) ? classes.delete(value) : classes.add(value), contains: value => classes.has(value), remove: value => classes.delete(value) }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  set className(value) { this._class = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  attachShadow() { this.shadowRoot = new Element('shadow'); return this.shadowRoot; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  async click() { if (!this.disabled) await Promise.all((this.listeners.click || []).map(callback => callback({}))); }
}
class Storage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index]; }
  getItem(name) { return this.data.get(name) ?? null; }
  setItem(name,value) { this.data.set(name,String(value)); }
  removeItem(name) { this.data.delete(name); }
}
const observable = data => ({ observe(owner,callback) { queueMicrotask(() => callback(this,{success:true,status:200,data})); }, unobserve() {} });
function marketCard(id=9999, gameYear=26, platform='ps5') {
  const timestamp=new Date(Date.now()-60000).toISOString();
  return {id:`concept:${id}`,definitionId:id,assetId:id+10000,name:'Market base card',rating:82,teamId:18,leagueId:13,nationId:18,rarityId:0,
    possiblePositions:[14],preferredPosition:14,marketPrice:1500,concept:true,priceStale:false,
    gameYear,platform,priceGameYear:gameYear,pricePlatform:platform,priceSource:'FUT.GG',catalogSource:'https://www.fut.gg/players/',
    priceSnapshotAt:timestamp,priceFetchedAt:timestamp,url:`https://www.fut.gg/players/${id}/`};
}
function marketResult(input, concepts=[marketCard()], ownedCount=10) {
  const solution=[...input.clubPlayers.slice(0,ownedCount),...concepts].map((player,i)=>({...player,squadPosition:i,marketPriceSource:player.priceSource}));
  return {status_code:4,solution,conceptCandidates:concepts,conceptCoverage:{returned:1500,totalEligible:19000,complete:false},
    database:{priceMaxAgeHours:6},summary:{purchaseCost:concepts.reduce((sum,p)=>sum+p.marketPrice,0)},
    shoppingList:solution.filter(p=>p.concept).map(p=>({definitionId:p.definitionId,assetId:p.assetId,name:p.name,rating:p.rating,quantity:1,
      squadPosition:p.squadPosition,marketPrice:p.marketPrice,source:p.priceSource,priceSnapshotAt:p.priceSnapshotAt,priceFetchedAt:p.priceFetchedAt,
      gameYear:p.gameYear,platform:p.platform,url:p.url}))};
}
function harness(overrides = {}) {
  const body = new Element('html');
  const localStorage = new Storage(), sessionStorage = new Storage();
  for (const [key,value] of Object.entries(overrides.storage || {})) localStorage.setItem(key,value);
  const writes = [], requests = [], conceptRequests = [];
  const timerDelays=[];
  const activeSquadPlayers=[];
  let jobResult;
  const players = Array.from({length:12},(_,i) => ({id:i+1,definitionId:1000+i,assetId:2000+i,_metaData:{id:2000+i},_staticData:{name:`Player ${i+1}`},
    rating:80,teamId:18,leagueId:13,nationId:18,rareflag:0,untradeable:true,loans:-1,preferredPosition:14,possiblePositions:[14],groups:[0],
    isPlayer:()=>true,isSpecial:()=>false,isTimeLimited:()=>false,getTier:()=>3,
    getTotalGamesPlayed:()=>0,getLifetimeStats:()=>[0,0,0,0,0],getStats:()=>[0,0,0,0,0],
    compareResourceTo(other){return this.assetId===other.assetId;}}));
  const squad = {_formation:{generalPositions:Array(11).fill(14)},simpleBrickIndices:[],_players:Array.from({length:11},()=>({_item:{}})),
    removeAllItems(keepManager){assert.equal(keepManager,true);writes.push('removeAllItems');this._players=this._players.map(()=>({_item:{id:0,isPlayer:()=>false}}));},
    setPlayers(items) { writes.push('setPlayers'); this._players=items.map(item=>({_item:item})); }};
  const challenge = {id:10,setId:20,name:'Test challenge',status:'IN_PROGRESS',squad,
    eligibilityRequirements:[{scope:0,count:11,kvPairs:{_collection:{1:[11]}}}]};
  const set = {id:20,name:'Test SBC',isComplete:()=>false};
  let activeChallenge=challenge,nativeOptions;
  const ctx = {console,setTimeout:(callback,delay,...args)=>{timerDelays.push(delay);return setTimeout(callback,delay===500?0:delay,...args);},clearTimeout,setInterval,clearInterval,queueMicrotask,URL,Blob,AbortController,crypto:require('node:crypto').webcrypto,
    localStorage,sessionStorage,location:{origin:'https://www.ea.com'},atob:value=>Buffer.from(value,'base64').toString(),
    document:{documentElement:body,createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text)},
    repositories:{TeamConfig:{}},
    services:{SBC:{requestSets:()=>observable({sets:[set]}),requestChallengesForSet:()=>observable({challenges:[challenge]}),loadChallenge:()=>observable(challenge),saveChallenge:()=>{writes.push('saveChallenge');return observable({});}},
      Club:{clubDao:{resetStatsCache(){}},getStats:()=>observable({}),search:()=>observable({items:players,retrievedAll:true})},Item:{searchStorageItems:()=>observable({items:[],endOfList:true}),requestUnassignedItems:()=>observable({items:[]})},
      Squad:{requestSquadList:()=>observable({}),getActiveSquadId:()=>7,requestSquadById:()=>observable({squad:{_players:activeSquadPlayers}})},
      Localization:{localize:()=> 'Gold Common'},Chemistry:{}},
    UTBucketedItemSearchViewModel:class {constructor(){this.searchCriteria={};}},
    UTSBCSquadOverviewViewController:class {initWithSBCSet(){this._squad=squad;this._challenge=challenge;}},
    UTSBCSquadSplitViewController:class {initWithSBCSet(){}},UTItemEntity:class {},
    UTSquadChemCalculatorUtils:class {getChemProfileForPlayer(){return {maxChem:false,rules:[{calculationType:1,contribution:1,parameterId:1},{calculationType:1,contribution:1,parameterId:2},{calculationType:1,contribution:1,parameterId:3}]};}normalizeClubId(id){return id;}},
    SBCEligibilityKey:{1:'NUMBER_OF_PLAYERS'},SBCEligibilityScope:{0:'EXACT'},
    fetch: async (url, options) => {
      let result={status:'ok',database:{count:20000,pricedCount:overrides.noPrices?0:10000,readyForConcepts:!overrides.noPrices,readiness:overrides.noPrices?'awaiting_market_prices':'ready'}};
      if (url.endsWith('/api/concepts')) {
        conceptRequests.push(JSON.parse(options.body));
        result = overrides.concepts || {players:[],coverage:{returned:0,totalEligible:0,complete:true}};
      }
      if (url.endsWith('/api/solve/jobs')) {
        const input=JSON.parse(options.body); requests.push(input);
        jobResult = overrides.solve ? await overrides.solve(input) : {status_code:4,status:'Optimal',solution:input.clubPlayers.slice(0,11).map((player,i)=>({...player,squadPosition:i})),summary:{estimatedRating:80,chemistry:33,duplicatesUsed:0,weightedCost:7700,marketCost:11000}};
        result = {jobId:'test-job',status:'running'};
      }
      if (url.endsWith('/api/solve/jobs/test-job')) result = {status:'done',result:jobResult};
      return {ok:true,status:200,text:async()=>JSON.stringify(result)};
    }};
  if(overrides.native){
    ctx.AutoSBCNative={install:options=>{nativeOptions=options;}};
    ctx.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({childViewControllers:[{_challenge:activeChallenge}]})})})})});
  }
  ctx.window = ctx;
  const context = vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/policy.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/batch-policy.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/batch-runner.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/batch-reconcile.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/daily-plan.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/read-retry.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/companion.js'),'utf8'),context);
  const elements = [];
  const visit = element => { elements.push(element);element.children.forEach(visit);if(element.shadowRoot)visit(element.shadowRoot);}; visit(body);
  const button = text => elements.find(element=>element.tag==='button'&&element.textContent===text);
  const selects = elements.filter(element=>element.tag==='select');
  const refresh = async () => { selects[0].value=overrides.gameYear||26;selects[1].value=overrides.platform||'ps5';await button('SBC listesini yükle').click(); selects[2].value='20'; await Promise.all(selects[2].listeners.change.map(callback=>callback())); selects[3].value='10'; };
  return {ctx,elements,button,refresh,writes,requests,conceptRequests,players,squad,challenge,set,activeSquadPlayers,localStorage,selects,nativeOptions,timerDelays,
    navigate:id=>{activeChallenge=id===null?null:{...challenge,id};}};
}
test('EA integration: solve only reads; reviewed Apply is the only save', async () => {
  const h=harness(); await h.refresh();
  h.localStorage.setItem('paletools:2026:account:lockedItems','[1011]');
  await h.button('Çöz ve önizle').click();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].clubPlayers.length,11);
  assert.deepEqual(h.writes,[]);
  await h.button('İnceledim · Kadroyu SBC’ye uygula').click();
  assert.deepEqual(h.writes,['removeAllItems','setPlayers','saveChallenge']);
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);
});
test('Paletools lock added after review stops Apply before any mutation', async () => {
  const h=harness(); await h.refresh();await h.button('Çöz ve önizle').click();
  h.localStorage.setItem('paletools:2026:account:lockedItems','[1000]');
  await h.button('İnceledim · Kadroyu SBC’ye uygula').click();
  assert.deepEqual(h.writes,[]);
  assert.ok(h.elements.some(element=>element.textContent.includes('Paletools lock')));
});
test('unowned solver result cannot be applied', async () => {
  const h=harness({solve:input=>({status_code:4,solution:input.clubPlayers.slice(0,11).map((player,i)=>({...player,id:i?player.id:999,squadPosition:i}))})});
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);
  assert.deepEqual(h.writes,[]);
});
test('cancelled solve cannot restore an actionable preview', async () => {
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const h=harness({solve:input=>{entered();return new Promise(resolve=>{release=()=>resolve({status_code:4,solution:input.clubPlayers.slice(0,11).map((player,i)=>({...player,squadPosition:i}))});});}});
  await h.refresh();const pending=h.button('Çöz ve önizle').click();await started;
  await h.button('İptal').click();release();await pending;
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);
  assert.deepEqual(h.writes,[]);
});
test('mixed solve validates server-selected concepts and shows a scoped shopping list', async () => {
  const h=harness({solve:input=>marketResult(input)});
  await h.refresh();
  await h.button('Çöz ve önizle').click();
  assert.equal(h.conceptRequests.length,0);
  assert.equal(h.requests[0].gameYear,26);
  assert.equal(h.requests[0].platform,'ps5');
  assert.equal(h.requests[0].solverPolicy.allowConcept,true);
  assert.equal(h.requests[0].clubPlayers.filter(p=>p.concept).length,0);
  assert.equal(h.button('Konseptleri kadroya yerleştir').disabled,false);
  assert.ok(h.elements.some(element=>element.textContent.includes('Alışveriş listesi')));
  assert.ok(h.elements.some(element=>element.textContent.includes('Satın alma toplamı: 1,500 coin')));
  assert.deepEqual(h.writes,[]);
});
test('missing owned rarity groups remain unknown in exported solve input', async () => {
  const h=harness();delete h.players[0].groups;h.players[1].groups=[];
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].clubPlayers[0].rarityGroupsKnown,false);
  assert.equal(Object.hasOwn(h.requests[0].clubPlayers[0],'groups'),false);
  assert.equal(h.requests[0].clubPlayers[1].rarityGroupsKnown,false);
  assert.equal(h.requests[0].clubPlayers[2].rarityGroupsKnown,true);
});
test('empty club can request a fully priced market squad without inventing ownership', async () => {
  const concepts=Array.from({length:11},(_,i)=>marketCard(9999+i));
  const h=harness({solve:input=>marketResult(input,concepts,0)});h.players.length=0;
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].clubPlayers.length,0);
  assert.equal(h.button('Konseptleri kadroya yerleştir').disabled,false);
  assert.ok(h.elements.some(element=>element.textContent.includes('0 kulüp kartı + 11 alınacak kart')));
  assert.deepEqual(h.writes,[]);
});
test('FC27 without market prices keeps owned-only solves and reports missing quotes', async () => {
  const h=harness({gameYear:27,noPrices:true});await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].gameYear,27);
  assert.ok(h.elements.some(element=>element.textContent.includes('FC 27 / PS5 için FUT.GG fiyatları henüz hazır değil')));
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,false);
});
test('season choice is required before sending club data', async () => {
  const h=harness();await h.refresh();h.selects[0].value='';await h.button('Çöz ve önizle').click();
  assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);
});
test('market purchase limit is separate from owned opportunity cost', async () => {
  const h=harness({solve:input=>marketResult(input)});await h.refresh();
  const budget=h.elements.find(element=>element.tag==='label'&&element.textContent.startsWith('Satın alma bütçesi')).children.find(element=>element.tag==='input');
  budget.value=1000;await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].solverPolicy.maxPurchasePrice,1000);
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);
  assert.ok(h.elements.some(element=>element.textContent.includes('purchase budget')));
});
test('native entry resolves actual upstream controller challenge into shared solver pipeline',async()=>{
  const h=harness({native:true});await h.refresh();
  const context=h.nativeOptions.resolveContext();assert.deepEqual({...context},{setId:20,challengeId:10});
  await h.nativeOptions.onSolveCurrent(context);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].sbcData.challengeId,10);
  assert.equal(h.requests[0].solverPolicy.protectSpecial,true);assert.deepEqual(h.writes,[]);
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,false);
});
test('native entry with missing challenge never starts a solve job',async()=>{
  const h=harness({native:true});await h.refresh();h.navigate(null);
  assert.equal(h.nativeOptions.resolveContext(),null);
  await h.nativeOptions.onSolveCurrent({setId:20,challengeId:10});assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);
});
test('navigation discards a native solve response before review or Apply',async()=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  const h=harness({native:true,solve:input=>{entered();return new Promise(resolve=>{release=()=>resolve({status_code:4,solution:input.clubPlayers.slice(0,11).map((p,i)=>({...p,squadPosition:i}))});});}});
  await h.refresh();const pending=h.nativeOptions.onSolveCurrent(h.nativeOptions.resolveContext());await started;
  h.navigate(11);h.nativeOptions.onContextChanged('20:10','20:11');release();await pending;
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);assert.deepEqual(h.writes,[]);
});
test('native Apply rechecks navigation even before the next readiness tick',async()=>{
  const h=harness({native:true});await h.refresh();
  await h.nativeOptions.onSolveCurrent(h.nativeOptions.resolveContext());
  h.navigate(11);
  await h.button('İnceledim · Kadroyu SBC’ye uygula').click();
  assert.deepEqual(h.writes,[]);
  assert.ok(h.elements.some(element=>element.textContent.includes('SBC ekranı değişti')));
});
test('navigation during native Apply inventory refresh prevents squad mutation',async()=>{
  const h=harness({native:true});await h.refresh();
  await h.nativeOptions.onSolveCurrent(h.nativeOptions.resolveContext());
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  h.ctx.services.Club.search=()=>({observe(owner,callback){entered();release=()=>callback(this,{success:true,status:200,data:{items:h.players,retrievedAll:true}});},unobserve(){}});
  const pending=h.button('İnceledim · Kadroyu SBC’ye uygula').click();await started;
  h.navigate(11);release();await pending;
  assert.deepEqual(h.writes,[]);
  assert.ok(h.elements.some(element=>element.textContent.includes('SBC ekranı değişti')));
});
test('EA boolean tradable and legacy untradeable map conservatively, including unknown and conflicts',async()=>{
  const h=harness();
  for(const item of h.players) delete item.untradeable;
  h.players[0].tradable=false;h.players[1].tradable=true;
  h.players[2].untradeable=true;h.players[3].untradeable=false;
  h.players[5].tradable='false';h.players[6].untradeable='true';
  h.players[7].tradable=true;h.players[7].untradeable=true;
  h.players[8].tradable=false;h.players[8].untradeable=false;
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.deepEqual(h.requests[0].clubPlayers.slice(0,9).map(p=>p.isUntradeable),[true,false,true,false,false,false,false,false,false]);
  assert.deepEqual(h.requests[0].clubPlayers.slice(0,9).map(p=>p.tradeabilityKnown),[true,true,true,true,false,false,false,false,false]);
  assert.ok(h.elements.some(element=>element.textContent.includes('satış durumu bilinmiyor')));
});
test('untradeable-only policy excludes current tradeable and unknown metadata',async()=>{
  const h=harness();h.players[0].tradable=true;delete h.players[0].untradeable;
  delete h.players[1].untradeable;
  const input=h.elements.find(e=>e.tag==='label'&&e.textContent.includes('Satılabilir kartlara izin ver')).children.find(e=>e.tag==='input');
  input.checked=false;await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].clubPlayers.some(p=>p.id===1||p.id===2),false);
});
test('active squad players are excluded from solve and sent as hard inventory locks',async()=>{
  const h=harness();h.activeSquadPlayers.push({_item:h.players[0]},{_item:{id:0}});
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].clubPlayers.some(p=>p.id===1),false);
  assert.ok(h.requests[0].solverPolicy.lockedItemIds.includes('1'));
  assert.deepEqual(h.writes,[]);
});
test('active squad membership is read again before reviewed Apply',async()=>{
  const h=harness();await h.refresh();await h.button('Çöz ve önizle').click();
  h.activeSquadPlayers.push({_item:h.players[0]});
  await h.button('İnceledim · Kadroyu SBC’ye uygula').click();
  assert.deepEqual(h.writes,[]);assert.ok(h.elements.some(e=>e.textContent.includes('Locked player')));
});
test('EA Bio zero-game getters allow owned cards and display their match count in review',async()=>{
  const h=harness();await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].solverPolicy.protectPlayed,true);
  assert.ok(h.requests[0].clubPlayers.every(p=>p.gamesPlayed===0));
  const checkbox=h.elements.find(e=>e.tag==='label'&&e.textContent.includes('Oynanmış kartları koru')).children.find(e=>e.tag==='input');
  assert.equal(checkbox.checked,true);
  const all=[];const visit=e=>{all.push(e);e.children.forEach(visit);if(e.shadowRoot)visit(e.shadowRoot);};visit(h.ctx.document.documentElement);
  const table=all.find(e=>e.tag==='table');
  assert.equal(table.children[0].children[3].textContent,'Maç');
  assert.equal(table.children[1].children[3].textContent,'0');
  assert.ok(all.some(e=>e.textContent.includes('EA’nın sıfır gösterdiği kayıtlar bağımsız olarak doğrulanmaz')));
});
test('played and malformed EA Bio stats are excluded from the solve inventory',async()=>{
  const changes=[
    p=>{p.getTotalGamesPlayed=()=>505;p.getLifetimeStats=()=>[505,0,0,0,0];},
    p=>{p.getStats=()=>[1,0,0,0,0];},
    p=>{delete p.getTotalGamesPlayed;},p=>{delete p.getLifetimeStats;},p=>{delete p.getStats;},
    p=>{p.getTotalGamesPlayed=()=>NaN;},p=>{p.getTotalGamesPlayed=()=>Infinity;},
    p=>{p.getTotalGamesPlayed=()=>0.5;},p=>{p.getTotalGamesPlayed=()=>-1;},
    p=>{p.getTotalGamesPlayed=()=>'0';},p=>{p.getLifetimeStats=()=>[1,0,0,0,0];},
    p=>{p.getLifetimeStats=()=>[0];},p=>{p.getStats=()=>null;},p=>{p.getStats=()=>[0,,,,];},
    p=>{p.getStats=()=>[0,0,0,0,NaN];},p=>{p.getStats=()=>{throw new Error('Unavailable');};}
  ];
  for (const change of changes) {
    const h=harness();change(h.players[0]);await h.refresh();await h.button('Çöz ve önizle').click();
    assert.equal(h.requests[0].clubPlayers.length,11);
    assert.equal(h.requests[0].clubPlayers.some(p=>p.id===1),false);
    assert.deepEqual(h.writes,[]);
  }
});
test('played or unknown stats discovered during Apply re-read stop all squad mutation',async()=>{
  for(const change of [
    p=>{p.getTotalGamesPlayed=()=>1;p.getLifetimeStats=()=>[1,0,0,0,0];},
    p=>{p.getStats=()=>[2,0,0,0,0];},
    p=>{delete p.getTotalGamesPlayed;},
    p=>{p.getStats=()=>[NaN,0,0,0,0];}
  ]) {
    const h=harness();await h.refresh();await h.button('Çöz ve önizle').click();
    change(h.players[0]);await h.button('İnceledim · Kadroyu SBC’ye uygula').click();
    assert.deepEqual(h.writes,[]);
    assert.ok(h.elements.some(e=>/Protected played card|Games played unknown/.test(e.textContent)));
  }
});
test('unreadable active squad blocks solving instead of treating the roster as empty',async()=>{
  const h=harness();h.ctx.services.Squad.requestSquadById=()=>observable({squad:{}});
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);
  assert.ok(h.elements.some(e=>e.textContent.includes('Aktif kadro oyuncuları okunamadı')));
});
test('storage rarity fallback is consistent and unknown rarity remains protected without boolean proof',async()=>{
  const h=harness(), localized=[];
  const storage=Array.from({length:5},(_,i)=>({...h.players[i],id:100+i,definitionId:5000+i,assetId:6000+i,_metaData:{id:6000+i},isSpecial:undefined}));
  storage.forEach(p=>{delete p.rareflag;});
  storage[0]._rareflag=3;storage[1]._rareflag='0';
  storage[3].isSpecial=()=>false;
  storage[4].rareflag=1;storage[4]._rareflag=3;
  h.ctx.services.Item.searchStorageItems=()=>observable({items:storage,endOfList:true});
  h.ctx.services.Localization.localize=key=>{localized.push(key);return key;};
  await h.refresh();await h.button('Çöz ve önizle').click();
  const candidates=h.requests[0].clubPlayers;
  assert.equal(candidates.some(p=>p.id===100||p.id===102),false);
  assert.equal(candidates.find(p=>p.id===101).rarityId,0);
  assert.equal(candidates.find(p=>p.id===101).cardType,'item.raretype0');
  assert.equal(candidates.find(p=>p.id===103).isSpecial,false);
  assert.equal(candidates.find(p=>p.id===104).rarityId,1);
  assert.ok(localized.includes('item.raretype3'));
  assert.equal(localized.includes('item.raretypeundefined'),false);
});
test('each inventory read refreshes club cache before traversing cumulative search results',async()=>{
  const h=harness();let refreshed=false,resets=0,stats=0;const offsets=[];
  h.ctx.services.Club.clubDao.resetStatsCache=()=>{refreshed=true;resets++;};
  h.ctx.services.Club.getStats=()=>{stats++;return observable({});};
  h.ctx.services.Club.search=criteria=>{
    offsets.push(criteria.offset);
    if(!refreshed)return observable({items:h.players,retrievedAll:false});
    if(criteria.offset===0)return observable({items:h.players.slice(0,7),retrievedAll:false});
    refreshed=false;return observable({items:h.players,retrievedAll:true});
  };
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].clubPlayers.length,12);
  await h.button('İnceledim · Kadroyu SBC’ye uygula').click();
  assert.equal(resets,2);assert.equal(stats,2);assert.deepEqual(offsets,[0,91,0,91]);
  assert.deepEqual(h.writes,['removeAllItems','setPlayers','saveChallenge']);
});
test('repeated pages after cache refresh still block with source and count diagnostics',async()=>{
  const h=harness();h.ctx.services.Club.search=()=>observable({items:h.players,retrievedAll:false});
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);
  assert.ok(h.elements.some(e=>e.textContent.includes('Club players: offset=91, rows=12, unique=12, retrievedAll=false, endOfList=missing')));
});
const eaConcept=player=>({id:0,concept:true,definitionId:player.definitionId,assetId:player.assetId,rating:player.rating,rareflag:player.rarityId,isPlayer:()=>true,compareResourceTo(other){return this.assetId===other.assetId;}});
test('reviewed mixed Apply uses exact EA concept entities and retains the shopping list without spending',async()=>{
  const concept=marketCard(), raw=eaConcept(concept), searches=[];
  const h=harness({solve:input=>marketResult(input,[concept])});
  h.ctx.services.Item.searchConceptItems=criteria=>{searches.push([...criteria.defId]);return observable({items:[raw]});};
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.deepEqual(h.writes,[]);await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(searches,[[concept.definitionId]]);
  assert.deepEqual(h.writes,['removeAllItems','setPlayers','saveChallenge']);
  assert.equal(h.squad._players[10]._item,raw);assert.equal(h.squad._players[0]._item,h.players[0]);
  assert.equal(h.squad._players[10]._item.concept,true);
  assert.equal(h.button('Konseptleri kadroya yerleştir').disabled,true);
  assert.ok(h.elements.some(e=>e.textContent.includes('Alışveriş listesi')));
  assert.ok(h.elements.some(e=>e.textContent.includes('Coin harcanmadı')));
});
test('EA revision metadata uses native databaseId for athlete identity in owned and concept cards',async()=>{
  const concept={...marketCard(50599553),assetId:267905,rating:69,name:'Bertuğ Yıldırım'};
  const raw={...eaConcept(concept),_metaData:{id:50599553},get databaseId(){return this.definitionId & 0xFFFFFF;},getAssetId:()=>0};
  delete raw.assetId;
  const h=harness({solve:input=>marketResult(input,[concept])});
  const owned=h.players[0];
  owned.definitionId=50599554;owned._metaData.id=50599554;delete owned.assetId;
  Object.defineProperty(owned,'databaseId',{get(){return this.definitionId & 0xFFFFFF;}});
  h.squad._players[0]={_item:owned};
  h.ctx.services.Item.searchConceptItems=()=>observable({items:[raw]});
  await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].clubPlayers[0].assetId,267906);
  assert.equal(h.requests[0].sbcData.currentSolution[0],267906);
  await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,['removeAllItems','setPlayers','saveChallenge']);
  assert.equal(h.squad._players[10]._item,raw);
  assert.equal(h.squad._players[10]._item.definitionId,50599553);
});
test('native databaseId mismatch remains blocked and reports only failed metadata fields',async()=>{
  const concept={...marketCard(50599553),assetId:267905,rating:69};
  const raw={...eaConcept(concept),databaseId:267906,_metaData:{id:50599553}};
  const h=harness({solve:input=>marketResult(input,[concept])});
  h.ctx.services.Item.searchConceptItems=()=>observable({items:[raw]});
  await h.refresh();await h.button('Çöz ve önizle').click();await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,[]);
  const status=h.elements.find(e=>e.tag==='p'&&e.textContent.includes('EA konsept kart kimliği uyuşmuyor'));
  assert.ok(status);
  assert.match(status.textContent,/oyuncu kimliği: beklenen 267905, gelen 267906/);
  assert.doesNotMatch(status.textContent,/reyting:|nadirlik:|konsept:/);
});
test('missing, duplicate, owned and mismatched EA concept results never mutate a squad',async t=>{
  const concept=marketCard();
  for(const [name,items] of [
    ['missing',[]],['duplicate',[eaConcept(concept),eaConcept(concept)]],
    ['wrong definition',[{...eaConcept(concept),definitionId:1}]],
    ['different revision of same athlete',[{...eaConcept(concept),definitionId:concept.definitionId+0x1000000}]],
    ['wrong athlete',[{...eaConcept(concept),assetId:1}]],
    ['missing athlete',[{...eaConcept(concept),assetId:undefined}]],
    ['wrong rating',[{...eaConcept(concept),rating:99}]],
    ['wrong rarity',[{...eaConcept(concept),rareflag:3}]],
    ['explicit owned',[{...eaConcept(concept),concept:false}]],
    ['missing concept flag',[{...eaConcept(concept),concept:undefined}]],
    ['missing player method',[{...eaConcept(concept),isPlayer:undefined}]],
    ['missing EA item id',[{...eaConcept(concept),id:undefined}]],
    ['owned inventory id',[{...eaConcept(concept),id:1}]],
    ['nonplayer',[{...eaConcept(concept),isPlayer:()=>false}]],
    ['EA special protection',[{...eaConcept(concept),isSpecial:()=>true}]],
    ['EA evolution protection',[{...eaConcept(concept),isEvolution:()=>true}]]
  ]) await t.test(name,async()=>{
    const h=harness({solve:input=>marketResult(input,[concept])});
    h.ctx.services.Item.searchConceptItems=()=>observable({items});
    await h.refresh();await h.button('Çöz ve önizle').click();await h.button('Konseptleri kadroya yerleştir').click();
    assert.deepEqual(h.writes,[]);
  });
});
test('all concepts must resolve before any owned or concept placement',async()=>{
  const concepts=[marketCard(),marketCard(10000)];
  const h=harness({solve:input=>marketResult(input,concepts,9)});
  h.ctx.services.Item.searchConceptItems=criteria=>observable({items:criteria.defId[0]===9999?[eaConcept(concepts[0])]:[]});
  await h.refresh();await h.button('Çöz ve önizle').click();await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,[]);
});
test('locks inserted while EA concepts load are rechecked before mutation',async()=>{
  const concept=marketCard(),h=harness({solve:input=>marketResult(input,[concept])});
  h.ctx.services.Item.searchConceptItems=()=>({observe(owner,callback){h.localStorage.setItem('paletools:2026:account:lockedItems','[9999]');queueMicrotask(()=>callback(this,{success:true,data:{items:[eaConcept(concept)]}}));},unobserve(){}});
  await h.refresh();await h.button('Çöz ve önizle').click();await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,[]);assert.ok(h.elements.some(e=>e.textContent.includes('Paletools lock')));
});
test('navigation during EA concept resolution stops Apply before squad changes',async()=>{
  const concept=marketCard(),h=harness({native:true,solve:input=>marketResult(input,[concept])});
  h.ctx.services.Item.searchConceptItems=()=>({observe(owner,callback){h.navigate(11);queueMicrotask(()=>callback(this,{success:true,data:{items:[eaConcept(concept)]}}));},unobserve(){}});
  await h.refresh();await h.nativeOptions.onSolveCurrent(h.nativeOptions.resolveContext());await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,[]);assert.ok(h.elements.some(e=>e.textContent.includes('SBC ekranı değişti')));
});
test('concept quote freshness is rechecked after EA lookup even within preview lifetime',async()=>{
  const concept=marketCard(),started=Date.now();concept.priceSnapshotAt=new Date(started-(6*60-1)*60000).toISOString();
  const h=harness({solve:input=>marketResult(input,[concept])});
  h.ctx.services.Item.searchConceptItems=()=>({observe(owner,callback){h.ctx.Date=class extends Date{static now(){return started+2*60000;}};queueMicrotask(()=>callback(this,{success:true,data:{items:[eaConcept(concept)]}}));},unobserve(){}});
  await h.refresh();await h.button('Çöz ve önizle').click();await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,[]);assert.ok(h.elements.some(e=>e.textContent.includes('fresh, positive market quote')));
});
test('expired concept preview and a wrong initialized challenge both stop before mutation',async t=>{
  await t.test('preview expired',async()=>{
    const concept=marketCard(),h=harness({solve:input=>marketResult(input,[concept])});let searches=0;
    h.ctx.services.Item.searchConceptItems=()=>{searches++;return observable({items:[eaConcept(concept)]});};
    await h.refresh();await h.button('Çöz ve önizle').click();const future=Date.now()+6*60000;
    h.ctx.Date=class extends Date{static now(){return future;}};
    await h.button('Konseptleri kadroya yerleştir').click();assert.equal(searches,0);assert.deepEqual(h.writes,[]);
  });
  await t.test('wrong controller challenge',async()=>{
    const concept=marketCard(),h=harness({solve:input=>marketResult(input,[concept])});
    h.ctx.services.Item.searchConceptItems=()=>observable({items:[eaConcept(concept)]});
    await h.refresh();await h.button('Çöz ve önizle').click();
    h.ctx.UTSBCSquadOverviewViewController=class{initWithSBCSet(){this._squad=h.squad;this._challenge={id:999,setId:20};}};
    await h.button('Konseptleri kadroya yerleştir').click();assert.deepEqual(h.writes,[]);
  });
});
test('a concept cannot displace a preserved reserve version of the same athlete',async()=>{
  const concept=marketCard(),h=harness({solve:input=>marketResult(input,[concept])});
  const reserve={...h.players[11],definitionId:99999,assetId:concept.assetId};h.squad._players.push({_item:reserve});
  h.ctx.services.Item.searchConceptItems=()=>observable({items:[eaConcept(concept)]});
  await h.refresh();await h.button('Çöz ve önizle').click();await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,[]);assert.equal(h.squad._players[11]._item,reserve);
});
test('EA placement omissions block save and clear newly populated slots during rollback',async()=>{
  const concept=marketCard(),h=harness({solve:input=>marketResult(input,[concept])});
  const oldItems=h.squad._players.map(slot=>slot._item),originalSet=h.squad.setPlayers;let calls=0;
  h.squad.setPlayers=function(items){calls++;originalSet.call(this,items);if(calls===1)this._players[10]={_item:{id:0,isPlayer:()=>false}};};
  h.ctx.services.Item.searchConceptItems=()=>observable({items:[eaConcept(concept)]});
  await h.refresh();await h.button('Çöz ve önizle').click();await h.button('Konseptleri kadroya yerleştir').click();
  assert.deepEqual(h.writes,['removeAllItems','setPlayers','removeAllItems','setPlayers']);
  oldItems.forEach((item,i)=>assert.equal(h.squad._players[i]._item,item));
});
function marketSearchHarness(search){
  const concept={...marketCard(),rating:65};
  const h=harness({solve:input=>{
    const observation=input.liveMarket,quote=observation.quotes.find(q=>q.definitionId===concept.definitionId);
    const proof={...concept,marketPrice:quote.buyNowPrice,priceSource:'EA Transfer Market',priceSnapshotAt:observation.observedAt,priceFetchedAt:observation.observedAt,liveQuoteExpiresAt:new Date(Date.parse(observation.observedAt)+120000).toISOString()};
    return marketResult(input,[proof]);
  }});
  const calls=[],clears=[];
  Object.assign(h.ctx,{UTSearchCriteriaDTO:class{constructor(){this.type='player';this.count=20;this.offset=0;}},
    ItemType:{PLAYER:'player'},ItemSearchFeature:{MARKET:'market'},SearchLevel:{BRONZE:'bronze',SILVER:'silver',GOLD:'gold'},ItemRatingTier:{BRONZE:1,SILVER:2,GOLD:3},
    UTBucketedItemSearchViewModel:class{constructor(){this.searchCriteria={};this.defaultSearchCriteria={};}updateSearchCriteria(value){Object.assign(this.searchCriteria,value);}}});
  const listing=(extra={})=>({...eaConcept(concept),concept:false,id:7000,getTier:()=>2,
    getAuctionData:()=>({buyNowPrice:200,isActiveTrade:()=>true,getSecondsRemaining:()=>90,tradeId:'never-send-this'}),...extra});
  h.ctx.services.Item.clearTransferMarketCache=()=>clears.push(calls.length);
  h.ctx.services.Item.searchTransferMarket=(query,page)=>{query.offset=(page-1)*20;query.count=21;calls.push({...query,page});return observable({items:search?search(query,page,listing):query.maxBuy<200?[]:[listing()]});};
  return {...h,calls,clears,listing,concept};
}
test('live market mode searches official EA API, resets changed queries and sends only observed quote fields',async()=>{
  const h=marketSearchHarness();await h.refresh();await h.button('Anlık piyasadan çöz').click();
  assert.deepEqual(h.calls.map(c=>[c.maxBuy,c.page]),[[150,1],[200,1]]);assert.deepEqual(h.clears,[0,1]);
  h.calls.forEach(c=>{assert.equal(c.type,'player');assert.equal(c.level,'silver');assert.equal(c.disableOverrides,true);assert.deepEqual([...c.rarities],[0,1]);});
  const live=h.requests[0].liveMarket;assert.equal(live.pagesRead,2);assert.equal(live.searchMaxBuy,200);
  assert.deepEqual(live.quotes,[{definitionId:h.concept.definitionId,buyNowPrice:200}]);
  assert.equal(JSON.stringify(h.requests[0]).includes('never-send-this'),false);
  assert.equal(h.button('Konseptleri kadroya yerleştir').disabled,false);assert.deepEqual(h.writes,[]);
  assert.ok(h.elements.some(e=>e.textContent.includes('Anlık EA piyasası')));
});
test('live market ignores expired, inactive, zero-BIN, wrong-tier and protected listings',async()=>{
  const h=marketSearchHarness((query,page,listing)=>query.maxBuy<200?[]:[
    listing({getAuctionData:()=>({buyNowPrice:1,isActiveTrade:()=>false,getSecondsRemaining:()=>90})}),
    listing({getAuctionData:()=>({buyNowPrice:1,isActiveTrade:()=>true,getSecondsRemaining:()=>0})}),
    listing({getAuctionData:()=>({buyNowPrice:0,isActiveTrade:()=>true,getSecondsRemaining:()=>90})}),
    listing({getTier:()=>3}),listing({rareflag:3}),listing()
  ]);
  await h.refresh();await h.button('Anlık piyasadan çöz').click();assert.deepEqual(h.requests[0].liveMarket.quotes,[{definitionId:h.concept.definitionId,buyNowPrice:200}]);
});
test('market pagination uses EA-mutated count and page argument with a nine-request bound',async t=>{
  await t.test('lookahead page',async()=>{
    const h=marketSearchHarness((query,page,listing)=>query.maxBuy===150?(page===1?Array.from({length:21},()=>listing({rareflag:3})):[]):[listing()]);
    await h.refresh();await h.button('Anlık piyasadan çöz').click();assert.deepEqual(h.calls.map(c=>[c.maxBuy,c.page]),[[150,1],[150,2],[200,1]]);assert.deepEqual(h.clears,[0,2]);
  });
  await t.test('bounded full pages',async()=>{
    const h=marketSearchHarness((query,page,listing)=>Array.from({length:21},()=>listing({rareflag:3})));
    await h.refresh();await h.button('Anlık piyasadan çöz').click();assert.equal(h.calls.length,9);assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);
  });
});

function batchHarness(overrides={}) {
  const h=harness(overrides);
  Object.assign(h.set,{isRepeatable:false,isLimitedRepeatable:false,timesCompleted:0,awards:[]});
  Object.assign(h.challenge,{timesCompleted:0,awards:[],canSubmit:()=>true,hasUntradeableItems:()=>true});
  h.ctx.UTEventTokenUtils={hasEventTokenReward:()=>false};
  h.ctx.UTServerSettingsRepository={KEY:{SBC_ALLOW_UNTRADEABLE:'allow-untradeable'}};
  h.ctx.services.EventToken={isEventTokenEarningDisabled:()=>false};
  h.ctx.services.Configuration={getFeatureSetting:()=>true};
  h.ctx.services.Chemistry.isFeatureEnabled=()=>true;
  h.ctx.services.SBC.reset=()=>{};
  h.ctx.services.SBC.submitChallenge=(challenge,set,skip,chem)=>{
    assert.equal(skip,false);assert.equal(chem,true);h.writes.push('submitChallenge');
    challenge.timesCompleted++;set.timesCompleted++;challenge.status='COMPLETED';
    return observable({setId:set.id,challengeId:challenge.id,setCompleted:true,grantedChallengeAwards:[]});
  };
  const consent=h.elements.find(e=>e.tag==='label'&&e.textContent.startsWith('Bu sıradaki kadroları')).children[0];
  h.prepare=async()=>{await h.refresh();await h.button('Seçili seti sıraya ekle').click();consent.checked=true;await Promise.all(consent.listeners.change.map(fn=>fn()));};
  h.report=()=>JSON.parse(h.localStorage.getItem('autosbc.local.batch.v1'));
  return h;
}
test('explicit batch solves, saves, submits, verifies reward counters and completes one selected set',async()=>{
  const h=batchHarness();await h.prepare();await h.button('Sırayı otomatik tamamla').click();
  assert.deepEqual(h.writes,['removeAllItems','setPlayers','saveChallenge','submitChallenge']);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].solverPolicy.allowConcept,false);
  assert.equal(h.requests[0].solverPolicy.protectPlayed,true);assert.equal(h.requests[0].solverPolicy.protectEvolutions,true);
  assert.equal(h.report().snapshot.status,'completed');assert.equal(h.report().snapshot.progress.confirmedChallenges,1);
  assert.equal(h.report().receipts[0].coinSpent,0);assert.equal(h.report().receipts[0].rewardsGranted,true);
});
test('batch checks native eligibility and service untradeable gate before submit',async t=>{
  for(const name of ['eligibility','untradeable','event-token']) await t.test(name,async()=>{
    const h=batchHarness();
    if(name==='eligibility')h.challenge.canSubmit=()=>false;
    if(name==='untradeable')h.ctx.services.Configuration.getFeatureSetting=()=>false;
    if(name==='event-token'){h.ctx.UTEventTokenUtils.hasEventTokenReward=()=>true;h.ctx.services.EventToken.isEventTokenEarningDisabled=()=>true;}
    await h.prepare();await h.button('Sırayı otomatik tamamla').click();
    assert.equal(h.writes.includes('submitChallenge'),false);assert.equal(h.report().snapshot.status,'blocked');
  });
});
test('batch reuses its initial set snapshot for solve and refreshes before and after submission',async()=>{
  const h=batchHarness();await h.prepare();let setReads=0;const requestSets=h.ctx.services.SBC.requestSets;
  h.ctx.services.SBC.requestSets=()=>{setReads++;return requestSets();};
  await h.button('Sırayı otomatik tamamla').click();
  assert.equal(h.report().snapshot.status,'completed');assert.equal(setReads,3);
  assert.equal(h.timerDelays.filter(delay=>delay===500).length,4,'reward check is paced in four cancellable 500ms chunks');
});
test('batch stops if played history or an active squad lock changes after save',async t=>{
  for(const name of ['played','active'])await t.test(name,async()=>{
    const h=batchHarness();h.ctx.services.SBC.saveChallenge=()=>{
      h.writes.push('saveChallenge');
      if(name==='played')h.players[0].getStats=()=>[1,0,0,0,0];
      else h.activeSquadPlayers.push({_item:h.players[0]});
      return observable({});
    };
    await h.prepare();await h.button('Sırayı otomatik tamamla').click();
    assert.equal(h.writes.includes('submitChallenge'),false);assert.equal(h.report().snapshot.status,'blocked');
  });
});
test('batch rejects a changed saved squad and does not submit or consume another card',async()=>{
  const h=batchHarness();let loads=0;
  h.ctx.services.SBC.loadChallenge=()=>{loads++;if(loads===3)h.squad._players[0]._item=h.players[11];return observable(h.challenge);};
  await h.prepare();await h.button('Sırayı otomatik tamamla').click();
  assert.equal(h.writes.includes('submitChallenge'),false);assert.match(h.report().phase,/kaydedilmiş kadro/);
});
test('batch validates submit identity and never retries an uncertain submission',async()=>{
  const h=batchHarness();h.ctx.services.SBC.submitChallenge=()=>{h.writes.push('submitChallenge');return observable({setId:999,challengeId:10,setCompleted:true,grantedChallengeAwards:[]});};
  await h.prepare();await h.button('Sırayı otomatik tamamla').click();
  assert.equal(h.writes.filter(x=>x==='submitChallenge').length,1);assert.equal(h.report().snapshot.status,'blocked');
  const consent=h.elements.find(e=>e.tag==='label'&&e.textContent.startsWith('Bu sıradaki kadroları')).children[0];
  consent.checked=true;await Promise.all(consent.listeners.change.map(fn=>fn()));await h.button('Sırayı otomatik tamamla').click();
  assert.equal(h.writes.filter(x=>x==='submitChallenge').length,1);
});
test('batch stop while native submit internally saves records the in-flight result and starts no next step',async()=>{
  const h=batchHarness();let release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  h.ctx.services.SBC.submitChallenge=(challenge,set)=>({observe(owner,callback){h.writes.push('submitChallenge');started();release=()=>{challenge.timesCompleted++;set.timesCompleted++;callback(this,{success:true,status:200,data:{setId:20,challengeId:10,setCompleted:true,grantedChallengeAwards:[]}});};},unobserve(){}});
  await h.prepare();const pending=h.button('Sırayı otomatik tamamla').click();await entered;
  await h.button('Sırayı durdur').click();release();await pending;
  assert.equal(h.writes.filter(x=>x==='submitChallenge').length,1);assert.equal(h.report().snapshot.status,'stopped');
  assert.equal(h.report().receipts.length,1);assert.equal(h.report().receipts[0].completed,true);
  const consent=h.elements.find(e=>e.tag==='label'&&e.textContent.startsWith('Bu sıradaki kadroları')).children[0];
  consent.checked=true;await Promise.all(consent.listeners.change.map(fn=>fn()));await h.button('Sırayı otomatik tamamla').click();
  assert.equal(h.writes.filter(x=>x==='submitChallenge').length,1,'a confirmed submit awaiting read verification cannot run again');
});
test('batch cannot dispatch save when durable pending journal fails',async()=>{
  const h=batchHarness();await h.prepare();const save=h.localStorage.setItem.bind(h.localStorage);
  h.localStorage.setItem=(key,value)=>{if(key==='autosbc.local.batch.v1'&&JSON.parse(value).phase==='save')throw new Error('Storage full');save(key,value);};
  await h.button('Sırayı otomatik tamamla').click();assert.deepEqual(h.writes,[]);
});
test('batch rechecks Paletools locks added while loading the saved challenge and at dispatch journaling',async t=>{
  for(const phase of ['load','dispatch'])await t.test(phase,async()=>{
    const h=batchHarness();let loads=0;
    if(phase==='load')h.ctx.services.SBC.loadChallenge=()=>{loads++;if(loads===3)h.localStorage.setItem('paletools:2026:account:lockedItems','[1000]');return observable(h.challenge);};
    else {const save=h.localStorage.setItem.bind(h.localStorage);h.localStorage.setItem=(key,value)=>{save(key,value);if(key==='autosbc.local.batch.v1'&&JSON.parse(value).phase==='submit')save('paletools:2026:account:lockedItems','[1000]');};}
    await h.prepare();await h.button('Sırayı otomatik tamamla').click();
    assert.equal(h.writes.includes('submitChallenge'),false);assert.match(h.report().phase,/Paletools lock/);
  });
});

function dailyHarness({kind='silver',repeats=2,...overrides}={}) {
  const h=batchHarness(overrides), names={bronze:'Daily Bronze Upgrade',silver:'Daily Silver Upgrade',common:'Daily Common Gold Upgrade',rare:'Daily Rare Gold Upgrade'};
  Object.assign(h.set,{name:names[kind],isRepeatable:true,isLimitedRepeatable:true,repeats,timesCompleted:0,endTime:Date.now()+3600000,
    isComplete:()=>false,hasExpired:flag=>{assert.equal(flag,false);return false;},getTimeRemaining:()=>3600,
    getRepeatsRemaining:()=>h.set.repeats-h.set.timesCompleted});
  const rating=kind==='bronze'?60:kind==='silver'?65:80;
  for (let i=12;i<24;i++)h.players.push({...h.players[i%12],id:i+1,definitionId:1000+i,assetId:2000+i,_metaData:{id:2000+i},_staticData:{name:`Player ${i+1}`}});
  h.players.forEach(player=>{player.rating=rating;player.getTier=()=>kind==='bronze'?1:kind==='silver'?2:3;});
  const consumed=new Set();
  h.ctx.services.Club.search=()=>observable({items:h.players.filter(player=>!consumed.has(player.id)),retrievedAll:true});
  h.ctx.services.SBC.submitChallenge=(challenge,set)=>{
    h.writes.push('submitChallenge');h.squad._players.slice(0,11).forEach(slot=>consumed.add(slot._item.id));
    challenge.timesCompleted++;set.timesCompleted++;challenge.status='IN_PROGRESS';
    return observable({setId:set.id,challengeId:challenge.id,setCompleted:true,grantedChallengeAwards:[]});
  };
  h.dailyConsent=h.elements.find(e=>e.tag==='label'&&e.textContent.startsWith('Gösterilen daily')).children[0];
  h.readDailies=async()=>{await h.refresh();await h.button('Daily’leri otomatik yap').click();};
  h.consentDailies=async()=>{h.dailyConsent.checked=true;await Promise.all(h.dailyConsent.listeners.change.map(fn=>fn()));};
  h.dailyReport=()=>JSON.parse(h.localStorage.getItem('autosbc.local.daily.v1'));
  h.control=label=>h.elements.find(e=>e.tag==='label'&&e.textContent.startsWith(label)).children[0];
  return h;
}
test('daily one-click plan is read-only and explicit start executes exactly its finite rights',async()=>{
  const h=dailyHarness();await h.readDailies();
  assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);assert.equal(h.button('Daily planını başlat').disabled,true);
  assert.ok(h.elements.some(e=>e.tag==='ol'&&e.textContent.includes('Daily Silver Upgrade: 2 tekrar')));
  await h.consentDailies();await h.button('Daily planını başlat').click();
  assert.equal(h.writes.filter(write=>write==='submitChallenge').length,2);
  assert.equal(h.requests.length,2);
  assert.equal(h.dailyReport().status,'completed');
  assert.deepEqual(h.dailyReport().progress,{completedCycles:2,totalCycles:2,confirmedParts:2});
  assert.equal(h.dailyReport().plan.entries.length,2);
  assert.equal(h.button('Daily planını başlat').disabled,true);
});
test('daily restores exact manual policy, selected set, queue and consent afterward',async()=>{
  const h=dailyHarness({repeats:1});await h.prepare();
  const policyControls=['Özel kartları koru','Evolution kartlarını koru','Oynanmış kartları koru'];
  policyControls.forEach(label=>{h.control(label).checked=false;});
  h.control('En yüksek oyuncu reytingi').value=98;h.control('Kart başına değer limiti').value=1750;
  h.control('Eksik yerleri fiyatlı').checked=true;
  const original='{"manual":"preserve byte for byte"}';h.localStorage.setItem('autosbc.local.policy.v1',original);
  const selection=h.selects.slice(0,4).map(control=>control.value);
  await h.button('Daily’leri otomatik yap').click();await h.consentDailies();await h.button('Daily planını başlat').click();
  assert.equal(h.dailyReport().status,'completed');assert.equal(h.localStorage.getItem('autosbc.local.policy.v1'),original);
  assert.deepEqual(h.selects.slice(0,4).map(control=>control.value),selection);
  policyControls.forEach(label=>assert.equal(h.control(label).checked,false));
  assert.equal(h.control('En yüksek oyuncu reytingi').value,'98');assert.equal(h.control('Kart başına değer limiti').value,'1750');
  assert.equal(h.control('Eksik yerleri fiyatlı').checked,true);
  assert.ok(h.elements.some(e=>e.tag==='ol'&&e.textContent===h.set.name));
  assert.equal(h.control('Bu sıradaki kadroları').checked,true);
  const request=h.requests[0].solverPolicy;
  assert.equal(request.maxRating,74);assert.equal(request.maxPlayerPrice,1000);
  assert.equal(request.protectSpecial,true);assert.equal(request.protectEvolutions,true);assert.equal(request.protectPlayed,true);assert.equal(request.allowConcept,false);
});
test('daily rating ceilings and lower user price limits are preserved per kind',async t=>{
  for(const [kind,maxRating] of [['bronze',64],['silver',74],['common',82],['rare',82]])await t.test(kind,async()=>{
    const h=dailyHarness({kind,repeats:1});h.control('Kart başına değer limiti').value=500;
    await h.readDailies();await h.consentDailies();await h.button('Daily planını başlat').click();
    assert.equal(h.dailyReport().status,'completed');assert.equal(h.requests[0].solverPolicy.maxRating,maxRating);assert.equal(h.requests[0].solverPolicy.maxPlayerPrice,500);
  });
});
test('daily stop between cycles prevents the next save and preserves confirmed counts',async()=>{
  const h=dailyHarness();await h.readDailies();await h.consentDailies();
  const save=h.localStorage.setItem.bind(h.localStorage);let stopped=false;
  h.localStorage.setItem=(key,value)=>{save(key,value);if(key==='autosbc.local.daily.v1'){
    const report=JSON.parse(value);
    if(!stopped&&report.progress.completedCycles===1&&report.phase.includes('tekrar doğrulandı')){stopped=true;h.button('Daily sırasını durdur').click();}
  }};
  await h.button('Daily planını başlat').click();
  assert.equal(h.writes.filter(write=>write==='submitChallenge').length,1);assert.equal(h.requests.length,1);
  assert.equal(h.dailyReport().status,'stopped');assert.equal(h.dailyReport().progress.completedCycles,1);assert.equal(h.dailyReport().progress.confirmedParts,1);
});
test('daily stops before saving when remaining rights change after planning',async()=>{
  const h=dailyHarness();await h.readDailies();await h.consentDailies();h.set.timesCompleted=1;
  await h.button('Daily planını başlat').click();
  assert.deepEqual(h.writes,[]);assert.equal(h.requests.length,0);assert.match(h.dailyReport().phase,/counters changed/);
});
test('daily rejects malformed native expiry before creating a writable plan',async t=>{
  for(const value of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1,'12345'])await t.test(String(value),async()=>{
    const h=dailyHarness();h.set.endTime=value;await h.readDailies();
    assert.equal(h.button('Daily planını başlat').disabled,true);assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);
    assert.ok(h.elements.some(e=>e.textContent.includes('Daily bitiş zamanı')));
  });
});
test('daily stop during child submit records the in-flight receipt without another cycle',async()=>{
  const h=dailyHarness();await h.readDailies();await h.consentDailies();let release,enter;
  const entered=new Promise(resolve=>{enter=resolve;});
  h.ctx.services.SBC.submitChallenge=(challenge,set)=>({observe(owner,callback){h.writes.push('submitChallenge');enter();release=()=>{challenge.timesCompleted++;set.timesCompleted++;callback(this,{success:true,status:200,data:{setId:set.id,challengeId:challenge.id,setCompleted:true,grantedChallengeAwards:[]}});};},unobserve(){}});
  const pending=h.button('Daily planını başlat').click();await entered;await h.button('Daily sırasını durdur').click();release();await pending;
  assert.equal(h.writes.filter(write=>write==='submitChallenge').length,1);assert.equal(h.dailyReport().status,'stopped');
  assert.equal(h.dailyReport().cycles[0].child.receipts.length,1);assert.equal(h.requests.length,1);
});
test('daily pending parent journal must persist before any child save dispatch',async()=>{
  const h=dailyHarness({repeats:1});await h.readDailies();await h.consentDailies();const save=h.localStorage.setItem.bind(h.localStorage);
  h.localStorage.setItem=(key,value)=>{if(key==='autosbc.local.daily.v1'&&JSON.parse(value).cycles[0]?.child?.phase==='save')throw new Error('Daily journal full');save(key,value);};
  await h.button('Daily planını başlat').click();assert.deepEqual(h.writes,[]);
  assert.ok(h.elements.some(e=>e.textContent.includes('Daily journal full')));
});
test('daily reload never resumes and pending or malformed stored history blocks another plan',async t=>{
  const histories=[
    ['autosbc.local.daily.v1',JSON.stringify({runId:'old',status:'running',plan:{entries:[]},cycles:[{status:'pending'}]})],
    ['autosbc.local.daily.v1','{broken'],['autosbc.local.batch.v1','{broken'],
    ['autosbc.local.batch.v1',JSON.stringify({runId:'old',snapshot:{status:'running',queue:[]}})]
  ];
  for(const [key,value] of histories)await t.test(`${key}:${value.slice(0,16)}`,async()=>{
    const h=dailyHarness({storage:{[key]:value}});assert.deepEqual(h.writes,[]);assert.equal(h.requests.length,0);
    await h.readDailies();assert.equal(h.button('Daily planını başlat').disabled,true);assert.deepEqual(h.writes,[]);
  });
});
test('EA list diagnostics preserve status and safe code without raw response leakage',async()=>{
  const h=batchHarness();await h.prepare();
  h.ctx.services.SBC.requestSets=()=>({observe(owner,callback){queueMicrotask(()=>callback(this,{success:false,status:500,error:{code:'MAX_FAILED_AUTH_ATTEMPTS',secret:'do-not-record'},headers:{Authorization:'do-not-record'}}));},unobserve(){}});
  await h.button('Sırayı otomatik tamamla').click();
  assert.equal(h.report().lastError.status,500);assert.equal(h.report().lastError.code,'MAX_FAILED_AUTH_ATTEMPTS');
  assert.equal(h.report().lastError.operation,'Sıradaki SBC setleri');assert.doesNotMatch(JSON.stringify(h.report()),/do-not-record/);assert.deepEqual(h.writes,[]);
});
test('daily two failed initial list reads make no writes and permit a later fresh plan',async()=>{
  const h=dailyHarness({repeats:1});await h.readDailies();await h.consentDailies();const requestSets=h.ctx.services.SBC.requestSets;let failedReads=0;
  h.ctx.services.SBC.requestSets=()=>({observe(owner,callback){failedReads++;queueMicrotask(()=>callback(this,{success:false,status:429,retryAfter:0.001,error:{code:'RATE_LIMIT'}}));},unobserve(){}});
  await h.button('Daily planını başlat').click();
  assert.equal(failedReads,2);assert.deepEqual(h.writes,[]);assert.equal(h.dailyReport().status,'blocked');assert.equal(h.dailyReport().cycles[0].status,'blocked');
  assert.equal(h.dailyReport().lastError.status,429);assert.equal(h.dailyReport().lastError.retryAfterSeconds,0.001);
  h.ctx.services.SBC.requestSets=requestSets;await h.button('Daily’leri otomatik yap').click();await h.consentDailies();
  assert.equal(h.button('Daily planını başlat').disabled,false);assert.deepEqual(h.writes,[]);
});

function uncertainClaimReport({setCompleted=true}={}) {
  const B=require('../frontend/batch-policy.js');
  const controller=B.createBatch([20]),players=Array.from({length:11},(_,i)=>({id:String(i+1),concept:false,gamesPlayed:0,isEvolution:false}));
  controller.startSet(20,{completed:false,repeatable:false,remaining:1});controller.beginStep(10);controller.readyStep(players);
  for(const action of ['save','submit'])controller.confirmEffect(controller.beginEffect(action,players));
  controller.failEffect(controller.beginEffect('claim'),'Sıradaki SBC setleri: EA returned 521 (521).');
  return {runId:'reconcile-fixture',scope:{gameYear:26,platform:'ps5'},selectedSets:[{id:'20',name:'Test SBC'}],phase:'claim read failed',updatedAt:new Date().toISOString(),
    snapshot:controller.snapshot(),lastError:{status:521,code:521,operation:'Sıradaki SBC setleri'},receipts:[{setId:'20',challengeId:'10',completed:true,rewardsGranted:true,setCompleted,
      at:new Date().toISOString(),beforeChallenge:0,beforeSet:0,cardIds:players.map(player=>player.id),zeroGames:true,coinSpent:0,grantedChallengeAwards:[]}]};
}
function reconciliationHarness({report=uncertainClaimReport(),dailyReport,...overrides}={}) {
  const h=batchHarness({...overrides,storage:{'autosbc.local.batch.v1':JSON.stringify(report),...(dailyReport?{'autosbc.local.daily.v1':JSON.stringify(dailyReport)}:{})}});
  h.originalReport=JSON.parse(JSON.stringify(report));h.set.timesCompleted=1;h.challenge.timesCompleted=1;
  h.selects[0].value='26';h.selects[1].value='ps5';return h;
}
test('read-only reconciliation verifies stored exact submission and stops without an account write',async()=>{
  const h=reconciliationHarness(),old=JSON.stringify(h.originalReport);let reads=0;
  const requestSets=h.ctx.services.SBC.requestSets;h.ctx.services.SBC.requestSets=()=>{reads++;return requestSets();};
  await h.button('Son teslimi doğrula').click();
  const report=h.report();assert.equal(report.snapshot.status,'stopped');assert.equal(report.snapshot.progress.confirmedChallenges,1);
  assert.equal(report.snapshot.progress.completed,1);assert.equal(report.snapshot.queue[0].steps[0].status,'completed');
  assert.deepEqual(report.receipts,h.originalReport.receipts);assert.deepEqual(report.snapshot.ledger.slice(0,h.originalReport.snapshot.ledger.length),h.originalReport.snapshot.ledger);
  assert.equal(JSON.stringify(h.originalReport),old);assert.deepEqual(h.writes,[]);assert.equal(h.requests.length,0);assert.equal(reads,1);
  const reportText=h.localStorage.getItem('autosbc.local.batch.v1');
  await h.button('Son teslimi doğrula').click();assert.equal(reads,1);assert.equal(h.localStorage.getItem('autosbc.local.batch.v1'),reportText);
});
test('reconciliation cannot resolve a write ambiguity or a forged/missing submit confirmation',async t=>{
  for(const kind of ['submit-uncertain','missing-confirmation','receipt-mismatch'])await t.test(kind,async()=>{
    const report=uncertainClaimReport();
    if(kind==='submit-uncertain')report.snapshot.ledger.at(-1).action='submit';
    if(kind==='missing-confirmation')report.snapshot.ledger=report.snapshot.ledger.filter(event=>!(event.action==='submit'&&event.event==='effect-confirmed'));
    if(kind==='receipt-mismatch')report.receipts[0].challengeId='11';
    const h=reconciliationHarness({report});let reads=0;h.ctx.services.SBC.requestSets=()=>{reads++;throw new Error('must not read');};
    const original=h.localStorage.getItem('autosbc.local.batch.v1');await h.button('Son teslimi doğrula').click();
    assert.equal(reads,0);assert.deepEqual(h.writes,[]);assert.equal(h.localStorage.getItem('autosbc.local.batch.v1'),original);
  });
});
test('reconciliation rejects unchanged counters and mismatched scope without clearing evidence',async t=>{
  for(const kind of ['challenge-counter','set-counter','scope'])await t.test(kind,async()=>{
    const h=reconciliationHarness();
    if(kind==='challenge-counter')h.challenge.timesCompleted=0;
    if(kind==='set-counter')h.set.timesCompleted=0;
    if(kind==='scope')h.selects[1].value='pc';
    const original=h.localStorage.getItem('autosbc.local.batch.v1');await h.button('Son teslimi doğrula').click();
    assert.equal(h.localStorage.getItem('autosbc.local.batch.v1'),original);assert.deepEqual(h.writes,[]);
  });
});
test('a 521 during read-only reconciliation is not retried and preserves the original journal',async()=>{
  const h=reconciliationHarness();let reads=0;
  h.ctx.services.SBC.requestSets=()=>({observe(owner,callback){reads++;queueMicrotask(()=>callback(this,{success:false,status:521,error:{code:521}}));},unobserve(){}});
  const original=h.localStorage.getItem('autosbc.local.batch.v1');await h.button('Son teslimi doğrula').click();
  assert.equal(reads,1);assert.equal(h.localStorage.getItem('autosbc.local.batch.v1'),original);assert.deepEqual(h.writes,[]);
});
test('cancel during reconciliation prevents journal updates and further reads',async()=>{
  const h=reconciliationHarness();let release,enter;const entered=new Promise(resolve=>{enter=resolve;});
  h.ctx.services.SBC.requestSets=()=>({observe(owner,callback){enter();release=()=>callback(this,{success:true,data:{sets:[h.set]}});},unobserve(){}});
  const original=h.localStorage.getItem('autosbc.local.batch.v1');const pending=h.button('Son teslimi doğrula').click();await entered;
  await h.button('İptal').click();release();await pending;
  assert.equal(h.localStorage.getItem('autosbc.local.batch.v1'),original);assert.deepEqual(h.writes,[]);
});
function linkedDaily(report) {
  const D=require('../frontend/daily-plan.js');
  const plan=D.createPlan([{id:20,name:'Daily Silver Upgrade',completed:false,expired:false,isRepeatable:true,isLimitedRepeatable:true,repeats:1,timesCompleted:0,remaining:1}]);
  return {runId:'daily-fixture',scope:report.scope,day:new Date().toDateString(),plan,status:'blocked',phase:'old claim uncertainty',currentCycle:0,
    cycles:[{entry:plan.entries[0],status:'pending',child:report}],progress:{completedCycles:0,totalCycles:1,confirmedParts:0}};
}
test('reconciliation updates the matching Daily child while preserving its original evidence',async t=>{
  for(const setCompleted of [false,true])await t.test(String(setCompleted),async()=>{
    const report=uncertainClaimReport({setCompleted}),h=reconciliationHarness({report,dailyReport:linkedDaily(report)});
    await h.button('Son teslimi doğrula').click();
    const daily=JSON.parse(h.localStorage.getItem('autosbc.local.daily.v1'));
    assert.equal(daily.status,'stopped');assert.equal(daily.progress.confirmedParts,1);assert.equal(daily.progress.completedCycles,setCompleted?1:0);
    assert.equal(daily.cycles[0].status,setCompleted?'completed':'blocked');assert.deepEqual(daily.cycles[0].child,h.report());
    assert.deepEqual(daily.cycles[0].child.receipts,report.receipts);assert.deepEqual(h.writes,[]);
  });
});
test('mismatched Daily linkage fails closed before any EA read',async()=>{
  const report=uncertainClaimReport(),daily=linkedDaily(report);daily.cycles[0].child=JSON.parse(JSON.stringify(report));daily.cycles[0].child.phase='different';
  const h=reconciliationHarness({report,dailyReport:daily});let reads=0;h.ctx.services.SBC.requestSets=()=>{reads++;throw new Error('must not read');};
  const original=h.localStorage.getItem('autosbc.local.batch.v1');await h.button('Son teslimi doğrula').click();
  assert.equal(reads,0);assert.equal(h.localStorage.getItem('autosbc.local.batch.v1'),original);assert.deepEqual(h.writes,[]);
});
test('linked journal second-write failure leaves a blocking mismatch instead of resuming',async()=>{
  const report=uncertainClaimReport(),h=reconciliationHarness({report,dailyReport:linkedDaily(report)}),save=h.localStorage.setItem.bind(h.localStorage);
  h.localStorage.setItem=(key,value)=>{if(key==='autosbc.local.batch.v1')throw new Error('Storage full');save(key,value);};
  await h.button('Son teslimi doğrula').click();assert.equal(h.report().snapshot.status,'blocked');
  assert.equal(JSON.parse(h.localStorage.getItem('autosbc.local.daily.v1')).status,'stopped');
  h.localStorage.setItem=save;let reads=0;h.ctx.services.SBC.requestSets=()=>{reads++;throw new Error('must not read');};
  await h.button('Son teslimi doğrula').click();assert.equal(reads,0);assert.deepEqual(h.writes,[]);
});
test('stop during the post-submit pacing window prevents immediate reward GET',async()=>{
  const h=batchHarness();await h.prepare();let reads=0;const requestSets=h.ctx.services.SBC.requestSets,oldTimer=h.ctx.setTimeout;let stopped=false;
  h.ctx.services.SBC.requestSets=()=>{reads++;return requestSets();};
  h.ctx.setTimeout=(callback,delay,...args)=>{if(delay===500&&!stopped){stopped=true;h.button('Sırayı durdur').click();}return oldTimer(callback,delay,...args);};
  await h.button('Sırayı otomatik tamamla').click();
  assert.equal(reads,2);assert.equal(h.writes.filter(write=>write==='submitChallenge').length,1);assert.equal(h.report().snapshot.status,'stopped');
  assert.ok(h.elements.some(e=>e.tag==='p'&&e.textContent.includes('1 teslim onayı · 0 sayaç doğrulaması')));
});
test('completed repeatable sets leave the manual queue when a later set fails',async()=>{
  const h=batchHarness(),other={id:30,name:'Other SBC',isComplete:()=>false,isRepeatable:false,isLimitedRepeatable:false,timesCompleted:0};
  h.set.isRepeatable=true;h.set.isLimitedRepeatable=true;h.set.getRepeatsRemaining=()=>9;
  h.ctx.services.SBC.requestSets=()=>observable({sets:[h.set,other]});
  h.ctx.services.SBC.requestChallengesForSet=set=>set.id===20?observable({challenges:[h.challenge]}):{observe(owner,callback){queueMicrotask(()=>callback(this,{success:false,status:521}));},unobserve(){}};
  await h.prepare();h.selects[2].value='30';await h.button('Seçili seti sıraya ekle').click();
  const consent=h.elements.find(e=>e.tag==='label'&&e.textContent.startsWith('Bu sıradaki kadroları')).children[0];consent.checked=true;await Promise.all(consent.listeners.change.map(fn=>fn()));
  await h.button('Sırayı otomatik tamamla').click();
  assert.equal(h.report().snapshot.progress.completed,1);assert.equal(h.writes.filter(write=>write==='submitChallenge').length,1);
  assert.ok(h.elements.some(e=>e.tag==='ol'&&e.textContent==='Other SBC'));
});
test('manual batch cannot restart a reloaded claim-pending journal or malformed history',async t=>{
  const pending=uncertainClaimReport();pending.snapshot.status='running';pending.snapshot.queue[0].status='running';pending.snapshot.queue[0].steps[0].status='claim-pending';pending.snapshot.ledger.pop();
  for(const history of [JSON.stringify(pending),'{broken'])await t.test(history.slice(0,20),async()=>{
    const h=batchHarness({storage:{'autosbc.local.batch.v1':history}});await h.prepare();await h.button('Sırayı otomatik tamamla').click();
    assert.deepEqual(h.writes,[]);assert.equal(h.requests.length,0);assert.equal(h.localStorage.getItem('autosbc.local.batch.v1'),history);
  });
});
test('reconciliation removes only a proven completed set from the manual queue',async t=>{
  for(const setCompleted of [false,true])await t.test(String(setCompleted),async()=>{
    const h=reconciliationHarness({report:uncertainClaimReport({setCompleted})});await h.refresh();await h.button('Seçili seti sıraya ekle').click();
    await h.button('Son teslimi doğrula').click();
    assert.ok(h.elements.some(e=>e.tag==='ol'&&e.textContent===(setCompleted?'Henüz set eklenmedi.':'Test SBC')));
    assert.deepEqual(h.writes,[]);
  });
});
