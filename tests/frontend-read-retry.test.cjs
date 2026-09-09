const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Retry=require('../frontend/read-retry.js');

function fixture(extra={}) {
  let clock=10000,calls=0;
  const sleeps=[],progress=[],attemptTimes=[];
  const options={kind:'requestSets',request:async()=>{calls++;attemptTimes.push(clock);return {sets:[]};},guard:()=>{},
    now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms;},onWait:event=>progress.push(event),...extra};
  return {options,sleeps,progress,attemptTimes,get calls(){return calls;},get clock(){return clock;}};
}
const limited=seconds=>Object.assign(new Error('EA 429'),{status:429,...(seconds===undefined?{}:{retryAfterSeconds:seconds})});

test('both allowed reads return successful values without sleeping or retrying',async()=>{
  for(const kind of ['requestSets','requestChallengesForSet']) {
    const f=fixture({kind}), result=await Retry.read(f.options);
    assert.deepEqual(result,{sets:[]});assert.equal(f.calls,1);assert.deepEqual(f.sleeps,[]);assert.deepEqual(f.progress,[]);
  }
});
test('load, save, submit and unknown operation kinds cannot dispatch',async()=>{
  for(const kind of ['loadChallenge','saveChallenge','submitChallenge','GET','requestSets ','',undefined]) {
    const f=fixture({kind});await assert.rejects(Retry.read(f.options),/Only requestSets/);
    assert.equal(f.calls,0);assert.deepEqual(f.sleeps,[]);
  }
});
test('only a strict numeric first 429 retries once after sixty seconds in interruptible chunks',async()=>{
  const f=fixture(),request=f.options.request;let first=true;
  f.options.request=async()=>{const result=await request();if(first){first=false;throw limited();}return result;};
  assert.deepEqual(await Retry.read(f.options),{sets:[]});
  assert.equal(f.calls,2);assert.deepEqual(f.attemptTimes,[10000,70000]);
  assert.equal(f.sleeps.reduce((sum,ms)=>sum+ms,0),60000);
  assert.ok(f.sleeps.every(ms=>ms>0&&ms<=500));
  assert.equal(f.progress[0].remainingMs,60000);assert.equal(f.progress.at(-1).remainingMs,0);
  assert.ok(f.progress.every(event=>event.kind==='requestSets'&&event.attempt===2&&event.delayMs===60000));
});
test('positive Retry-After is respected exactly, including the five-minute boundary',async()=>{
  for(const seconds of [0.75,2,90,300]) {
    const f=fixture(),request=f.options.request;let first=true;
    f.options.request=async()=>{const result=await request();if(first){first=false;throw limited(seconds);}return result;};
    await Retry.read(f.options);
    assert.equal(f.calls,2);assert.equal(f.attemptTimes[1]-f.attemptTimes[0],seconds*1000);
    assert.ok(f.sleeps.every(ms=>ms>0&&ms<=500));
  }
});
test('long server delays halt instead of shortening the requested cooldown',async()=>{
  for(const seconds of [300.1,600,Infinity]) {
    const error=limited(seconds),f=fixture({request:async()=>{throw error;}});
    await assert.rejects(Retry.read(f.options),e=>e.status===429&&e.cause===error&&e.retryAfterSeconds===seconds);
    assert.deepEqual(f.sleeps,[]);assert.deepEqual(f.progress,[]);
  }
});
test('missing and malformed delay metadata use the documented local fallback',async()=>{
  for(const seconds of [undefined,null,0,-1,NaN,'5',true]) {
    const f=fixture(),request=f.options.request;let first=true;
    f.options.request=async()=>{const result=await request();if(first){first=false;throw limited(seconds);}return result;};
    await Retry.read(f.options);assert.equal(f.calls,2);assert.equal(f.attemptTimes[1]-f.attemptTimes[0],60000);
  }
});
test('401, 500, timeouts, string statuses and a second 429 propagate without further attempts',async()=>{
  for(const error of [Object.assign(new Error('EA 401'),{status:401}),Object.assign(new Error('EA 500'),{status:500}),
    new Error('Timeout'),Object.assign(new Error('not numeric'),{status:'429'})]) {
    let calls=0;const f=fixture({request:async()=>{calls++;throw error;}});
    await assert.rejects(Retry.read(f.options),e=>e===error);assert.equal(calls,1);assert.deepEqual(f.sleeps,[]);
  }
  let calls=0;const error=limited(1),f=fixture({request:async()=>{calls++;throw error;}});
  await assert.rejects(Retry.read(f.options),e=>e===error);assert.equal(calls,2);
  assert.equal(f.sleeps.reduce((sum,ms)=>sum+ms,0),1000);
});
test('guard failures before dispatch and during waiting stop immediately without becoming retries',async()=>{
  const stop=Object.assign(new Error('Stopped'),{status:429});
  const before=fixture({guard:()=>{throw stop;}});
  await assert.rejects(Retry.read(before.options),e=>e===stop);assert.equal(before.calls,0);assert.deepEqual(before.sleeps,[]);
  let stopped=false,calls=0;
  const waiting=fixture({request:async()=>{calls++;throw limited();},guard:async()=>{if(stopped)throw stop;}});
  const sleep=waiting.options.sleep;
  waiting.options.sleep=async ms=>{await sleep(ms);stopped=true;};
  await assert.rejects(Retry.read(waiting.options),e=>e===stop);assert.equal(calls,1);assert.deepEqual(waiting.sleeps,[500]);
});
test('stop on the final countdown prevents the second dispatch',async()=>{
  const stop=new Error('Stopped at deadline');let stopped=false,calls=0;
  const f=fixture({request:async()=>{calls++;throw limited(1);},guard:()=>{if(stopped)throw stop;},
    onWait:event=>{if(event.remainingMs===0)stopped=true;}});
  await assert.rejects(Retry.read(f.options),e=>e===stop);assert.equal(calls,1);
});
test('a stop while the first read is in flight rejects its eventual result',async()=>{
  const stop=new Error('Stopped'),f=fixture();let stopped=false;
  f.options.guard=()=>{if(stopped)throw stop;};
  f.options.request=async()=>{stopped=true;return {sets:[]};};
  await assert.rejects(Retry.read(f.options),e=>e===stop);assert.deepEqual(f.sleeps,[]);
});
test('progress, sleeper and invalid-clock errors never dispatch the second request',async()=>{
  for(const dependency of ['onWait','sleep','now']) {
    const failure=Object.assign(new Error(dependency+' failed'),{status:429});let calls=0;
    const f=fixture({request:async()=>{calls++;throw limited();}});
    f.options[dependency]=()=>{throw failure;};
    await assert.rejects(Retry.read(f.options),e=>e===failure);assert.equal(calls,1);
  }
  const f=fixture({request:async()=>{throw limited();},now:()=>NaN});
  await assert.rejects(Retry.read(f.options),/clock is unavailable/);assert.deepEqual(f.sleeps,[]);
});
test('invalid dependencies fail before the request and the browser UMD exports read',async()=>{
  for(const extra of [{guard:null},{request:null},{sleep:null},{now:null},{onWait:null}]) {
    const f=fixture(extra);await assert.rejects(Retry.read(f.options),/callbacks/);assert.equal(f.calls,0);
  }
  const context=vm.createContext({setTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/read-retry.js'),'utf8'),context);
  assert.equal(typeof context.AutoSBCReadRetry.read,'function');
});
