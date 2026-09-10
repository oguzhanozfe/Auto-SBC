/* Auto-SBC Local — finite batch state and guards; no EA, network, or DOM calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoSBCBatchPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_SETS = 20;
  const copy = value => JSON.parse(JSON.stringify(value));
  function id(value) {
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid SBC ID.');
    return String(value);
  }
  function batchPolicy(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Batch policy must be an object.');
    return {...input, protectPlayed:true, protectEvolutions:true, allowConcept:false, maxPurchasePrice:0};
  }
  function assertBatchPlayers(players) {
    if (!Array.isArray(players) || players.length < 1 || players.length > 11) throw new Error('Batch needs 1–11 owned players.');
    const itemIds = players.map(player => {
      if (!player || !/^[1-9]\d*$/.test(String(player.id)) || !Number.isSafeInteger(Number(player.id)) || player.concept !== false) throw new Error('Batch cannot use concepts or purchase players.');
      if (player.gamesPlayed !== 0 || !Number.isSafeInteger(player.gamesPlayed)) throw new Error('Batch protects played cards and unknown match history.');
      if (player.isEvolution !== false) throw new Error('Batch protects evolved cards and unknown evolution status.');
      return String(player.id);
    });
    if (new Set(itemIds).size !== itemIds.length) throw new Error('Duplicate owned item in batch squad.');
    return itemIds;
  }
  function availabilityReason(value) {
    if (!value || typeof value.completed !== 'boolean' || typeof value.repeatable !== 'boolean' ||
        value.remaining != null && (!Number.isSafeInteger(value.remaining) || value.remaining < 0)) throw new Error('SBC completion or remaining rights are unreadable.');
    if (value.remaining === 0) return 'rights-exhausted';
    if (value.completed) {
      if (!value.repeatable) return 'already-completed';
      if (value.remaining == null) throw new Error('Remaining repeat rights are unknown.');
    }
    return null;
  }
  function createBatch(setIds, inputPolicy = {}) {
    if (!Array.isArray(setIds) || !setIds.length || setIds.length > MAX_SETS) throw new Error(`Select 1–${MAX_SETS} SBC sets.`);
    const queue = [...new Set(setIds.map(id))].map(setId => ({setId,status:'queued',steps:[]}));
    const policy = batchPolicy(copy(inputPolicy));
    const ledger = [];
    let status = 'running', current = null, activeEffect = null, sequence = 0;
    const assertRunning = () => { if (status !== 'running') throw new Error(`Batch is ${status}; no new effects are allowed.`); };
    const step = () => current?.steps.at(-1);
    const record = (event, extra = {}) => ledger.push({event,...(current ? {setId:current.setId} : {}),...extra});
    const activeStep = () => {
      assertRunning();
      if (!current || current.status !== 'running' || !step()) throw new Error('No active batch challenge.');
      return step();
    };
    const snapshot = () => copy({status,policy,queue,ledger,currentSetId:current?.setId ?? null,
      progress:{total:queue.length,completed:queue.filter(entry=>entry.status==='completed').length,
        skipped:queue.filter(entry=>entry.status==='skipped').length,
        confirmedChallenges:queue.reduce((sum,entry)=>sum+entry.steps.filter(item=>item.status==='completed').length,0)}});
    const nextSet = () => status === 'running' && !current ? queue.find(entry=>entry.status==='queued')?.setId ?? null : null;
    function startSet(setId, availability) {
      assertRunning();
      setId = id(setId);
      if (current || nextSet() !== setId) throw new Error('SBC is not the next selected set.');
      const reason = availabilityReason(availability);
      const entry = queue.find(item=>item.setId===setId);
      if (reason) {
        entry.status='skipped'; entry.reason=reason; record('set-skipped',{setId,reason});
        if (!queue.some(item=>item.status==='queued')) status='completed';
        return false;
      }
      entry.status='running'; current=entry; record('set-started');
      return true;
    }
    function beginStep(challengeId) {
      assertRunning();
      challengeId=id(challengeId);
      if (!current || current.status!=='running' || step() && step().status!=='completed') throw new Error('Previous batch challenge is not complete.');
      if (current.steps.some(item=>item.challengeId===challengeId)) throw new Error('This batch challenge was already processed.');
      current.steps.push({challengeId,status:'planning',itemIds:[]});
      record('challenge-started',{challengeId});
    }
    function readyStep(players) {
      const entry=activeStep();
      if (entry.status!=='planning') throw new Error('Batch challenge is not awaiting a squad.');
      entry.itemIds=assertBatchPlayers(players); entry.status='ready';
      record('squad-ready',{challengeId:entry.challengeId});
    }
    function beginEffect(action, freshPlayers) {
      const entry=activeStep();
      const prior={save:'ready',submit:'saved',claim:'submitted'};
      if (!Object.hasOwn(prior,action) || entry.status!==prior[action] || activeEffect) throw new Error('Duplicate or out-of-order batch effect.');
      if (action!=='claim') {
        const freshIds=assertBatchPlayers(freshPlayers);
        if (freshIds.length!==entry.itemIds.length || freshIds.some((itemId,index)=>itemId!==entry.itemIds[index])) throw new Error('Reviewed batch squad changed.');
      }
      // Record before the caller sends anything to EA. An unresolved attempt
      // cannot be retried, even if its response was lost.
      const token=Object.freeze({setId:current.setId,challengeId:entry.challengeId,action,sequence:++sequence});
      activeEffect={token,entry}; entry.status=`${action}-pending`;
      record('effect-started',token);
      return token;
    }
    function resolveEffect(token, error) {
      if (!activeEffect || activeEffect.token!==token) throw new Error('Stale or already resolved batch effect.');
      const {entry}=activeEffect; activeEffect=null;
      if (error != null) {
        entry.status='uncertain'; entry.reason=String(error); current.status='blocked';
        if (status!=='stopped') status='blocked';
        record('effect-uncertain',{...token,reason:entry.reason});
      } else {
        entry.status={save:'saved',submit:'submitted',claim:'completed'}[token.action];
        record('effect-confirmed',token);
      }
    }
    function completeSet() {
      assertRunning();
      if (!current || !step() || step().status!=='completed' || activeEffect) throw new Error('Set has an unconfirmed challenge.');
      current.status='completed'; record('set-completed'); current=null;
      if (!queue.some(entry=>entry.status==='queued')) status='completed';
    }
    function failStep(reason) {
      const entry=activeStep();
      if (activeEffect) throw new Error('Resolve the pending effect as uncertain first.');
      const message=String(reason || 'Batch challenge failed.');
      // A later bookkeeping failure cannot undo a confirmed exchange/reward.
      if (entry.status!=='completed') { entry.status='blocked'; entry.reason=message; }
      current.status='blocked'; current.reason=message; status='blocked';
      record('challenge-blocked',{challengeId:entry.challengeId,reason:message});
    }
    function stop() {
      if (status==='completed' || status==='stopped') return;
      status='stopped'; record('batch-stopped');
    }
    return Object.freeze({snapshot,nextSet,startSet,beginStep,readyStep,beginEffect,
      confirmEffect:token=>resolveEffect(token,null),
      failEffect:(token,reason)=>resolveEffect(token,String(reason || 'EA response is uncertain.')),
      completeSet,failStep,stop});
  }
  return Object.freeze({MAX_SETS,batchPolicy,assertBatchPlayers,availabilityReason,createBatch});
});
