const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../frontend/batch-reconcile.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const at='2026-09-09T23:35:01.148Z', observedAt='2026-09-10T10:00:00.000Z';
function effects(challengeId='4116',offset=0,last='effect-uncertain') {
  return ['save','submit','claim'].flatMap((action,index)=>[
    {event:'effect-started',setId:'1420',challengeId,action,sequence:offset+index+1},
    {event:action==='claim'?last:'effect-confirmed',setId:'1420',challengeId,action,sequence:offset+index+1}
  ]);
}
function report() {
  return {runId:'synthetic-reconciliation-test',scope:{gameYear:26,platform:'ps5'},updatedAt:at,
    phase:'Reward counter read returned 521',lastError:{status:521},
    selectedSets:[{id:'1420',name:'Synthetic selected set'},{id:'1427',name:'Unstarted set'}],
    receipts:[{setId:'1420',challengeId:'4116',completed:true,setCompleted:false,rewardsGranted:true,
      beforeChallenge:0,beforeSet:0,at,cardIds:['101','102'],zeroGames:true,coinSpent:0}],
    snapshot:{status:'blocked',policy:{allowConcept:false,protectPlayed:true,protectEvolutions:true},currentSetId:'1420',
      queue:[{setId:'1420',status:'blocked',steps:[{challengeId:'4116',status:'uncertain',itemIds:['101','102'],reason:'Read returned 521'}]},
        {setId:'1427',status:'queued',steps:[]}],
      ledger:[{event:'set-started',setId:'1420'},{event:'challenge-started',setId:'1420',challengeId:'4116'},
        {event:'squad-ready',setId:'1420',challengeId:'4116'},...effects()],
      progress:{total:2,completed:0,skipped:0,confirmedChallenges:0}}};
}
const fresh=(changes={})=>({setId:'1420',challengeId:'4116',challengeTimesCompleted:1,setTimesCompleted:0,observedAt,...changes});
test('read-only counters recover one granted part while stopping the remaining queue',()=>{
  const original=report(), before=clone(original), result=R.reconcile(original,fresh());
  assert.deepEqual(original,before);
  assert.equal(result.snapshot.status,'stopped');
  assert.equal(result.snapshot.queue[0].status,'blocked');
  assert.equal(result.snapshot.queue[0].steps[0].status,'completed');
  assert.equal(result.snapshot.queue[1].status,'queued');
  assert.deepEqual(result.snapshot.progress,{total:2,completed:0,skipped:0,confirmedChallenges:1});
  assert.equal(result.reconciliation.method,'read-only-counters');
  assert.equal(result.reconciliation.groupCycleCompleted,false);
  assert.equal(result.updatedAt,observedAt);
  assert.deepEqual(result.receipts,original.receipts);
  assert.deepEqual(result.snapshot.ledger.slice(0,-1),original.snapshot.ledger);
  assert.equal(result.snapshot.ledger.at(-1).event,'read-reconciled');
  assert.equal(result.snapshot.ledger.filter(entry=>entry.event==='effect-started').length,3);
  assert.throws(()=>R.plan(result),/exactly one/);
});
test('plan returns exact read targets and a detached submission receipt',()=>{
  const original=report(), planned=R.plan(original);
  assert.deepEqual(Object.keys(planned),['setId','challengeId','receipt','claimSequence']);
  assert.equal(planned.setId,'1420'); assert.equal(planned.challengeId,'4116'); assert.equal(planned.claimSequence,3);
  planned.receipt.cardIds[0]='999'; assert.equal(original.receipts[0].cardIds[0],'101');
});
test('a group-completed receipt additionally requires the native set counter to advance',()=>{
  const original=report(); original.receipts[0].setCompleted=true;
  assert.throws(()=>R.reconcile(original,fresh()),/counters do not confirm/);
  const result=R.reconcile(original,fresh({setTimesCompleted:1,challengeCompleted:false,setCompleted:false}));
  assert.equal(result.snapshot.status,'stopped');
  assert.equal(result.snapshot.queue[0].status,'completed');
  assert.equal(result.snapshot.progress.completed,1);
  assert.equal(result.snapshot.progress.confirmedChallenges,1);
  assert.equal(result.reconciliation.groupCycleCompleted,true);
});
test('repeatable status reset is accepted only alongside an advanced completion counter',()=>{
  assert.equal(R.reconcile(report(),fresh({challengeCompleted:false,setCompleted:false})).snapshot.progress.confirmedChallenges,1);
  assert.throws(()=>R.reconcile(report(),fresh({challengeTimesCompleted:0,challengeCompleted:true})),/counters do not confirm/);
});
test('stale counters, regressed set history, invalid counters, and mismatched targets fail closed',()=>{
  const original=report(); original.receipts[0].beforeSet=4;
  for (const snapshot of [fresh({setTimesCompleted:3}),fresh({setTimesCompleted:4,challengeTimesCompleted:0}),
    fresh({setTimesCompleted:4,challengeTimesCompleted:'1'}),fresh({setTimesCompleted:4,challengeTimesCompleted:Infinity}),
    fresh({setTimesCompleted:4,challengeTimesCompleted:true}),fresh({setTimesCompleted:null}),
    fresh({setId:'1427',setTimesCompleted:4}),fresh({challengeId:'4117',setTimesCompleted:4}),
    fresh({setTimesCompleted:4,observedAt:at.replace('23:35','23:34')}),fresh({setTimesCompleted:4,observedAt:'unknown'}),
    fresh({setTimesCompleted:4,challengeCompleted:'true'})]) assert.throws(()=>R.reconcile(original,snapshot),/reconciliation/);
  assert.equal(original.snapshot.queue[0].steps[0].status,'uncertain');
});
test('missing, failed, ambiguous, or unverifiable submit receipts cannot be recovered',()=>{
  for (const change of [receipt=>{receipt.completed=false;},receipt=>{receipt.rewardsGranted=false;},
    receipt=>{receipt.setCompleted=undefined;},receipt=>{receipt.beforeChallenge=-1;},
    receipt=>{receipt.beforeSet='0';},receipt=>{receipt.beforeChallenge=null;},receipt=>{receipt.at='invalid';},
    receipt=>{receipt.cardIds=['999','102'];}]) {
    const original=report(); change(original.receipts[0]); assert.throws(()=>R.plan(original),/reconciliation/);
  }
  const missing=report(); missing.receipts=[]; assert.throws(()=>R.plan(missing),/one exact/);
  const duplicate=report(); duplicate.receipts.push(clone(duplicate.receipts[0])); assert.throws(()=>R.plan(duplicate),/one exact/);
  const foreign=report(); foreign.receipts[0].setId='1427'; assert.throws(()=>R.plan(foreign),/unknown submission/);
});
test('a save or submit with an uncertain outcome is never reconciled as a successful exchange',()=>{
  for (const action of ['save','submit']) {
    const original=report(), terminal=original.snapshot.ledger.find(entry=>entry.event==='effect-confirmed'&&entry.action===action);
    terminal.event='effect-uncertain';
    assert.throws(()=>R.plan(original),/save, submit, or another claim is uncertain/);
  }
});
test('missing submit confirmation or incomplete claim failure history cannot enable recovery',()=>{
  for (const remove of [entry=>entry.event==='effect-confirmed'&&entry.action==='submit',
    entry=>entry.event==='effect-started'&&entry.action==='claim',entry=>entry.event==='effect-uncertain']) {
    const original=report(); original.snapshot.ledger=original.snapshot.ledger.filter(entry=>!remove(entry));
    assert.throws(()=>R.plan(original),/reconciliation/);
  }
});
test('reordered, duplicated, stale-sequence, foreign, and unknown ledger entries are rejected',()=>{
  for (const mutate of [ledger=>{[ledger[6],ledger[7]]=[ledger[7],ledger[6]];},
    ledger=>{ledger.push(clone(ledger[6]));},ledger=>{ledger[8].sequence=99;},
    ledger=>{ledger[8].challengeId='9999';},ledger=>{ledger.push({event:'purchase-confirmed'});}]) {
    const original=report(); mutate(original.snapshot.ledger); assert.throws(()=>R.plan(original),/reconciliation/);
  }
});
test('multiple uncertain challenges or any other unresolved attempt reject the whole recovery',()=>{
  for (const status of ['uncertain','save-pending','submit-pending','claim-pending','planning','saved','submitted']) {
    const original=report(); original.snapshot.queue[0].steps.push({challengeId:'4117',status,itemIds:['103']});
    assert.throws(()=>R.plan(original),/uncertain|unresolved/);
  }
});
test('active, malformed, foreign-current, and unsupported-scope reports are refused',()=>{
  for (const mutate of [value=>{value.snapshot.status='running';},value=>{value.snapshot.status='completed';},
    value=>{value.snapshot.queue=null;},value=>{value.snapshot.currentSetId='1427';},
    value=>{value.scope.gameYear=25;},value=>{value.scope.platform='unknown';},
    value=>{value.snapshot.progress.confirmedChallenges=null;},value=>{value.snapshot.queue[0].steps[0].itemIds=[];}]) {
    const original=report(); mutate(original); assert.throws(()=>R.plan(original),/reconciliation/);
  }
  assert.throws(()=>R.plan(null),/unreadable/);
});
test('progress derives from completed steps rather than incrementing a stale display count',()=>{
  const original=report(), queue=original.snapshot.queue;
  queue[0].steps.unshift({challengeId:'4115',status:'completed',itemIds:['100']});
  original.snapshot.ledger=[...effects('4115',0,'effect-confirmed'),...effects('4116',3)];
  original.snapshot.progress={total:99,completed:12,skipped:8,confirmedChallenges:40};
  const result=R.reconcile(original,fresh());
  assert.deepEqual(result.snapshot.progress,{total:2,completed:0,skipped:0,confirmedChallenges:2});
  assert.equal(result.snapshot.queue[0].steps[0].status,'completed');
  assert.equal(original.snapshot.progress.confirmedChallenges,40);
});
