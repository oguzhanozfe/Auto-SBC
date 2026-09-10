/* Auto-SBC Local — read-only reconciliation of one confirmed submit receipt. */
(function (root, factory) {
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.AutoSBCBatchReconcile=api;
})(typeof globalThis!=='undefined'?globalThis:this,function () {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const validId=value=>/^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value));
  const counter=value=>Number.isSafeInteger(value)&&value>=0;
  const identity=(setId,challengeId)=>`${setId}:${challengeId}`;
  const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const fail=message=>{throw new Error(`Batch reconciliation: ${message}`);};
  function inspect(report) {
    if (!object(report) || typeof report.runId!=='string' || !report.runId || !object(report.scope) ||
        ![26,27].includes(report.scope.gameYear) || !['ps5','pc'].includes(report.scope.platform) ||
        !object(report.snapshot) || !Array.isArray(report.receipts)) fail('unreadable report.');
    const snapshot=report.snapshot;
    if (!['blocked','stopped'].includes(snapshot.status) || !Array.isArray(snapshot.queue) || !snapshot.queue.length ||
        !Array.isArray(snapshot.ledger) || !object(snapshot.progress)) fail('report is active, complete, or unreadable.');
    const sets=new Map(), steps=new Map();
    let target=null;
    snapshot.queue.forEach((set,setIndex)=>{
      if (!object(set) || !validId(set.setId) || sets.has(String(set.setId)) ||
          !['queued','completed','skipped','blocked','stopped'].includes(set.status) || !Array.isArray(set.steps)) fail('unknown set state.');
      sets.set(String(set.setId),set);
      if (['queued','skipped'].includes(set.status)&&set.steps.length) fail('unstarted set contains challenge attempts.');
      set.steps.forEach((step,stepIndex)=>{
        if (!object(step) || !validId(step.challengeId) || !Array.isArray(step.itemIds) || !step.itemIds.length ||
            step.itemIds.length>11 || step.itemIds.some(itemId=>!validId(itemId)) ||
            new Set(step.itemIds.map(String)).size!==step.itemIds.length) fail('unknown challenge shape.');
        const key=identity(set.setId,step.challengeId);
        if (steps.has(key) || !['completed','uncertain'].includes(step.status)) fail('another unresolved or duplicate challenge exists.');
        steps.set(key,{step,phase:'new'});
        if (step.status==='uncertain') {
          if (target) fail('more than one uncertain challenge exists.');
          if (!['blocked','stopped'].includes(set.status)) fail('uncertain challenge has a completed set.');
          target={setId:String(set.setId),challengeId:String(step.challengeId),setIndex,stepIndex};
        }
      });
    });
    if (!target || String(snapshot.currentSetId)!==target.setId) fail('exactly one stopped current challenge is required.');
    for (const key of ['total','completed','skipped','confirmedChallenges']) if (!counter(snapshot.progress[key])) fail('unknown progress counters.');
    const lifecycle=new Set(['set-started','challenge-started','squad-ready','set-skipped','set-completed','challenge-blocked','batch-stopped']);
    let active=null,lastSequence=0,claimSequence=null,submitSequence=null;
    for (const event of snapshot.ledger) {
      if (!object(event) || typeof event.event!=='string') fail('unknown ledger entry.');
      if (event.setId!=null && (!validId(event.setId)||!sets.has(String(event.setId)))) fail('ledger references another set.');
      if (event.challengeId!=null && (!validId(event.challengeId)||!steps.has(identity(event.setId,event.challengeId)))) fail('ledger references another challenge.');
      if (lifecycle.has(event.event)) continue;
      if (!['effect-started','effect-confirmed','effect-uncertain'].includes(event.event) ||
          !['save','submit','claim'].includes(event.action) || !counter(event.sequence) || event.sequence<1 ||
          !validId(event.setId) || !validId(event.challengeId)) fail('unknown effect ledger shape.');
      const key=identity(event.setId,event.challengeId), state=steps.get(key);
      if (!state) fail('effect has no matching challenge.');
      if (event.event==='effect-started') {
        const required={save:'new',submit:'saved',claim:'submitted'}[event.action];
        if (active || event.sequence!==lastSequence+1 || state.phase!==required) fail('duplicate or out-of-order effect attempt.');
        active={key,action:event.action,sequence:event.sequence}; lastSequence=event.sequence;
        state.phase=`${event.action}-pending`;
      } else {
        if (!active || active.key!==key || active.action!==event.action || active.sequence!==event.sequence) fail('effect receipt does not match its attempt.');
        active=null;
        if (event.event==='effect-uncertain') {
          if (event.action!=='claim' || key!==identity(target.setId,target.challengeId) || claimSequence!==null) fail('save, submit, or another claim is uncertain.');
          state.phase='uncertain'; claimSequence=event.sequence;
        } else {
          state.phase={save:'saved',submit:'submitted',claim:'completed'}[event.action];
          if (event.action==='submit' && key===identity(target.setId,target.challengeId)) submitSequence=event.sequence;
        }
      }
    }
    if (active || claimSequence===null || submitSequence===null) fail('confirmed submission and failed claim verification are required.');
    for (const {step,phase} of steps.values()) if (step.status!==phase) fail('challenge state disagrees with the effect ledger.');
    const matching=[];
    for (const receipt of report.receipts) {
      if (!object(receipt) || !validId(receipt.setId) || !validId(receipt.challengeId) ||
          !steps.has(identity(receipt.setId,receipt.challengeId))) fail('unknown submission receipt.');
      if (String(receipt.setId)===target.setId && String(receipt.challengeId)===target.challengeId) matching.push(receipt);
    }
    if (matching.length!==1) fail('one exact submission receipt is required.');
    const receipt=matching[0];
    if (receipt.completed!==true || receipt.rewardsGranted!==true || typeof receipt.setCompleted!=='boolean' ||
        !counter(receipt.beforeChallenge) || !counter(receipt.beforeSet) || !iso(receipt.at)) fail('submission success or baseline counters are unverified.');
    if (receipt.cardIds!==undefined) {
      const itemIds=steps.get(identity(target.setId,target.challengeId)).step.itemIds;
      if (!Array.isArray(receipt.cardIds) || receipt.cardIds.length!==itemIds.length ||
          receipt.cardIds.some((value,index)=>String(value)!==String(itemIds[index]))) fail('submission receipt belongs to another squad.');
    }
    return {...target,receipt,claimSequence,submitSequence};
  }
  function plan(report) {
    const {setId,challengeId,receipt,claimSequence}=inspect(report);
    return {setId,challengeId,receipt:copy(receipt),claimSequence};
  }
  function reconcile(report,freshSnapshot) {
    const target=inspect(report), receipt=target.receipt;
    if (!object(freshSnapshot) || String(freshSnapshot.setId)!==target.setId || String(freshSnapshot.challengeId)!==target.challengeId ||
        !counter(freshSnapshot.challengeTimesCompleted) || !counter(freshSnapshot.setTimesCompleted) || !iso(freshSnapshot.observedAt)) fail('fresh EA snapshot identity or counters are unreadable.');
    for (const key of ['challengeCompleted','setCompleted']) if (freshSnapshot[key]!==undefined && typeof freshSnapshot[key]!=='boolean') fail('unknown native completion flag.');
    if (Date.parse(freshSnapshot.observedAt)<Date.parse(receipt.at)) fail('EA observation predates the submission receipt.');
    if (freshSnapshot.challengeTimesCompleted<=receipt.beforeChallenge || freshSnapshot.setTimesCompleted<receipt.beforeSet ||
        receipt.setCompleted && freshSnapshot.setTimesCompleted<=receipt.beforeSet) fail('EA counters do not confirm the recorded submission.');
    // Repeatable challenges can reset their current completed flag immediately.
    // Exact submit receipts plus advanced lifetime counters establish the cycle.
    const result=copy(report), snapshot=result.snapshot, set=snapshot.queue[target.setIndex], step=set.steps[target.stepIndex];
    const evidence={method:'read-only-counters',setId:target.setId,challengeId:target.challengeId,
      observedAt:freshSnapshot.observedAt,beforeChallenge:receipt.beforeChallenge,beforeSet:receipt.beforeSet,
      challengeTimesCompleted:freshSnapshot.challengeTimesCompleted,setTimesCompleted:freshSnapshot.setTimesCompleted,
      submitSequence:target.submitSequence,claimSequence:target.claimSequence,groupCycleCompleted:receipt.setCompleted,
      previousStatus:snapshot.status,previousSetStatus:set.status,previousReason:step.reason ?? null};
    step.status='completed'; delete step.reason; step.reconciliation=copy(evidence);
    set.status=receipt.setCompleted?'completed':'blocked';
    if (receipt.setCompleted) delete set.reason;
    else set.reason='Part confirmed by read-only reconciliation; remaining set work is stopped.';
    snapshot.status='stopped';
    snapshot.progress={...snapshot.progress,total:snapshot.queue.length,
      completed:snapshot.queue.filter(entry=>entry.status==='completed').length,
      skipped:snapshot.queue.filter(entry=>entry.status==='skipped').length,
      confirmedChallenges:snapshot.queue.reduce((sum,entry)=>sum+entry.steps.filter(item=>item.status==='completed').length,0)};
    snapshot.ledger.push({event:'read-reconciled',setId:target.setId,challengeId:target.challengeId,
      sequence:target.claimSequence,observedAt:freshSnapshot.observedAt,
      challengeTimesCompleted:freshSnapshot.challengeTimesCompleted,setTimesCompleted:freshSnapshot.setTimesCompleted,
      groupCycleCompleted:receipt.setCompleted});
    result.reconciliation=evidence; result.updatedAt=freshSnapshot.observedAt;
    result.phase='Read-only reconciliation confirmed the recorded submission. Batch remains stopped.';
    return result;
  }
  return Object.freeze({plan,reconcile});
});
