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
  const writes = [], requests = [], conceptRequests = [];
  const activeSquadPlayers=[];
  let jobResult;
  const players = Array.from({length:12},(_,i) => ({id:i+1,definitionId:1000+i,assetId:2000+i,_metaData:{id:2000+i},_staticData:{name:`Player ${i+1}`},
    rating:80,teamId:18,leagueId:13,nationId:18,rareflag:0,untradeable:true,loans:-1,preferredPosition:14,possiblePositions:[14],groups:[0],
    isPlayer:()=>true,isSpecial:()=>false,isTimeLimited:()=>false,getTier:()=>3}));
  const squad = {_formation:{generalPositions:Array(11).fill(14)},simpleBrickIndices:[],_players:Array.from({length:11},()=>({_item:{}})),
    setPlayers(items) { writes.push('setPlayers'); this._players=items.map(item=>({_item:item})); }};
  const challenge = {id:10,setId:20,name:'Test challenge',status:'IN_PROGRESS',squad,
    eligibilityRequirements:[{scope:0,count:11,kvPairs:{_collection:{1:[11]}}}]};
  const set = {id:20,name:'Test SBC',isComplete:()=>false};
  let activeChallenge=challenge,nativeOptions;
  const ctx = {console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,URL,Blob,AbortController,crypto:require('node:crypto').webcrypto,
    localStorage,sessionStorage,location:{origin:'https://www.ea.com'},atob:value=>Buffer.from(value,'base64').toString(),
    document:{documentElement:body,createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text)},
    repositories:{TeamConfig:{}},
    services:{SBC:{requestSets:()=>observable({sets:[set]}),requestChallengesForSet:()=>observable({challenges:[challenge]}),loadChallenge:()=>observable(challenge),saveChallenge:()=>{writes.push('saveChallenge');return observable({});}},
      Club:{search:()=>observable({items:players,retrievedAll:true})},Item:{searchStorageItems:()=>observable({items:[],endOfList:true}),requestUnassignedItems:()=>observable({items:[]})},
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
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/companion.js'),'utf8'),context);
  const elements = [];
  const visit = element => { elements.push(element);element.children.forEach(visit);if(element.shadowRoot)visit(element.shadowRoot);}; visit(body);
  const button = text => elements.find(element=>element.tag==='button'&&element.textContent===text);
  const selects = elements.filter(element=>element.tag==='select');
  const refresh = async () => { selects[0].value=overrides.gameYear||26;selects[1].value=overrides.platform||'ps5';await button('SBC listesini yükle').click(); selects[2].value='20'; await Promise.all(selects[2].listeners.change.map(callback=>callback())); selects[3].value='10'; };
  return {ctx,elements,button,refresh,writes,requests,conceptRequests,players,activeSquadPlayers,localStorage,selects,nativeOptions,
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
  assert.deepEqual(h.writes,['setPlayers','saveChallenge']);
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
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);
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
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);
  assert.ok(h.elements.some(element=>element.textContent.includes('0 kulüp kartı + 11 alınacak kart')));
  assert.deepEqual(h.writes,[]);
});
test('FC27 without market prices keeps owned-only solves and reports missing quotes', async () => {
  const h=harness({gameYear:27,noPrices:true});await h.refresh();await h.button('Çöz ve önizle').click();
  assert.equal(h.requests[0].gameYear,27);
  assert.ok(h.elements.some(element=>element.textContent.includes('FC 27 / PS5 için güncel piyasa fiyatı henüz hazır değil')));
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
