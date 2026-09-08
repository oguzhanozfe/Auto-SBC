const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

class Element {
  constructor(tag, text = '') { this.tag = tag; this.children = []; this._text = text; this.listeners = {}; this.style = {}; this._value = ''; this.disabled = false;
    const classes = new Set(); this.classList = { toggle: value => classes.has(value) ? classes.delete(value) : classes.add(value), contains: value => classes.has(value) }; }
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
function harness(overrides = {}) {
  const body = new Element('html');
  const localStorage = new Storage(), sessionStorage = new Storage();
  const writes = [], requests = [], conceptRequests = [];
  let jobResult;
  const players = Array.from({length:12},(_,i) => ({id:i+1,definitionId:1000+i,assetId:2000+i,_metaData:{id:2000+i},_staticData:{name:`Player ${i+1}`},
    rating:80,teamId:18,leagueId:13,nationId:18,rareflag:0,untradeable:true,loans:-1,preferredPosition:14,possiblePositions:[14],groups:[0],
    isPlayer:()=>true,isSpecial:()=>false,isTimeLimited:()=>false,getTier:()=>3}));
  const squad = {_formation:{generalPositions:Array(11).fill(14)},simpleBrickIndices:[],_players:Array.from({length:11},()=>({_item:{}})),
    setPlayers(items) { writes.push('setPlayers'); this._players=items.map(item=>({_item:item})); }};
  const challenge = {id:10,setId:20,name:'Test challenge',status:'IN_PROGRESS',squad,
    eligibilityRequirements:[{scope:0,count:11,kvPairs:{_collection:{1:[11]}}}]};
  const set = {id:20,name:'Test SBC',isComplete:()=>false};
  const ctx = {console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,URL,Blob,AbortController,crypto:require('node:crypto').webcrypto,
    localStorage,sessionStorage,location:{origin:'https://www.ea.com'},atob:value=>Buffer.from(value,'base64').toString(),
    document:{documentElement:body,createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text)},
    repositories:{TeamConfig:{}},
    services:{SBC:{requestSets:()=>observable({sets:[set]}),requestChallengesForSet:()=>observable({challenges:[challenge]}),loadChallenge:()=>observable(challenge),saveChallenge:()=>{writes.push('saveChallenge');return observable({});}},
      Club:{search:()=>observable({items:players,retrievedAll:true})},Item:{searchStorageItems:()=>observable({items:[],endOfList:true}),requestUnassignedItems:()=>observable({items:[]})},
      Localization:{localize:()=> 'Gold Common'},Chemistry:{}},
    UTBucketedItemSearchViewModel:class {constructor(){this.searchCriteria={};}},
    UTSBCSquadOverviewViewController:class {initWithSBCSet(){this._squad=squad;this._challenge=challenge;}},
    UTSBCSquadSplitViewController:class {initWithSBCSet(){}},UTItemEntity:class {},
    UTSquadChemCalculatorUtils:class {getChemProfileForPlayer(){return {maxChem:false,rules:[{calculationType:1,contribution:1,parameterId:1},{calculationType:1,contribution:1,parameterId:2},{calculationType:1,contribution:1,parameterId:3}]};}normalizeClubId(id){return id;}},
    SBCEligibilityKey:{1:'NUMBER_OF_PLAYERS'},SBCEligibilityScope:{0:'EXACT'},
    fetch: async (url, options) => {
      let result={status:'ok',database:{count:20000}};
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
  ctx.window = ctx;
  const context = vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/policy.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/companion.js'),'utf8'),context);
  const elements = [];
  const visit = element => { elements.push(element);element.children.forEach(visit);if(element.shadowRoot)visit(element.shadowRoot);}; visit(body);
  const button = text => elements.find(element=>element.tag==='button'&&element.textContent===text);
  const selects = elements.filter(element=>element.tag==='select');
  const refresh = async () => { await button('SBC listesini yükle').click(); selects[0].value='20'; await Promise.all(selects[0].listeners.change.map(callback=>callback())); selects[1].value='10'; };
  return {ctx,elements,button,refresh,writes,requests,conceptRequests,players,localStorage};
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
test('concept pool uses filtered endpoint and preserves explicit bounded coverage', async () => {
  const concept={id:'concept:9999',definitionId:9999,assetId:8888,name:'Market base card',rating:82,teamId:18,leagueId:13,nationId:18,rarityId:0,possiblePositions:[14],preferredPosition:14,marketPrice:1500,concept:true};
  const h=harness({concepts:{players:[concept],coverage:{returned:1,totalEligible:15000,complete:false}},
    solve:input=>({status_code:4,solution:[...input.clubPlayers.filter(p=>!p.concept).slice(0,10),...input.clubPlayers.filter(p=>p.concept).slice(0,1)].map((player,i)=>({...player,squadPosition:i}))})});
  await h.refresh();
  const label=h.elements.find(element=>element.tag==='label'&&element.textContent.includes('Konsept kart önerilerini'));
  label.children.find(element=>element.tag==='input').checked=true;
  await h.button('Çöz ve önizle').click();
  assert.equal(h.conceptRequests.length,1);
  assert.equal(h.conceptRequests[0].limit,1500);
  assert.equal(h.conceptRequests[0].solverPolicy.protectSpecial,true);
  assert.equal(h.requests[0].clubPlayers.filter(p=>p.concept).length,1);
  assert.equal(h.requests[0].sbcData.conceptCoverage.totalEligible,15000);
  assert.equal(h.button('İnceledim · Kadroyu SBC’ye uygula').disabled,true);
  assert.ok(h.elements.some(element=>element.textContent.includes('sınırlı bir aday havuzu')));
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
