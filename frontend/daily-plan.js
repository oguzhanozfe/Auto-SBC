/* Auto-SBC Local — pure finite daily-upgrade planning; no EA or storage calls. */
(function (root, factory) {
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.AutoSBCDailyPlan=api;
})(typeof globalThis!=='undefined'?globalThis:this,function () {
  'use strict';
  const DEFAULT_LIMITS=Object.freeze({maxPerSet:30,maxTotal:80});
  const DAILY_NAMES=Object.freeze({
    'daily bronze upgrade':'bronze',
    'daily silver upgrade':'silver',
    'daily common gold upgrade':'common',
    'daily rare gold upgrade':'rare'
  });
  const ORDER=Object.freeze(['bronze','silver','common','rare']);
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const validId=value=>/^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value));
  function dailyKind(name) {
    if (typeof name!=='string') return null;
    const normalized=name.trim().replace(/\s+/g,' ').toLowerCase();
    return Object.hasOwn(DAILY_NAMES,normalized)?DAILY_NAMES[normalized]:null;
  }
  // Snapshot contract: native id/name/isRepeatable/isLimitedRepeatable/repeats/
  // timesCompleted, plus completed=isComplete(), expired=hasExpired(), and
  // remaining=getRepeatsRemaining(), synchronously read by the EA adapter.
  // EA's finite remaining count is repeats-timesCompleted; no local reset or
  // "unlimited" count is inferred when any field is unknown or contradictory.
  function unavailableReason(snapshot) {
    if (!snapshot || !validId(snapshot.id)) return 'invalid-id';
    if (typeof snapshot.completed!=='boolean' || typeof snapshot.expired!=='boolean') return 'unknown-status';
    if (snapshot.expired) return 'expired';
    if (snapshot.completed) return 'completed';
    if (snapshot.isRepeatable!==true || snapshot.isLimitedRepeatable!==true) return 'finite-repeat-rights-unavailable';
    if (!integer(snapshot.repeats) || !integer(snapshot.timesCompleted) || !integer(snapshot.remaining)) return 'invalid-repeat-counters';
    if (snapshot.repeats-snapshot.timesCompleted!==snapshot.remaining) return 'inconsistent-repeat-counters';
    if (snapshot.remaining===0) return 'rights-exhausted';
    return null;
  }
  function limitsFor(options) {
    const limits={...DEFAULT_LIMITS,...options};
    for (const key of ['maxPerSet','maxTotal']) {
      if (!integer(limits[key]) || limits[key]<1 || limits[key]>1000) throw new Error(`${key} must be an integer from 1 to 1000.`);
    }
    return limits;
  }
  function createPlan(snapshots, options={}) {
    if (!Array.isArray(snapshots)) throw new Error('Daily SBC snapshots must be an array.');
    const limits=limitsFor(options), candidates=[], skipped=[], seenIds=new Set(), seenKinds=new Set();
    for (const snapshot of snapshots) {
      const kind=dailyKind(snapshot?.name);
      if (!kind) continue;
      const reason=unavailableReason(snapshot);
      const setId=String(snapshot.id ?? '');
      if (reason) { skipped.push(Object.freeze({setId,name:snapshot.name,kind,reason})); continue; }
      if (seenIds.has(setId) || seenKinds.has(kind)) throw new Error(`Ambiguous daily SBC selection: ${snapshot.name}.`);
      seenIds.add(setId); seenKinds.add(kind);
      if (snapshot.remaining>limits.maxPerSet) throw new Error(`${snapshot.name}: ${snapshot.remaining} remaining exceeds the ${limits.maxPerSet} repetitions per set limit.`);
      candidates.push({setId,name:snapshot.name,kind,repetitions:snapshot.remaining,beforeTimesCompleted:snapshot.timesCompleted});
    }
    candidates.sort((left,right)=>ORDER.indexOf(left.kind)-ORDER.indexOf(right.kind));
    const totalCycles=candidates.reduce((sum,entry)=>sum+entry.repetitions,0);
    if (totalCycles>limits.maxTotal) throw new Error(`${totalCycles} daily repetitions exceed the ${limits.maxTotal} total limit.`);
    const entries=[];
    for (const selected of candidates) {
      for (let cycle=1;cycle<=selected.repetitions;cycle++) entries.push(Object.freeze({
        setId:selected.setId,name:selected.name,kind:selected.kind,cycle,
        plannedRemaining:selected.repetitions-cycle+1,
        beforeTimesCompleted:selected.beforeTimesCompleted+cycle-1
      }));
    }
    return Object.freeze({
      entries:Object.freeze(entries),
      sets:Object.freeze(candidates.map(({beforeTimesCompleted,...selected})=>Object.freeze(selected))),
      skipped:Object.freeze(skipped),totalCycles
    });
  }
  function assertCycle(entry, freshSnapshot) {
    if (!entry || !validId(entry.setId) || !integer(entry.cycle) || entry.cycle<1 ||
        !integer(entry.plannedRemaining) || entry.plannedRemaining<1 || !integer(entry.beforeTimesCompleted) ||
        dailyKind(entry.name)!==entry.kind || !ORDER.includes(entry.kind)) throw new Error('Invalid planned daily repetition.');
    if (String(freshSnapshot?.id)!==String(entry.setId) || dailyKind(freshSnapshot?.name)!==entry.kind) throw new Error('Daily repetition belongs to another SBC set.');
    const reason=unavailableReason(freshSnapshot);
    if (reason) throw new Error(`Daily SBC is unavailable: ${reason}.`);
    if (freshSnapshot.timesCompleted!==entry.beforeTimesCompleted || freshSnapshot.remaining!==entry.plannedRemaining) throw new Error('Daily SBC repetition counters changed; rebuild the plan before continuing.');
    return true;
  }
  return Object.freeze({DEFAULT_LIMITS,dailyKind,createPlan,assertCycle});
});
