/* Auto-SBC Local — finite batch orchestration; adapters own all EA interactions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoSBCBatchRunner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const started = new WeakSet();
  const sameId = (left, right) => left != null && right != null && String(left) === String(right);
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
  const message = error => error?.message || String(error);

  // Adapter contract:
  // snapshotSet(setId) -> {setId,completed,repeatable,remaining,challenges:[{challengeId,completed}]}
  // solve(step) -> {players:[normalized owned cards], ...opaque}
  // freshPlayers(step,solution,'save'|'submit',applyReceipt|null) -> normalized cards in reviewed order
  // apply(step,solution) -> {setId,challengeId,saved:true, ...opaque}
  // submit(step,solution,applyReceipt) -> {setId,challengeId,completed:true,setCompleted,rewardsGranted,...opaque}
  // verifyRewards(step,submitReceipt) -> {setId,challengeId,rewardsGranted:true,setCompleted}
  // verifyRewards is read-only bookkeeping for rewards granted by submit, never a second claim write.
  async function run({controller, adapter, onProgress} = {}) {
    if (!controller || typeof controller !== 'object' || typeof controller.snapshot !== 'function') throw new Error('A batch controller is required.');
    if (started.has(controller)) throw new Error('This batch runner has already started; unresolved writes are never retried.');
    for (const name of ['snapshotSet','solve','freshPlayers','apply','submit','verifyRewards']) {
      if (typeof adapter?.[name] !== 'function') throw new Error(`Missing batch adapter: ${name}.`);
    }
    started.add(controller);
    let step = null;
    const running = () => controller.snapshot().status === 'running';
    // The observer persists the detached journal. A pending effect must reach
    // durable storage before dispatch; rendering/persistence failures halt.
    const progress = async phase => onProgress?.({phase,step:step && {...step},snapshot:controller.snapshot()});
    const identity = (receipt, label) => {
      if (!receipt || !sameId(receipt.setId,step.setId) || !sameId(receipt.challengeId,step.challengeId)) throw new Error(`${label} receipt does not match the selected SBC challenge.`);
    };
    async function effect(action, players, invoke, validate) {
      if (!running()) return null;
      const token = controller.beginEffect(action,players);
      let receipt;
      try {
        await progress(action);
        if (!running()) {
          controller.failEffect(token,'Stopped before dispatch; no EA request was sent.');
          return null;
        }
        receipt = await invoke();
        validate(receipt);
      } catch (error) {
        controller.failEffect(token,message(error));
        throw error;
      }
      // Stop may have arrived while EA was handling the request. Record the
      // observed outcome, but the caller must not start the next effect.
      controller.confirmEffect(token);
      await progress(`${action}-confirmed`);
      return receipt;
    }
    try {
      while (running()) {
        const setId = controller.nextSet();
        if (setId == null) break;
        step = null;
        await progress('snapshot');
        if (!running()) break;
        const availability = await adapter.snapshotSet(setId);
        if (!running()) break;
        if (!availability || !sameId(availability.setId,setId)) throw new Error('SBC availability belongs to another set.');
        if (!controller.startSet(setId,availability)) { await progress('set-skipped'); continue; }
        if (!Array.isArray(availability.challenges) || !availability.challenges.length) throw new Error('SBC challenge snapshot is empty or unreadable.');
        const seen = new Set();
        const pending = [];
        for (const challenge of availability.challenges) {
          if (!challenge || !validId(challenge.challengeId) || typeof challenge.completed !== 'boolean') throw new Error('SBC challenge completion is unreadable.');
          const challengeId = String(challenge.challengeId);
          if (seen.has(challengeId)) throw new Error('SBC challenge snapshot contains duplicate IDs.');
          seen.add(challengeId);
          if (!challenge.completed) pending.push(Object.freeze({setId:String(setId),challengeId}));
        }
        if (!pending.length) throw new Error('No unfinished challenge is available in the selected SBC snapshot.');
        let setCompleted = false;
        // Freeze this finite work list. A repeatable set can reset its native
        // status immediately after submit; it must not enter the queue again.
        for (const selected of pending) {
          if (!running()) break;
          step = selected;
          controller.beginStep(step.challengeId);
          await progress('solve');
          if (!running()) break;
          const solution = await adapter.solve(step);
          if (!running()) break;
          controller.readyStep(solution?.players);
          const beforeSave = await adapter.freshPlayers(step,solution,'save',null);
          if (!running()) break;
          const saved = await effect('save',beforeSave,() => adapter.apply(step,solution), receipt => {
            identity(receipt,'Save');
            if (receipt.saved !== true) throw new Error('SBC squad save was not confirmed.');
          });
          if (!running()) break;
          const beforeSubmit = await adapter.freshPlayers(step,solution,'submit',saved);
          if (!running()) break;
          const submitted = await effect('submit',beforeSubmit,() => adapter.submit(step,solution,saved), receipt => {
            identity(receipt,'Submit');
            if (receipt.completed !== true || typeof receipt.setCompleted !== 'boolean' || typeof receipt.rewardsGranted !== 'boolean') throw new Error('SBC submission receipt is incomplete.');
          });
          if (!running()) break;
          if (submitted.rewardsGranted !== true) throw new Error('SBC submission did not confirm granted rewards; batch stopped for reconciliation.');
          const claimed = await effect('claim',undefined,() => adapter.verifyRewards(step,submitted), receipt => {
            identity(receipt,'Reward');
            if (receipt.rewardsGranted !== true || typeof receipt.setCompleted !== 'boolean' || receipt.setCompleted !== submitted.setCompleted) throw new Error('SBC reward receipt is incomplete or disagrees with submission.');
          });
          if (!running()) break;
          if (claimed.setCompleted) {
            controller.completeSet();
            setCompleted = true;
            await progress('set-completed');
            break;
          }
        }
        if (running() && !setCompleted) throw new Error('All snapshotted challenges were processed, but EA did not confirm set completion.');
      }
      await progress('finished');
      return controller.snapshot();
    } catch (error) {
      if (running()) {
        const snapshot = controller.snapshot();
        const current = snapshot.queue.find(entry => entry.setId === snapshot.currentSetId);
        if (current?.steps?.length) controller.failStep(message(error));
        else controller.stop();
      }
      try { await progress('failed'); } catch { /* Preserve the original failure if journaling also fails. */ }
      throw error;
    }
  }
  return Object.freeze({run});
});
