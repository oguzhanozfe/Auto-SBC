const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../frontend/extension-transport.js');
const read = name => fs.readFileSync(path.join(__dirname, '../frontend/', name), 'utf8');
const TOKEN = 'x'.repeat(48);
const hosted = overrides => ({mode:'hosted',origin:'https://solver.example',token:TOKEN,consent:true,revision:'configured-v1',...overrides});
const sender = {id:'extension-id',frameId:0,tab:{id:1,url:'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/'},url:'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/'};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('fresh installations remain local and public server info never includes token', () => {
  assert.deepEqual(T.config(),{mode:'local',origin:T.LOCAL,revision:'local-default-v1'});
  const info = T.info(hosted());
  assert.deepEqual(info,{mode:'hosted',origin:'https://solver.example',configured:true,revision:'configured-v1'});
  assert.ok(!JSON.stringify(info).includes(TOKEN));
  assert.equal(T.config({mode:'local',origin:T.LOCAL,revision:'local-v2',token:TOKEN}).token,undefined);
});
for (const origin of ['http://solver.example','https://user:secret@solver.example','https://solver.example/api','https://solver.example/?token=x','https://solver.example/#x','https://solver.example:8443','https://*.example','file:///tmp/solver']) {
  test(`hosted configuration rejects unsafe/non-origin address ${origin}`, () => assert.throws(() => T.config(hosted({origin}))));
}
test('hosted configuration requires consent and strong URL-safe token; corruption cannot fall back to local', () => {
  for (const value of [null,{},hosted({consent:false}),hosted({token:'short'}),hosted({token:'x'.repeat(33)+'\n'}),hosted({revision:undefined})]) assert.throws(() => T.config(value));
  assert.equal(T.httpsOrigin(' HTTPS://SOLVER.EXAMPLE:443/ '),'https://solver.example');
});
test('sender must be this extension in the top-level EA Web App, never other EA pages or lookalikes', () => {
  assert.equal(T.eaSender(sender,'extension-id'),true);
  assert.equal(T.eaSender({...sender,url:'https://www.ea.com/en-gb/ea-sports-fc/ultimate-team/web-app/'},'extension-id'),true);
  for (const patch of [{id:'other-extension'},{frameId:2},{tab:null},{url:'https://www.ea.com/'},{url:'https://www.ea.com.evil.test/ea-sports-fc/ultimate-team/web-app/'},{url:'http://www.ea.com/ea-sports-fc/ultimate-team/web-app/'}]) assert.equal(T.eaSender({...sender,...patch},'extension-id'),false);
});
test('request is pinned, uses only configured origin, omits cookies and fails on redirects', () => {
  const request=T.request(hosted(),{revision:'configured-v1',path:'/api/solve/jobs',method:'POST',data:{clubPlayers:[{id:1}]}});
  assert.equal(request.url,'https://solver.example/api/solve/jobs');
  assert.equal(request.options.headers.Authorization,`Bearer ${TOKEN}`);
  assert.equal(request.options.credentials,'omit'); assert.equal(request.options.redirect,'error'); assert.equal(request.options.cache,'no-store');
  assert.deepEqual(JSON.parse(request.options.body),{clubPlayers:[{id:1}]});
  assert.throws(()=>T.request(hosted({revision:'v2'}),{revision:'configured-v1',path:'/api/solve/jobs',method:'POST',data:{}}),/settings changed/);
  const local=T.request(undefined,{revision:'local-default-v1',path:'/health?gameYear=26&platform=ps5',method:'GET'});
  assert.equal(local.url,T.LOCAL+'/health?gameYear=26&platform=ps5'); assert.equal(local.options.headers.Authorization,undefined);
});
test('endpoint allowlist rejects arbitrary routes, absolute targets, unexpected query and GET bodies', () => {
  for (const message of [{path:'https://evil.example/health',method:'GET'},{path:'//evil.example/health',method:'GET'},{path:'/\\evil.example/health',method:'GET'},
    {path:'/api/solve',method:'POST'},{path:'/api/catalog/sync',method:'POST'},{path:'/api/solve/jobs',method:'DELETE'},
    {path:'/health?secret=x',method:'GET'},{path:'/api/solve/jobs/123?token=x',method:'GET'},{path:'/health',method:'GET',data:{clubPlayers:[]}}]) {
    assert.throws(()=>T.request(hosted(),{revision:'configured-v1',...message}),/endpoint|club data/);
  }
  assert.equal(T.request(hosted(),{revision:'configured-v1',path:'/api/solve/jobs/abc-123',method:'GET'}).url,'https://solver.example/api/solve/jobs/abc-123');
});

