const {test}=require('node:test');
const assert=require('node:assert/strict');
const Batch=require('../frontend/batch-policy.js');
const Runner=require('../frontend/batch-runner.js');

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({parts=[101,102],completed=[],sets=[10]}={}){
  const controller=Batch.createBatch(sets), calls=[];
  const players=id=>[{id:String(100000+Number(id)),concept:false,gamesPlayed:0,isEvolution:false}];
  const adapter={
    snapshotSet:async setId=>{calls.push(['snapshot',String(setId)]);return {setId,completed:false,repeatable:false,remaining:1,challenges:parts.map(challengeId=>({challengeId,completed:completed.includes(challengeId)}))};},
    solve:async step=>{calls.push(['solve',step.challengeId]);return {players:players(step.challengeId)};},
    freshPlayers:async(step,solution,phase,saved)=>{calls.push(['fresh',step.challengeId,phase]);if(phase==='submit')assert.equal(saved.saved,true);return solution.players.map(player=>({...player}));},
    apply:async step=>{calls.push(['save',step.challengeId]);return {...step,saved:true,opaque:'native-squad'};},
    submit:async(step,solution,saved)=>{calls.push(['submit',step.challengeId]);assert.equal(saved.opaque,'native-squad');return {...step,completed:true,setCompleted:Number(step.challengeId)===parts.at(-1),rewardsGranted:true};},
    verifyRewards:async(step,receipt)=>{calls.push(['rewards',step.challengeId]);return {...step,rewardsGranted:true,setCompleted:receipt.setCompleted};}
  };
  return {controller,adapter,calls};
}
test('finite queue skips completed parts, refreshes before each write, and verifies rewards',async()=>{
  const f=fixture({parts:[101,102,103],completed:[101]});
  const result=await Runner.run(f);
  assert.equal(result.status,'completed');
  assert.equal(result.progress.confirmedChallenges,2);
  assert.deepEqual(f.calls,[['snapshot','10'],['solve','102'],['fresh','102','save'],['save','102'],['fresh','102','submit'],['submit','102'],['rewards','102'],['solve','103'],['fresh','103','save'],['save','103'],['fresh','103','submit'],['submit','103'],['rewards','103']]);
});
test('second-part save failure blocks third part and following set without retries',async()=>{
  const f=fixture({parts:[101,102,103],sets:[10,20]});
  f.adapter.apply=async step=>{f.calls.push(['save',step.challengeId]);if(step.challengeId==='102')throw new Error('EA 500');return {...step,saved:true,opaque:'native-squad'};};
  await assert.rejects(Runner.run(f),/EA 500/);
  const state=f.controller.snapshot();
  assert.equal(state.status,'blocked');assert.equal(state.progress.confirmedChallenges,1);
  assert.equal(state.queue[0].steps[1].status,'uncertain');
  assert.equal(f.calls.filter(call=>call[0]==='save'&&call[1]==='102').length,1);
  assert.ok(!f.calls.some(call=>call[1]==='103'||call[0]==='snapshot'&&call[1]==='20'));
});
test('stop during solve blocks every write',async()=>{
  const f=fixture(), wait=deferred(), reached=deferred();
  f.adapter.solve=async step=>{reached.resolve();await wait.promise;return {players:[{id:'100001',concept:false,gamesPlayed:0,isEvolution:false}]};};
  const run=Runner.run(f);await reached.promise;f.controller.stop();wait.resolve();
  const result=await run;assert.equal(result.status,'stopped');
  assert.ok(!f.calls.some(call=>['save','submit','rewards'].includes(call[0])));
});
test('stop during save records its confirmation but blocks submit and rewards',async()=>{
  const f=fixture(), wait=deferred(), reached=deferred();
  f.adapter.apply=async step=>{f.calls.push(['save',step.challengeId]);reached.resolve();await wait.promise;return {...step,saved:true};};
  const run=Runner.run(f);await reached.promise;f.controller.stop();wait.resolve();
  const result=await run;assert.equal(result.status,'stopped');
  assert.equal(result.queue[0].steps[0].status,'saved');
  assert.ok(!f.calls.some(call=>['submit','rewards'].includes(call[0])));
});
test('stop during submit records it once and blocks reward bookkeeping and next part',async()=>{
  const f=fixture(), wait=deferred(), reached=deferred();
  f.adapter.submit=async step=>{f.calls.push(['submit',step.challengeId]);reached.resolve();await wait.promise;return {...step,completed:true,setCompleted:false,rewardsGranted:true};};
  const run=Runner.run(f);await reached.promise;f.controller.stop();wait.resolve();
  const result=await run;assert.equal(result.status,'stopped');
  assert.equal(result.queue[0].steps[0].status,'submitted');
  assert.ok(!f.calls.some(call=>call[0]==='rewards'||call[0]==='solve'&&call[1]==='102'));
});
test('a controller cannot be launched twice, including while its first run is pending',async()=>{
  const f=fixture({parts:[101]}), wait=deferred(), reached=deferred();
  const submit=f.adapter.submit;
  f.adapter.submit=async(...args)=>{reached.resolve();await wait.promise;return submit(...args);};
  const run=Runner.run(f);await reached.promise;
  await assert.rejects(Runner.run(f),/already started/);
  wait.resolve();await run;
  await assert.rejects(Runner.run(f),/already started/);
  assert.equal(f.calls.filter(call=>call[0]==='submit').length,1);
});
test('repeatable status reset never resnapshots or submits another cycle',async()=>{
  const f=fixture({parts:[101]}), snapshot=f.adapter.snapshotSet;
  f.adapter.snapshotSet=async id=>({...await snapshot(id),repeatable:true,remaining:10});
  const submit=f.adapter.submit;
  f.adapter.submit=async(...args)=>({...await submit(...args),nativeStatusAfter:'IN_PROGRESS',remainingAfter:9});
  const result=await Runner.run(f);
  assert.equal(result.progress.completed,1);
  assert.equal(f.calls.filter(call=>call[0]==='snapshot').length,1);
  assert.equal(f.calls.filter(call=>call[0]==='submit').length,1);
});
test('mismatched exact submit receipt blocks rewards and leaves uncertain effect',async()=>{
  const f=fixture();f.adapter.submit=async step=>({...step,challengeId:'999',completed:true,setCompleted:true,rewardsGranted:true});
  await assert.rejects(Runner.run(f),/does not match/);
  const state=f.controller.snapshot();assert.equal(state.status,'blocked');assert.equal(state.queue[0].steps[0].status,'uncertain');
  assert.ok(!f.calls.some(call=>call[0]==='rewards'));
});
test('submit timeout is an uncertain single attempt, never retried or claimed',async()=>{
  const f=fixture();
  f.adapter.submit=async step=>{f.calls.push(['submit',step.challengeId]);throw new Error('EA did not respond within 20 seconds');};
  await assert.rejects(Runner.run(f),/did not respond/);
  assert.equal(f.controller.snapshot().queue[0].steps[0].status,'uncertain');
  assert.equal(f.calls.filter(call=>call[0]==='submit').length,1);
  assert.ok(!f.calls.some(call=>call[0]==='rewards'));
});
test('mismatched save receipt blocks submit',async()=>{
  const f=fixture();f.adapter.apply=async step=>({...step,setId:'20',saved:true});
  await assert.rejects(Runner.run(f),/does not match/);
  assert.ok(!f.calls.some(call=>call[0]==='submit'));
});
test('changed played history on fresh pre-submit check blocks consumption',async()=>{
  const f=fixture(), fresh=f.adapter.freshPlayers;
  f.adapter.freshPlayers=async(...args)=>(await fresh(...args)).map(player=>({...player,gamesPlayed:args[2]==='submit'?1:0}));
  await assert.rejects(Runner.run(f),/played cards/);
  assert.ok(!f.calls.some(call=>call[0]==='submit'));
  assert.equal(f.controller.snapshot().status,'blocked');
});
test('missing set completion cannot advance to the next selected set',async()=>{
  const f=fixture({parts:[101],sets:[10,20]}), submit=f.adapter.submit;
  f.adapter.submit=async(...args)=>({...await submit(...args),setCompleted:false});
  await assert.rejects(Runner.run(f),/did not confirm set completion/);
  assert.equal(f.controller.snapshot().progress.completed,0);
  assert.ok(!f.calls.some(call=>call[0]==='snapshot'&&call[1]==='20'));
});
test('unconfirmed rewards halt without invoking any extra claim request',async()=>{
  const f=fixture(), submit=f.adapter.submit;
  f.adapter.submit=async(...args)=>({...await submit(...args),rewardsGranted:false});
  await assert.rejects(Runner.run(f),/did not confirm granted rewards/);
  assert.ok(!f.calls.some(call=>call[0]==='rewards'));
});
test('disagreeing reward receipt blocks completion and is never repeated',async()=>{
  const f=fixture({parts:[101]});
  f.adapter.verifyRewards=async step=>{f.calls.push(['rewards',step.challengeId]);return {...step,rewardsGranted:true,setCompleted:false};};
  await assert.rejects(Runner.run(f),/disagrees/);
  assert.equal(f.controller.snapshot().progress.completed,0);
  assert.equal(f.calls.filter(call=>call[0]==='rewards').length,1);
});
test('progress observer stopping before an effect prevents that write',async()=>{
  const f=fixture();
  const result=await Runner.run({...f,onProgress:event=>{if(event.phase==='save')f.controller.stop();}});
  assert.equal(result.status,'stopped');assert.ok(!f.calls.some(call=>call[0]==='save'));
});
test('pending effect is journaled before dispatch and persistence failure blocks writes',async()=>{
  const f=fixture();
  await assert.rejects(Runner.run({...f,onProgress:async event=>{
    if(event.phase==='save'){
      assert.equal(event.snapshot.queue[0].steps[0].status,'save-pending');
      await Promise.resolve();throw new Error('journal write failed');
    }
  }}),/journal write failed/);
  assert.equal(f.controller.snapshot().status,'blocked');assert.ok(!f.calls.some(call=>call[0]==='save'));
});
test('stop while the pending journal awaits blocks dispatch',async()=>{
  const f=fixture(),wait=deferred(),reached=deferred();
  const run=Runner.run({...f,onProgress:async event=>{if(event.phase==='save'){reached.resolve();await wait.promise;}}});
  await reached.promise;f.controller.stop();wait.resolve();
  const result=await run;assert.equal(result.status,'stopped');assert.ok(!f.calls.some(call=>call[0]==='save'));
});
test('post-submit persistence failure halts without retry or reward bookkeeping',async()=>{
  const f=fixture({parts:[101]});
  await assert.rejects(Runner.run({...f,onProgress:event=>{if(event.phase==='submit-confirmed')throw new Error('journal failed after submit');}}),/journal failed after submit/);
  assert.equal(f.controller.snapshot().status,'blocked');
  assert.equal(f.calls.filter(call=>call[0]==='submit').length,1);
  assert.ok(!f.calls.some(call=>call[0]==='rewards'));
});
