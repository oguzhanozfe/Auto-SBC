const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../frontend/daily-plan.js');
const names={bronze:'Daily Bronze Upgrade',silver:'Daily Silver Upgrade',common:'Daily Common Gold Upgrade',rare:'Daily Rare Gold Upgrade'};
function nativeSnapshot(kind='bronze',changes={}) {
  return {id:{bronze:10,silver:20,common:30,rare:40}[kind],name:names[kind],
    isRepeatable:true,isLimitedRepeatable:true,repeats:15,timesCompleted:13,remaining:2,
    completed:false,expired:false,...changes};
}
test('only exact observed daily upgrade names are selected',()=>{
  assert.equal(D.dailyKind('  DAILY  Silver\nUpgrade '),'silver');
  for (const name of [null,'','Daily Upgrade','Daily Gold Upgrade','Premium Daily Bronze Upgrade',
    'Daily Bronze Upgrade II','Daily Login Upgrade','Daily Bronze Upgrade - Bonus','Rare Gold Upgrade','toString']) assert.equal(D.dailyKind(name),null);
  const plan=D.createPlan([nativeSnapshot(),{...nativeSnapshot(),id:90,name:'85+ x10 Upgrade'}]);
  assert.deepEqual(plan.sets.map(item=>item.setId),['10']);
});
test('all known remaining repetitions are frozen in bronze, silver, common, rare order',()=>{
  const snapshots=['rare','silver','common','bronze'].map(kind=>nativeSnapshot(kind));
  const plan=D.createPlan(snapshots);
  assert.deepEqual(plan.entries.map(entry=>entry.kind),['bronze','bronze','silver','silver','common','common','rare','rare']);
  assert.deepEqual(plan.entries.slice(0,2).map(({cycle,plannedRemaining,beforeTimesCompleted})=>({cycle,plannedRemaining,beforeTimesCompleted})),
    [{cycle:1,plannedRemaining:2,beforeTimesCompleted:13},{cycle:2,plannedRemaining:1,beforeTimesCompleted:14}]);
  assert.equal(plan.totalCycles,8);
  assert.deepEqual(plan.sets.map(entry=>entry.repetitions),[2,2,2,2]);
});
test('completed, exhausted, expired, and unlimited daily sets add no work',()=>{
  const plan=D.createPlan([
    nativeSnapshot('bronze',{completed:true}),
    nativeSnapshot('silver',{timesCompleted:15,remaining:0}),
    nativeSnapshot('common',{expired:true}),
    nativeSnapshot('rare',{isLimitedRepeatable:false,repeats:999,remaining:999})
  ]);
  assert.equal(plan.totalCycles,0); assert.deepEqual(plan.entries,[]);
  assert.deepEqual(plan.skipped.map(item=>item.reason),['completed','rights-exhausted','expired','finite-repeat-rights-unavailable']);
});
test('historical timesCompleted does not exclude available daily repeat rights',()=>{
  const plan=D.createPlan([nativeSnapshot('silver',{timesCompleted:14,remaining:1})]);
  assert.equal(plan.totalCycles,1);
  assert.equal(plan.entries[0].beforeTimesCompleted,14);
});
test('unknown or contradictory native fields never become assumed repeat rights',()=>{
  for (const changes of [{completed:undefined},{expired:undefined},{isRepeatable:undefined},{isRepeatable:false},
    {isLimitedRepeatable:undefined},{remaining:undefined},{remaining:null},{remaining:-1},{remaining:2.5},{remaining:'2'},
    {remaining:Infinity},{remaining:true},{timesCompleted:undefined},{timesCompleted:1},{repeats:undefined},{repeats:0},
    {id:0},{id:'invalid'}]) {
    const plan=D.createPlan([nativeSnapshot('bronze',changes)]);
    assert.equal(plan.totalCycles,0,JSON.stringify(changes));
    assert.equal(plan.skipped.length,1);
  }
});
test('duplicate native IDs or multiple active versions of a daily name are ambiguous',()=>{
  assert.throws(()=>D.createPlan([nativeSnapshot(),nativeSnapshot()]),/Ambiguous/);
  assert.throws(()=>D.createPlan([nativeSnapshot(),nativeSnapshot('bronze',{id:11})]),/Ambiguous/);
  const expired=nativeSnapshot('bronze',{id:11,expired:true});
  assert.equal(D.createPlan([nativeSnapshot(),expired]).totalCycles,2);
});
test('per-set and whole-plan limits reject explicitly instead of truncating work',()=>{
  assert.throws(()=>D.createPlan([nativeSnapshot('bronze',{repeats:31,timesCompleted:0,remaining:31})]),/31 remaining exceeds/);
  const sets=['bronze','silver','common','rare'].map(kind=>nativeSnapshot(kind,{repeats:21,timesCompleted:0,remaining:21}));
  assert.throws(()=>D.createPlan(sets),/84 daily repetitions exceed/);
  assert.equal(D.createPlan(sets,{maxTotal:84}).totalCycles,84);
  assert.equal(D.createPlan([nativeSnapshot('bronze',{repeats:30,timesCompleted:0,remaining:30})]).totalCycles,30);
  for (const maxTotal of [0,-1,2.5,'10',1001,Infinity]) assert.throws(()=>D.createPlan([],{maxTotal}),/integer/);
});
test('creating a daily plan preserves native snapshots and freezes the captured work list',()=>{
  const snapshots=[nativeSnapshot('rare'),nativeSnapshot('bronze')], prior=JSON.stringify(snapshots);
  const plan=D.createPlan(snapshots);
  assert.equal(JSON.stringify(snapshots),prior);
  snapshots[1].remaining=0;
  assert.equal(plan.entries[0].plannedRemaining,2);
  assert.equal(Object.isFrozen(plan),true); assert.equal(Object.isFrozen(plan.entries),true); assert.equal(Object.isFrozen(plan.entries[0]),true);
});
test('each planned repetition requires its expected fresh native counters',()=>{
  const initial=nativeSnapshot(),plan=D.createPlan([initial]);
  assert.equal(D.assertCycle(plan.entries[0],initial),true);
  const afterOne=nativeSnapshot('bronze',{timesCompleted:14,remaining:1});
  assert.equal(D.assertCycle(plan.entries[1],afterOne),true);
  assert.throws(()=>D.assertCycle(plan.entries[0],afterOne),/counters changed/);
  assert.throws(()=>D.assertCycle(plan.entries[1],initial),/counters changed/);
  assert.throws(()=>D.assertCycle(plan.entries[1],nativeSnapshot('bronze',{timesCompleted:15,remaining:0})),/rights-exhausted/);
});
test('reset, external completion, expiration, or changed set identity stops a frozen plan',()=>{
  const entry=D.createPlan([nativeSnapshot()]).entries[0];
  for (const fresh of [nativeSnapshot('bronze',{timesCompleted:0,remaining:15}),
    nativeSnapshot('bronze',{timesCompleted:14,remaining:1}),nativeSnapshot('bronze',{expired:true}),
    nativeSnapshot('bronze',{completed:true}),nativeSnapshot('bronze',{id:11}),
    nativeSnapshot('bronze',{name:names.silver}),nativeSnapshot('bronze',{isLimitedRepeatable:false})]) assert.throws(()=>D.assertCycle(entry,fresh),/changed|unavailable|another/);
});
test('malformed planned cycles cannot be used as runtime authorization',()=>{
  const entry=D.createPlan([nativeSnapshot()]).entries[0];
  for (const changes of [{cycle:0},{cycle:'1'},{plannedRemaining:0},{beforeTimesCompleted:-1},{kind:'unknown'},{setId:0}]) {
    assert.throws(()=>D.assertCycle({...entry,...changes},nativeSnapshot()),/Invalid/);
  }
});
test('empty availability returns an empty finite plan without inferring missing daily sets',()=>{
  assert.deepEqual(D.createPlan([]),{entries:[],sets:[],skipped:[],totalCycles:0});
  assert.throws(()=>D.createPlan(null),/array/);
});
