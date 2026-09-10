/* Auto-SBC Local — read-only evidence that a narrow 409 attempt consumed no cards. */
(function (root,factory) {
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.AutoSBCBatchReplan=api;
})(typeof globalThis!=='undefined'?globalThis:this,function () {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const validId=value=>/^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value));
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  const key=(setId,challengeId)=>`${setId}:${challengeId}`;
  const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const scope=value=>object(value)&&[26,27].includes(value.gameYear)&&['ps5','pc'].includes(value.platform);
  const fail=message=>{throw new Error(`Run verification: ${message}`);};
  function rejectTimeoutCodes(value,ancestors=new Set()) {
    if (!value || typeof value!=='object') return;
    if (ancestors.has(value)) fail('The run report is unreadable.');
    ancestors.add(value);
    for (const [name,child] of Object.entries(value)) {
      if (name==='code' && typeof child==='string' && /TIME(?:D_?)?OUT/i.test(child)) fail('A timed-out request cannot use this verification.');
      rejectTimeoutCodes(child,ancestors);
    }
    ancestors.delete(value);
  }
  function progress(queue) {
    return {total:queue.length,completed:queue.filter(set=>set.status==='completed').length,
      skipped:queue.filter(set=>set.status==='skipped').length,
      confirmedChallenges:queue.reduce((sum,set)=>sum+set.steps.filter(step=>step.status==='completed').length,0)};
  }
  function inspect(report) {
    if (!object(report) || typeof report.runId!=='string' || !report.runId || !scope(report.scope) ||
        !iso(report.updatedAt) || !object(report.lastError) || report.lastError.status!==409 ||
        !object(report.snapshot) || !Array.isArray(report.receipts)) fail('An exact stopped EA 409 report is required.');
    rejectTimeoutCodes(report);
    const snapshot=report.snapshot;
    if (!['blocked','stopped'].includes(snapshot.status) || !Array.isArray(snapshot.queue) || !snapshot.queue.length ||
        !Array.isArray(snapshot.ledger) || !object(snapshot.progress)) fail('The run is active or its history is incomplete.');
    const sets=new Map(),steps=new Map(); let target=null;
    snapshot.queue.forEach((set,setIndex)=>{
      if (!object(set) || !validId(set.setId) || sets.has(String(set.setId)) ||
          !['queued','completed','skipped','blocked','stopped'].includes(set.status) || !Array.isArray(set.steps)) fail('The selected set history is unreadable.');
      sets.set(String(set.setId),set);
      if (['queued','skipped'].includes(set.status)&&set.steps.length) fail('An unstarted set contains recorded attempts.');
      set.steps.forEach((step,stepIndex)=>{
        if (!object(step) || !validId(step.challengeId) || !Array.isArray(step.itemIds) || step.itemIds.length<1 ||
            step.itemIds.length>11 || step.itemIds.some(itemId=>!validId(itemId)) ||
            new Set(step.itemIds.map(String)).size!==step.itemIds.length) fail('Saved player identities are unreadable.');
        const stepKey=key(set.setId,step.challengeId);
        if (steps.has(stepKey) || !['completed','uncertain'].includes(step.status)) fail('Another unresolved or duplicate attempt exists.');
        steps.set(stepKey,{step,phase:'new'});
        if (step.status==='uncertain') {
          if (target || step.itemIds.length!==11 || !['blocked','stopped'].includes(set.status)) fail('Exactly one uncertain eleven-player submission is required.');
          if (typeof step.reason!=='string' || !/\b409\b/.test(step.reason) || /timeout|timed out|did not respond/i.test(step.reason)) fail('The uncertain attempt is not an explicit EA 409 response.');
          target={setId:String(set.setId),challengeId:String(step.challengeId),itemIds:step.itemIds.map(String),setIndex,stepIndex};
        }
      });
    });
    if (!target || String(snapshot.currentSetId)!==target.setId) fail('One stopped current submission is required.');
    for (const set of sets.values()) if (['blocked','stopped'].includes(set.status)&&String(set.setId)!==target.setId) fail('Another stopped set remains unresolved.');
    const derived=progress(snapshot.queue);
    for (const field of Object.keys(derived)) if (!count(snapshot.progress[field]) || snapshot.progress[field]!==derived[field]) fail('Progress disagrees with the recorded completed parts.');
    const lifecycle=new Set(['set-started','challenge-started','squad-ready','set-skipped','set-completed','challenge-blocked','batch-stopped']);
    let active=null,lastSequence=0,saveSequence=null,submitSequence=null;
    for (const event of snapshot.ledger) {
      if (!object(event) || typeof event.event!=='string') fail('The run ledger is unreadable.');
      if (event.setId!=null && (!validId(event.setId)||!sets.has(String(event.setId)))) fail('The ledger references another set.');
      if (event.challengeId!=null && (!validId(event.challengeId)||!steps.has(key(event.setId,event.challengeId)))) fail('The ledger references another challenge.');
      if (lifecycle.has(event.event)) continue;
      if (!['effect-started','effect-confirmed','effect-uncertain'].includes(event.event) ||
          !['save','submit','claim'].includes(event.action) || !count(event.sequence) || event.sequence<1 ||
          !validId(event.setId) || !validId(event.challengeId)) fail('An unknown action exists in the ledger.');
      const stepKey=key(event.setId,event.challengeId),state=steps.get(stepKey);
      if (!state || submitSequence!==null) fail('Another action follows the uncertain submission.');
      if (event.event==='effect-started') {
        if (active || event.sequence!==lastSequence+1 || state.phase!=={save:'new',submit:'saved',claim:'submitted'}[event.action]) fail('The action history is duplicated or out of order.');
        active={stepKey,action:event.action,sequence:event.sequence}; lastSequence=event.sequence;
        state.phase=`${event.action}-pending`;
      } else {
        if (!active || active.stepKey!==stepKey || active.action!==event.action || active.sequence!==event.sequence) fail('An action result does not match its recorded attempt.');
        active=null;
        if (event.event==='effect-uncertain') {
          if (event.action!=='submit' || stepKey!==key(target.setId,target.challengeId) ||
              event.reason!==state.step.reason) fail('Only the matching EA 409 submission may be unresolved.');
          state.phase='uncertain'; submitSequence=event.sequence;
        } else {
          state.phase={save:'saved',submit:'submitted',claim:'completed'}[event.action];
          if (stepKey===key(target.setId,target.challengeId)) {
            if (event.action!=='save') fail('The target already has a successful submission result.');
            saveSequence=event.sequence;
          }
        }
      }
    }
    if (active || submitSequence===null || saveSequence===null || submitSequence!==saveSequence+1) fail('A confirmed save followed by the uncertain submission is required.');
    for (const {step,phase} of steps.values()) if (step.status!==phase) fail('Challenge state disagrees with the recorded actions.');
    const receipts=new Map();
    for (const receipt of report.receipts) {
      if (!object(receipt) || !validId(receipt.setId) || !validId(receipt.challengeId)) fail('A prior submission receipt is unreadable.');
      const receiptKey=key(receipt.setId,receipt.challengeId),state=steps.get(receiptKey);
      if (receiptKey===key(target.setId,target.challengeId)) fail('A receipt already exists for the uncertain submission.');
      if (!state || state.step.status!=='completed' || receipts.has(receiptKey) || receipt.completed!==true ||
          receipt.rewardsGranted!==true || typeof receipt.setCompleted!=='boolean' || !iso(receipt.at) ||
          !count(receipt.beforeChallenge) || !count(receipt.beforeSet)) fail('Prior completed parts lack consistent success receipts.');
      if (receipt.cardIds!==undefined && (!Array.isArray(receipt.cardIds) || receipt.cardIds.length!==state.step.itemIds.length ||
          receipt.cardIds.some((itemId,index)=>String(itemId)!==String(state.step.itemIds[index])))) fail('A prior receipt names different saved players.');
      receipts.set(receiptKey,receipt);
    }
    for (const [stepKey,{step}] of steps) if (step.status==='completed'&&!receipts.has(stepKey)) fail('A prior completed part is missing its receipt.');
    return {...target,saveSequence,submitSequence};
  }
  function plan(report) {
    const {setId,challengeId,itemIds,submitSequence}=inspect(report);
    return {runId:report.runId,scope:copy(report.scope),setId,challengeId,itemIds:[...itemIds],submitSequence};
  }
  function checkState(value,target) {
    if (!object(value) || String(value.setId)!==target.setId || String(value.challengeId)!==target.challengeId ||
        value.isRepeatable!==false || value.setCompleted!==false || value.challengeCompleted!==false ||
        !['IN_PROGRESS','NOT_STARTED'].includes(value.challengeStatus) || value.setTimesCompleted!==0 ||
        value.challengeTimesCompleted!==0 || !iso(value.observedAt)) fail('EA must confirm the same nonrepeatable, incomplete set and challenge with zero completion counters.');
  }
  function reconcile(report,evidence) {
    const target=inspect(report);
    if (!object(evidence) || evidence.runId!==report.runId || !scope(evidence.scope) ||
        evidence.scope.gameYear!==report.scope.gameYear || evidence.scope.platform!==report.scope.platform) fail('Verification belongs to another run, season, or market.');
    checkState(evidence.initial,target); checkState(evidence.final,target);
    if (evidence.initial.challengeStatus!==evidence.final.challengeStatus) fail('The challenge changed while ownership was checked.');
    const inventory=evidence.inventory;
    if (!object(inventory) || inventory.cacheReset!==true || inventory.clubComplete!==true || inventory.storageComplete!==true ||
        !Array.isArray(inventory.items) || inventory.items.length<11 || inventory.items.length>20000 || !iso(inventory.observedAt)) fail('A complete fresh Club and SBC Storage read is required.');
    const times=[report.updatedAt,evidence.initial.observedAt,inventory.observedAt,evidence.final.observedAt].map(Date.parse);
    if (times.some((time,index)=>index>0&&time<times[index-1])) fail('The verification reads are stale or out of order.');
    const owned=new Map();
    for (const item of inventory.items) {
      if (!object(item) || !validId(item.id) || owned.has(String(item.id)) ||
          !['club','storage'].includes(item.source) || item.concept!==false || item.isPlayer!==true) fail('Ownership evidence must contain unique players read directly from Club or SBC Storage.');
      owned.set(String(item.id),item.source);
    }
    if (target.itemIds.some(itemId=>!owned.has(itemId))) fail('At least one saved player is no longer confirmed as owned. The attempt remains unresolved.');
    const result=copy(report), snapshot=result.snapshot,set=snapshot.queue[target.setIndex],step=set.steps[target.stepIndex];
    const verification={method:'read-only-no-completion',runId:report.runId,scope:copy(report.scope),
      setId:target.setId,challengeId:target.challengeId,saveSequence:target.saveSequence,submitSequence:target.submitSequence,
      observedAt:evidence.final.observedAt,initial:copy(evidence.initial),final:copy(evidence.final),
      ownership:{cacheReset:true,clubComplete:true,storageComplete:true,observedAt:inventory.observedAt,
        matchedItems:target.itemIds.map(itemId=>({id:itemId,source:owned.get(itemId)}))},
      noCompletion:true,previousReason:step.reason,previousStatus:snapshot.status};
    step.status='blocked'; step.reason='EA reports no completion and all eleven saved players still owned. A fresh plan requires a new action.';
    step.reconciliation=copy(verification); set.status='blocked'; snapshot.status='stopped';
    // Keep the original uncertain attempt. This is a read conclusion, never a
    // synthetic success receipt, completion credit, or permission to replay it.
    snapshot.ledger.push({event:'read-reconciled-no-completion',setId:target.setId,challengeId:target.challengeId,
      sequence:target.submitSequence,observedAt:evidence.final.observedAt,noCompletion:true,ownedSavedItemCount:11});
    result.reconciliation=verification; result.updatedAt=evidence.final.observedAt;
    result.phase='Read-only checks confirmed no completion and all saved cards still owned. The batch remains stopped; review a fresh plan.';
    return result;
  }
  return Object.freeze({plan,reconcile});
});