function workerHarness(initial, overrides={}) {
  let stored=initial, listener, access;
  const calls=[],permissions=[];
  const context=vm.createContext({AutoSBCTransport:T,importScripts:name=>assert.equal(name,'transport.js'),AbortController,setTimeout,clearTimeout,URL,
    chrome:{runtime:{id:'extension-id',onMessage:{addListener:fn=>listener=fn},openOptionsPage:async()=>{}},action:{onClicked:{addListener(){}}},
      storage:{local:{setAccessLevel:async value=>{access=value;},get:async()=>stored===undefined?{}:{[T.STORAGE_KEY]:stored}}},
      permissions:{contains:async value=>{permissions.push(value);return overrides.permission!==false;}}},
    fetch:async(...args)=>{calls.push(args);if(overrides.fetch) return overrides.fetch(...args);return {ok:true,status:200,text:async()=>'{"status":"ok"}'};}});
  vm.runInContext(read('extension-worker.js'),context);
  return {calls,permissions,get access(){return access;},set:value=>{stored=value;},send:(message,from=sender)=>new Promise(resolve=>{if(!listener(message,from,resolve))resolve(undefined);})};
}
test('worker restricts storage before reads and keeps secret out of info/network metadata',async()=>{
  const h=workerHarness(hosted());
  const info=await h.send({type:'autosbc-server-info'});
  assert.equal(h.access.accessLevel,'TRUSTED_CONTEXTS');assert.equal(info.origin,'https://solver.example');assert.ok(!JSON.stringify(info).includes(TOKEN));
  const response=await h.send({type:'autosbc-local-http',revision:info.revision,path:'/health',method:'GET'});
  assert.equal(response.serverOrigin,'https://solver.example');assert.ok(!JSON.stringify(response).includes(TOKEN));
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].headers.Authorization,`Bearer ${TOKEN}`);
  assert.equal(h.permissions[0].origins.length,1);assert.equal(h.permissions[0].origins[0],'https://solver.example/*');
});
test('worker denies revoked permissions and changed revision before fetch; unauthenticated senders cannot query settings',async()=>{
  const denied=workerHarness(hosted(),{permission:false});
  assert.match((await denied.send({type:'autosbc-local-http',revision:'configured-v1',path:'/api/solve/jobs',method:'POST',data:{}})).error,/permission/);
  assert.equal(denied.calls.length,0);
  const changed=workerHarness(hosted({revision:'new-revision'}));
  assert.match((await changed.send({type:'autosbc-local-http',revision:'configured-v1',path:'/api/solve/jobs',method:'POST',data:{}})).error,/settings changed/);
  assert.equal(changed.calls.length,0);
  assert.equal(await changed.send({type:'autosbc-server-info'},{...sender,id:'untrusted'}),undefined);
});
test('failed fetch/redirect is returned once with no automatic retry or bearer disclosure',async()=>{
  const h=workerHarness(hosted(),{fetch:async()=>{throw new TypeError('redirect includes '+TOKEN);}});
  const response=await h.send({type:'autosbc-local-http',revision:'configured-v1',path:'/api/solve/jobs',method:'POST',data:{}});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].redirect,'error');assert.match(response.error,/Redirects are not followed/);assert.ok(!JSON.stringify(response).includes(TOKEN));
});
test('local worker retains localhost compatibility and adds destination metadata',async()=>{
  const h=workerHarness();
  const response=await h.send({type:'autosbc-local-http',revision:'local-default-v1',path:'/health',method:'GET'});
  assert.equal(response.serverOrigin,T.LOCAL);assert.equal(h.calls[0][1].headers.Authorization,undefined);assert.equal(h.permissions.length,0);
});

