const {test}=require('node:test');
const assert=require('node:assert/strict');
const B=require('../frontend/batch-policy.js');
const players=()=>Array.from({length:11},(_,i)=>({id:i+1,concept:false,gamesPlayed:0,isEvolution:false}));
const available={completed:false,repeatable:false,remaining:1};
function ready(ids=[20]) {
  const batch=B.createBatch(ids,{allowConcept:true,protectPlayed:false,protectEvolutions:false});
  batch.startSet(ids[0],available); batch.beginStep(10); batch.readyStep(players());
  return batch;
}
function throughClaim(batch) {
  for (const action of ['save','submit','claim']) batch.confirmEffect(batch.beginEffect(action,action==='claim'?undefined:players()));
}
test('finite explicit queue preserves order, collapses duplicate selections, and never adds a set',()=>{
  const batch=B.createBatch([20,'20',30]);
  assert.equal(batch.nextSet(),'20');
  assert.deepEqual(batch.snapshot().queue.map(item=>item.setId),['20','30']);
  assert.throws(()=>batch.startSet(999,available),/next selected/);
  assert.throws(()=>batch.startSet(30,available),/next selected/);
  assert.throws(()=>B.createBatch([]),/Select/);
  assert.throws(()=>B.createBatch(Array.from({length:B.MAX_SETS+1},(_,i)=>i+1)),/Select/);
  for (const invalid of [0,-1,'abc',1.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>B.createBatch([invalid]),/Invalid/);
});
test('batch forces played and evolution protections and rejects all purchase actions',()=>{
  const input={allowConcept:true,protectPlayed:false,protectEvolutions:false,maxPurchasePrice:10000};
  const batch=B.createBatch([20],input);
  assert.deepEqual(batch.snapshot().policy,{allowConcept:false,protectPlayed:true,protectEvolutions:true,maxPurchasePrice:0});
  assert.equal(input.allowConcept,true);
  const active=ready();
  assert.throws(()=>active.beginEffect('purchase',players()),/out-of-order/);
});
test('already completed and exhausted sets are skipped without challenge effects',()=>{
  const batch=B.createBatch([20,30]);
  assert.equal(batch.startSet(20,{completed:true,repeatable:false,remaining:null}),false);
  assert.equal(batch.nextSet(),'30');
  assert.equal(batch.startSet(30,{completed:false,repeatable:true,remaining:0}),false);
  const state=batch.snapshot();
  assert.equal(state.status,'completed'); assert.equal(batch.nextSet(),null);
  assert.equal(state.progress.skipped,2); assert.equal(state.progress.confirmedChallenges,0);
  assert.equal(state.ledger.some(event=>event.event==='effect-started'),false);
});
test('past completion does not exclude a repeatable SBC with confirmed rights remaining',()=>{
  const batch=B.createBatch([20]);
  assert.equal(batch.startSet(20,{completed:true,repeatable:true,remaining:2}),true);
  assert.equal(batch.snapshot().queue[0].status,'running');
});
test('ambiguous completion and invalid rights cannot start a batch set',()=>{
  for (const availability of [{completed:true,repeatable:true,remaining:null},
    {completed:false,remaining:1},{completed:false,repeatable:false,remaining:-1},
    {completed:false,repeatable:false,remaining:1.5},{completed:false,repeatable:false,remaining:'1'}]) {
    const batch=B.createBatch([20]);
    assert.throws(()=>batch.startSet(20,availability),/unreadable|unknown/);
    assert.equal(batch.snapshot().queue[0].status,'queued');
    assert.equal(batch.snapshot().ledger.length,0);
  }
});
test('saved squad is not a completion; only confirmed submit and claim finish a challenge',()=>{
  const batch=ready();
  batch.confirmEffect(batch.beginEffect('save',players()));
  assert.throws(()=>batch.completeSet(),/unconfirmed/);
  assert.throws(()=>batch.beginEffect('claim'),/out-of-order/);
  const submit=batch.beginEffect('submit',players());
  assert.equal(batch.snapshot().progress.confirmedChallenges,0);
  batch.confirmEffect(submit);
  assert.equal(batch.snapshot().progress.confirmedChallenges,0);
  batch.confirmEffect(batch.beginEffect('claim'));
  assert.equal(batch.snapshot().progress.confirmedChallenges,1);
  batch.completeSet();
  assert.equal(batch.snapshot().status,'completed');
  assert.equal(batch.snapshot().progress.completed,1);
});
test('lost submit response blocks retries before and after reporting uncertainty',()=>{
  const batch=ready(); let sends=0;
  batch.confirmEffect(batch.beginEffect('save',players()));
  const submit=()=>{const token=batch.beginEffect('submit',players()); sends++; return token;};
  const pending=submit();
  assert.throws(submit,/out-of-order/);
  batch.failEffect(pending,'Connection closed after request');
  assert.throws(submit,/blocked/);
  assert.throws(()=>batch.beginEffect('claim'),/blocked/);
  assert.equal(sends,1); assert.equal(batch.nextSet(),null);
  assert.equal(batch.snapshot().queue[0].steps[0].status,'uncertain');
  assert.equal(batch.snapshot().progress.confirmedChallenges,0);
});
test('lost claim response blocks the batch without resubmitting or counting a completed challenge',()=>{
  const batch=ready([20,30]);
  batch.confirmEffect(batch.beginEffect('save',players()));
  batch.confirmEffect(batch.beginEffect('submit',players()));
  const claim=batch.beginEffect('claim'); batch.failEffect(claim,'Reward state unavailable');
  assert.throws(()=>batch.beginEffect('claim'),/blocked/);
  assert.throws(()=>batch.beginEffect('submit',players()),/blocked/);
  assert.throws(()=>batch.startSet(30,available),/blocked/);
  assert.equal(batch.snapshot().progress.confirmedChallenges,0);
});
test('Stop between save and submit prevents the new submit side effect',()=>{
  const batch=ready(); let sends=0;
  batch.confirmEffect(batch.beginEffect('save',players())); batch.stop();
  assert.throws(()=>{batch.beginEffect('submit',players()); sends++;},/stopped/);
  assert.equal(sends,0); assert.equal(batch.nextSet(),null);
});
test('Stop during an in-flight request permits recording its receipt but forbids follow-up effects',()=>{
  const batch=ready(); batch.confirmEffect(batch.beginEffect('save',players()));
  const submit=batch.beginEffect('submit',players()); batch.stop(); batch.confirmEffect(submit);
  assert.equal(batch.snapshot().status,'stopped');
  assert.equal(batch.snapshot().queue[0].steps[0].status,'submitted');
  assert.throws(()=>batch.beginEffect('claim'),/stopped/);
  assert.throws(()=>batch.beginStep(11),/stopped/);
});
test('uncertain result after Stop remains recorded without making the batch runnable',()=>{
  const batch=ready(); const save=batch.beginEffect('save',players()); batch.stop(); batch.failEffect(save,'Timed out');
  assert.equal(batch.snapshot().status,'stopped');
  assert.equal(batch.snapshot().queue[0].steps[0].status,'uncertain');
  assert.throws(()=>batch.beginEffect('save',players()),/stopped/);
});
test('stale, forged, duplicate, and foreign effect confirmations cannot advance state',()=>{
  const a=ready(), b=ready(); const token=a.beginEffect('save',players());
  const foreign=b.beginEffect('save',players());
  for (const wrong of [{...token},foreign,null]) assert.throws(()=>a.confirmEffect(wrong),/Stale/);
  assert.equal(a.snapshot().queue[0].steps[0].status,'save-pending');
  a.confirmEffect(token);
  assert.throws(()=>a.confirmEffect(token),/Stale/);
  assert.throws(()=>a.failEffect(token,'Late error'),/Stale/);
  assert.equal(a.snapshot().queue[0].steps[0].status,'saved');
});
test('each selected set may contain multiple distinct challenges, each exchanged at most once',()=>{
  const batch=ready([20,30]); throughClaim(batch);
  assert.throws(()=>batch.beginStep(10),/already processed/);
  batch.beginStep(11); batch.readyStep(players()); throughClaim(batch); batch.completeSet();
  assert.equal(batch.nextSet(),'30');
  batch.startSet(30,available); batch.beginStep(12); batch.readyStep(players()); throughClaim(batch); batch.completeSet();
  const state=batch.snapshot();
  assert.deepEqual(state.progress,{total:2,completed:2,skipped:0,confirmedChallenges:3});
  assert.equal(state.ledger.filter(event=>event.event==='effect-started'&&event.action==='submit').length,3);
  assert.equal(state.status,'completed');
});
test('played, unknown, evolved, and concept cards cannot enter a reviewed batch squad',()=>{
  for (const changed of [{gamesPlayed:1},{gamesPlayed:null},{gamesPlayed:'0'},{gamesPlayed:undefined},
    {isEvolution:true},{isEvolution:undefined},{concept:true},{concept:undefined},{id:'concept:123'},{id:0}]) {
    const batch=B.createBatch([20]); batch.startSet(20,available); batch.beginStep(10);
    const squad=players(); Object.assign(squad[0],changed);
    assert.throws(()=>batch.readyStep(squad),/protects|cannot use/);
    assert.equal(batch.snapshot().queue[0].steps[0].status,'planning');
    assert.equal(batch.snapshot().ledger.some(event=>event.event==='effect-started'),false);
  }
});
test('fresh player checks stop changes after review and immediately before submit',()=>{
  const batch=ready(), changed=players(); changed[0].gamesPlayed=1;
  assert.throws(()=>batch.beginEffect('save',changed),/protects/);
  batch.confirmEffect(batch.beginEffect('save',players()));
  assert.throws(()=>batch.beginEffect('submit',changed),/protects/);
  const replaced=players(); replaced[0].id=99;
  assert.throws(()=>batch.beginEffect('submit',replaced),/changed/);
  assert.throws(()=>batch.beginEffect('submit'),/needs/);
  assert.equal(batch.snapshot().queue[0].steps[0].status,'saved');
});
test('duplicate items fail and partial squads for brick challenges remain supported',()=>{
  assert.deepEqual(B.assertBatchPlayers(players().slice(0,1)),['1']);
  const squad=players(); squad[1].id=squad[0].id;
  assert.throws(()=>B.assertBatchPlayers(squad),/Duplicate/);
  assert.throws(()=>B.assertBatchPlayers([]),/needs/);
  assert.throws(()=>B.assertBatchPlayers([...players(),players()[0]]),/needs/);
});
test('detached snapshots cannot reset effect state or disable protections',()=>{
  const batch=ready(); const token=batch.beginEffect('save',players());
  const state=batch.snapshot(); state.status='running'; state.policy.protectPlayed=false;
  state.queue[0].steps[0].status='ready'; state.ledger.length=0;
  assert.throws(()=>batch.beginEffect('save',players()),/out-of-order/);
  assert.equal(batch.snapshot().policy.protectPlayed,true);
  assert.ok(batch.snapshot().ledger.length>0);
  batch.confirmEffect(token);
});
test('planning failure halts later selected SBCs and never creates an effect attempt',()=>{
  const batch=B.createBatch([20,30]); batch.startSet(20,available); batch.beginStep(10); batch.failStep('No protected squad available');
  assert.equal(batch.snapshot().status,'blocked'); assert.equal(batch.nextSet(),null);
  assert.equal(batch.snapshot().ledger.some(event=>event.event==='effect-started'),false);
  assert.throws(()=>batch.beginStep(11),/blocked/);
});
test('post-claim bookkeeping failure preserves confirmed completion while blocking further work',()=>{
  const batch=ready([20,30]); throughClaim(batch);
  assert.equal(batch.snapshot().progress.confirmedChallenges,1);
  batch.failStep('Set completion receipt unavailable');
  const state=batch.snapshot();
  assert.equal(state.status,'blocked');
  assert.equal(state.queue[0].status,'blocked');
  assert.equal(state.queue[0].reason,'Set completion receipt unavailable');
  assert.equal(state.queue[0].steps[0].status,'completed');
  assert.equal(state.progress.confirmedChallenges,1);
  assert.equal(state.progress.completed,0);
  assert.equal(state.ledger.filter(event=>event.event==='effect-confirmed'&&event.action==='claim').length,1);
  assert.equal(batch.nextSet(),null);
  assert.throws(()=>batch.beginEffect('submit',players()),/blocked/);
});
