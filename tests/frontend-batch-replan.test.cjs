const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../frontend/batch-replan.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const itemIds=base=>Array.from({length:11},(_,index)=>String(base+index));
const at='2026-09-10T00:00:00.000Z';
function pair(setId,challengeId,action,sequence,uncertain=false) {
  return [{event:'effect-started',setId,challengeId,action,sequence},
    {event:uncertain?'effect-uncertain':'effect-confirmed',setId,challengeId,action,sequence,
      ...(uncertain?{reason:'Automatic SBC submit: EA returned 409.'}:{})}];
}
function report() {
  return {runId:'synthetic-409-run',scope:{gameYear:26,platform:'ps5'},updatedAt:at,
    lastError:{status:409,operation:'Automatic SBC submit'},phase:'Stopped after EA 409',
    receipts:[{setId:'100',challengeId:'101',completed:true,setCompleted:true,rewardsGranted:true,
      beforeChallenge:0,beforeSet:0,at,cardIds:itemIds(1000),zeroGames:true,coinSpent:0}],
    snapshot:{status:'blocked',currentSetId:'200',policy:{protectPlayed:true,protectEvolutions:true,allowConcept:false},
      queue:[{setId:'100',status:'completed',steps:[{challengeId:'101',status:'completed',itemIds:itemIds(1000)}]},
        {setId:'200',status:'blocked',steps:[{challengeId:'201',status:'uncertain',itemIds:itemIds(2000),reason:'Automatic SBC submit: EA returned 409.'}]},
        {setId:'300',status:'queued',steps:[]}],
      ledger:[{event:'set-started',setId:'100'},{event:'challenge-started',setId:'100',challengeId:'101'},
        ...pair('100','101','save',1),...pair('100','101','submit',2),...pair('100','101','claim',3),
        {event:'set-completed',setId:'100'},{event:'set-started',setId:'200'},{event:'challenge-started',setId:'200',challengeId:'201'},
        ...pair('200','201','save',4),...pair('200','201','submit',5,true)],
      progress:{total:3,completed:1,skipped:0,confirmedChallenges:1}}};
}
function evidence() {
  const state={setId:'200',challengeId:'201',isRepeatable:false,setCompleted:false,challengeCompleted:false,
    challengeStatus:'IN_PROGRESS',setTimesCompleted:0,challengeTimesCompleted:0};
  return {runId:'synthetic-409-run',scope:{gameYear:26,platform:'ps5'},
    initial:{...state,observedAt:'2026-09-10T00:01:00.000Z'},
    inventory:{cacheReset:true,clubComplete:true,storageComplete:true,observedAt:'2026-09-10T00:02:00.000Z',
      items:itemIds(2000).map((id,index)=>({id,source:index%2?'club':'storage',concept:false,isPlayer:true}))},
    final:{...state,observedAt:'2026-09-10T00:03:00.000Z'}};
}
test('an explicit 409 can be cleared only into a stopped fresh-plan state with no completion credit',()=>{
  const original=report(), before=clone(original), proof=evidence(), proofBefore=clone(proof);
  const result=R.reconcile(original,proof);
  assert.deepEqual(original,before); assert.deepEqual(proof,proofBefore);
  assert.equal(result.snapshot.status,'stopped');
  assert.equal(result.snapshot.queue[1].status,'blocked');
  assert.equal(result.snapshot.queue[1].steps[0].status,'blocked');
  assert.deepEqual(result.snapshot.progress,original.snapshot.progress);
  assert.deepEqual(result.receipts,original.receipts);
  assert.deepEqual(result.snapshot.queue[0],original.snapshot.queue[0]);
  assert.deepEqual(result.snapshot.queue[2],original.snapshot.queue[2]);
  assert.deepEqual(result.snapshot.ledger.slice(0,-1),original.snapshot.ledger);
  assert.equal(result.snapshot.ledger.at(-1).event,'read-reconciled-no-completion');
  assert.equal(result.snapshot.ledger.filter(event=>event.event==='effect-started').length,5);
  assert.equal(result.reconciliation.noCompletion,true);
  assert.equal(result.reconciliation.ownership.matchedItems.length,11);
  assert.equal(result.reconciliation.observedAt,proof.final.observedAt);
  assert.equal(result.updatedAt,proof.final.observedAt);
  assert.throws(()=>R.plan(result),/unresolved|submission/);
});
test('the read plan exposes only exact run scope, challenge, saved IDs, and submit sequence',()=>{
  const original=report(), plan=R.plan(original);
  assert.deepEqual(plan,{runId:'synthetic-409-run',scope:{gameYear:26,platform:'ps5'},setId:'200',challengeId:'201',itemIds:itemIds(2000),submitSequence:5});
  plan.scope.gameYear=27; plan.itemIds[0]='999';
  assert.equal(original.scope.gameYear,26); assert.equal(original.snapshot.queue[1].steps[0].itemIds[0],'2000');
});
test('HTTP status must be numeric 409, and any timeout code rejects recovery',()=>{
  for (const status of ['409',408,429,500,undefined]) {
    const original=report(); original.lastError.status=status; assert.throws(()=>R.plan(original),/exact stopped EA 409/);
  }
  for (const code of ['TIMEOUT','ETIMEDOUT','REQUEST_TIMED_OUT']) {
    const original=report(); original.lastError.code=code; assert.throws(()=>R.plan(original),/timed-out/);
  }
  const nested=report(); nested.extra={failure:{code:'TIMEOUT'}}; assert.throws(()=>R.plan(nested),/timed-out/);
  const text=report(); text.snapshot.queue[1].steps[0].reason='EA 409 followed by a timeout';
  assert.throws(()=>R.plan(text),/explicit EA 409/);
});
test('repeatable, completed, previously completed, or unknown native states cannot prove no consumption',()=>{
  for (const change of [{isRepeatable:true},{isRepeatable:undefined},{setCompleted:true},{setCompleted:null},
    {challengeCompleted:true},{challengeCompleted:undefined},{setTimesCompleted:1},{challengeTimesCompleted:1},
    {setTimesCompleted:'0'},{challengeTimesCompleted:false},{challengeStatus:'UNKNOWN'},{challengeStatus:undefined}]) {
    for (const stage of ['initial','final']) {
      const proof=evidence(); Object.assign(proof[stage],change); assert.throws(()=>R.reconcile(report(),proof),/nonrepeatable, incomplete/);
    }
  }
});
test('the final native read must preserve the same valid incomplete status',()=>{
  const proof=evidence(); proof.final.challengeStatus='NOT_STARTED';
  assert.throws(()=>R.reconcile(report(),proof),/changed while ownership/);
  proof.initial.challengeStatus='NOT_STARTED';
  assert.equal(R.reconcile(report(),proof).reconciliation.noCompletion,true);
});
test('foreign run, game, market, set, or challenge evidence is rejected',()=>{
  for (const mutate of [proof=>{proof.runId='other';},proof=>{proof.scope.gameYear=27;},proof=>{proof.scope.platform='pc';},
    proof=>{proof.initial.setId='100';},proof=>{proof.final.challengeId='202';}]) {
    const proof=evidence(); mutate(proof); assert.throws(()=>R.reconcile(report(),proof),/another run|same nonrepeatable/);
  }
});
test('every one of the eleven exact saved item IDs must still be observed as owned',()=>{
  for (const mutate of [proof=>{proof.inventory.items.pop();},proof=>{proof.inventory.items[0].id='9999';},
    proof=>{proof.inventory.items[0].id=proof.inventory.items[1].id;}]) {
    const proof=evidence(); mutate(proof); assert.throws(()=>R.reconcile(report(),proof),/fresh Club|no longer confirmed|unique players/);
  }
  const reordered=evidence(); reordered.inventory.items.reverse();
  reordered.inventory.items.push({id:'9999',source:'club',concept:false,isPlayer:true});
  assert.equal(R.reconcile(report(),reordered).reconciliation.ownership.matchedItems.length,11);
});
test('repository, saved-squad, concept, and unverified player references are not ownership evidence',()=>{
  for (const change of [{source:'repository'},{source:'saved-squad'},{source:undefined},
    {concept:true},{concept:undefined},{isPlayer:false},{isPlayer:undefined},{id:0}]) {
    const proof=evidence(); Object.assign(proof.inventory.items[0],change);
    assert.throws(()=>R.reconcile(report(),proof),/read directly from Club or SBC Storage/);
  }
});
test('ownership reads must explicitly confirm cache reset and complete Club and Storage scans',()=>{
  for (const field of ['cacheReset','clubComplete','storageComplete']) for (const value of [false,undefined,'true']) {
    const proof=evidence(); proof.inventory[field]=value;
    assert.throws(()=>R.reconcile(report(),proof),/complete fresh Club/);
  }
});
test('proof must be captured after the failed report in initial, ownership, final order',()=>{
  for (const mutate of [proof=>{proof.initial.observedAt='2026-09-09T23:59:00.000Z';},
    proof=>{proof.inventory.observedAt='2026-09-10T00:00:30.000Z';},
    proof=>{proof.final.observedAt='2026-09-10T00:01:30.000Z';},
    proof=>{proof.inventory.observedAt='invalid';}]) {
    const proof=evidence(); mutate(proof); assert.throws(()=>R.reconcile(report(),proof),/stale or out of order|complete fresh Club/);
  }
});
test('any target receipt or confirmed target submit result rules out this no-completion recovery',()=>{
  const original=report(); original.receipts.push({...clone(original.receipts[0]),setId:'200',challengeId:'201',cardIds:itemIds(2000)});
  assert.throws(()=>R.plan(original),/receipt already exists/);
  const confirmed=report(); confirmed.snapshot.ledger.at(-1).event='effect-confirmed';
  assert.throws(()=>R.plan(confirmed),/successful submission/);
});
test('a missing, uncertain, or mismatched save confirmation cannot authorize a new plan',()=>{
  for (const mutate of [ledger=>{ledger.splice(ledger.length-3,1);},
    ledger=>{ledger[ledger.length-3].event='effect-uncertain';},
    ledger=>{ledger[ledger.length-3].challengeId='202';},
    ledger=>{ledger.at(-1).reason='EA returned 500';}]) {
    const original=report(); mutate(original.snapshot.ledger); assert.throws(()=>R.plan(original),/Run verification/);
  }
});
test('another unresolved phase, additional uncertain step, or action after the failure blocks recovery',()=>{
  for (const status of ['save-pending','submit-pending','claim-pending','uncertain','planning']) {
    const original=report(); original.snapshot.queue[1].steps.push({challengeId:'202',status,itemIds:itemIds(3000),reason:'EA returned 409'});
    assert.throws(()=>R.plan(original),/unresolved|one uncertain/);
  }
  const later=report(); later.snapshot.ledger.push({event:'effect-started',setId:'200',challengeId:'201',action:'claim',sequence:6});
  assert.throws(()=>R.plan(later),/Another action follows/);
});
test('prior completed receipts and displayed progress must agree with the durable history',()=>{
  for (const mutate of [value=>{value.receipts=[];},value=>{value.receipts[0].rewardsGranted=false;},
    value=>{value.receipts.push(clone(value.receipts[0]));},value=>{value.snapshot.progress.confirmedChallenges=0;},
    value=>{value.snapshot.progress.completed=2;}]) {
    const original=report(); mutate(original); assert.throws(()=>R.plan(original),/receipt|Progress/);
  }
});
test('non-eleven-card, duplicated, unknown, active, and malformed reports remain blocked',()=>{
  for (const mutate of [value=>{value.snapshot.queue[1].steps[0].itemIds.pop();},
    value=>{value.snapshot.queue[1].steps[0].itemIds[0]='2001';},value=>{value.snapshot.status='running';},
    value=>{value.snapshot.currentSetId='300';},value=>{value.snapshot.ledger.push({event:'unknown'});},
    value=>{value.updatedAt='yesterday';}]) {
    const original=report(); mutate(original); assert.throws(()=>R.plan(original),/Run verification/);
  }
  assert.throws(()=>R.plan(null),/exact stopped/);
});