test('bridge pins revision, rejects stale info, and never forwards page-supplied origin/token/revision',async()=>{
  let listen, revision='configured-v1';const calls=[],posted=[];
  const window={addEventListener:(name,fn)=>{listen=fn;},postMessage:message=>posted.push(message)};
  const context=vm.createContext({window,location:{origin:'https://www.ea.com'},chrome:{runtime:{sendMessage:async message=>{
    calls.push(message);
    if(message.type==='autosbc-server-info')return T.info(hosted({revision}));
    if(message.type==='autosbc-local-http')return message.revision===revision?{ok:true,serverOrigin:'https://solver.example',body:{}}:{error:'Server settings changed'};
    return {ok:true};
  }}}});
  vm.runInContext(read('extension-bridge.js'),context);await tick();
  await listen({source:window,origin:'https://www.ea.com',data:{source:'autosbc-local-request',id:'1',path:'/api/solve/jobs',method:'POST',data:{},origin:'https://evil.example',token:'evil',revision:'evil'}});
  const request=calls.find(row=>row.type==='autosbc-local-http');assert.equal(request.revision,'configured-v1');assert.equal(request.token,undefined);assert.equal(request.origin,undefined);
  revision='new-revision';
  await listen({source:window,origin:'https://www.ea.com',data:{source:'autosbc-server-info-request',id:'2'}});
  assert.match(posted.at(-1).error,/reload the EA tab/);
  await listen({source:window,origin:'https://www.ea.com',data:{source:'autosbc-local-request',id:'3',path:'/health',method:'GET'}});
  assert.match(posted.at(-1).error,/settings changed/);
  assert.ok(!JSON.stringify(posted).includes(TOKEN));
});

function optionsHarness(initial,{permission=true}={}) {
  const elements=new Map();let stored=initial;const writes=[],permissions=[],order=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='mode'?'local':'',checked:false,disabled:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return elements.get(id);};
  const context=vm.createContext({AutoSBCTransport:T,crypto:{randomUUID:()=> 'new-config-revision'},document:{getElementById:element},
    chrome:{storage:{local:{setAccessLevel:async()=>{},get:async()=>stored===undefined?{}:{[T.STORAGE_KEY]:stored},set:async value=>{order.push('store');writes.push(value);stored=value[T.STORAGE_KEY];}}},
      permissions:{request:async value=>{order.push('permission');permissions.push(value);return permission;}}}});
  vm.runInContext(read('extension-options.js'),context);
  return {element,writes,permissions,order,submit:()=>element('settings').listeners.submit({preventDefault(){}})};
}
test('options require deliberate consent and exact runtime permission before saving hosted token',async()=>{
  const h=optionsHarness();await tick();
  h.element('mode').value='hosted';h.element('origin').value='https://solver.example';h.element('token').value=TOKEN;
  await h.submit();assert.equal(h.writes.length,0);assert.equal(h.permissions.length,0);
  h.element('consent').checked=true;await h.submit();
  assert.deepEqual(h.order,['permission','store']);assert.equal(h.permissions[0].origins[0],'https://solver.example/*');
  assert.equal(h.writes[0][T.STORAGE_KEY].token,TOKEN);assert.equal(h.element('token').value,'');
  assert.match(h.element('status').textContent,/Reload the EA tab/);
});
test('permission denial preserves previous configuration; local save clears the stored token',async()=>{
  const denied=optionsHarness(undefined,{permission:false});await tick();
  denied.element('mode').value='hosted';denied.element('origin').value='https://solver.example';denied.element('token').value=TOKEN;denied.element('consent').checked=true;
  await denied.submit();assert.equal(denied.writes.length,0);assert.match(denied.element('status').textContent,/previous destination is unchanged/);
  const local=optionsHarness(hosted());await tick();assert.equal(local.element('token').value,'');
  local.element('mode').value='local';await local.submit();
  assert.equal(local.writes[0][T.STORAGE_KEY].mode,'local');assert.equal(local.writes[0][T.STORAGE_KEY].token,undefined);assert.equal(local.permissions.length,0);
});
test('editing a hosted destination clears consent and only a validated origin is displayed',async()=>{
  const h=optionsHarness(hosted());await tick();h.element('consent').checked=true;
  h.element('origin').value='https://new.example';h.element('origin').listeners.input();
  assert.equal(h.element('consent').checked,false);assert.equal(h.element('destination').textContent,'https://new.example');
});
