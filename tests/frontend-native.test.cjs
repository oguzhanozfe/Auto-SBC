const {test}=require('node:test');
const assert=require('node:assert/strict');
const Native=require('../frontend/native-entry.js');

class Node {
  constructor(tag, connected=false){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this._connected=connected;this.disabled=false;}
  get isConnected(){return this._connected||Boolean(this.parentNode?.isConnected);}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  get previousSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)-1]||null;}
  insertBefore(node,reference){
    if(node.id===Native.BUTTON_ID)assert.equal(node.listeners.click?.length,1,'handler must be bound before insertion');
    node.remove();const index=reference?this.children.indexOf(reference):this.children.length;
    this.children.splice(index<0?this.children.length:index,0,node);node.parentNode=this;
  }
  append(node){this.insertBefore(node,null);}
  remove(){if(this.parentNode){const list=this.parentNode.children;list.splice(list.indexOf(this),1);this.parentNode=null;}}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(name,handler){(this.listeners[name]||=[]).push(handler);}
  async click(){if(!this.disabled)for(const handler of this.listeners.click||[])await handler({preventDefault(){}});}
}
function fixture(){
  const root=new Node('root',true),exchange=new Node('button');root.append(exchange);
  const returns={native:true},calls=[],navigations=[];let context=null,backend=false,scheduler,installedPrototype;
  const original=function(...args){calls.push({owner:this,args});return returns;};
  const proto={init:original};installedPrototype=proto;
  const panel=Object.create(proto);panel._btnExchange={__root:exchange};
  const document={createElement:tag=>new Node(tag)};
  let solve=async()=>{};
  const controller=Native.install({document,getPrototype:()=>installedPrototype,resolveContext:()=>context,
    getGate:()=>({ready:backend,reason:'backend or scope not ready'}),onSolveCurrent:value=>solve(value),
    onContextChanged:(old,next)=>navigations.push([old,next]),schedule:tick=>{scheduler=tick;return()=>{scheduler=null;};}});
  const button=()=>root.children.find(node=>node.id===Native.BUTTON_ID);
  return {root,exchange,panel,proto,original,returns,calls,navigations,controller,button,
    tick:()=>scheduler?.(),setContext:value=>{context=value;},setBackend:value=>{backend=value;},setSolve:value=>{solve=value;},
    setPrototype:value=>{installedPrototype=value;}};
}
test('native init preserves return value, this and args; mount has one bound handler',async()=>{
  const f=fixture();assert.equal(f.panel.init('abc',123),f.returns);
  assert.equal(f.calls[0].owner,f.panel);assert.deepEqual(f.calls[0].args,['abc',123]);
  assert.equal(f.button().id,'autosbc-native-solve');assert.equal(f.button().disabled,true);
  assert.equal(f.button().previousSibling,f.exchange);
  f.panel.init('again');assert.equal(f.root.children.filter(node=>node.id===Native.BUTTON_ID).length,1);
  assert.equal(f.button().listeners.click.length,1);f.controller.dispose();assert.equal(f.proto.init,f.original);
});
test('rapid click cannot solve before current challenge and scoped backend are stable',async()=>{
  const f=fixture();let calls=0;f.setSolve(async()=>calls++);f.panel.init();await f.button().click();assert.equal(calls,0);
  f.setContext({setId:20,challengeId:10});f.tick();f.tick();await f.button().click();assert.equal(calls,0);
  f.setBackend(true);f.tick();assert.equal(f.button().disabled,false);await f.button().click();assert.equal(calls,1);
  f.controller.dispose();
});
test('challenge needs two observations and is read again on click',async()=>{
  const f=fixture();let calls=0;f.setSolve(async()=>calls++);f.setBackend(true);f.setContext({setId:20,challengeId:10});f.panel.init();
  f.tick();assert.equal(f.button().disabled,true);f.tick();assert.equal(f.button().disabled,false);
  f.setContext({setId:20,challengeId:11});await f.button().click();assert.equal(calls,0);
  assert.equal(f.button().disabled,true);f.tick();await f.button().click();assert.equal(calls,1);f.controller.dispose();
});
test('navigation while solving notifies cancellation and detached panel never enables',async()=>{
  const f=fixture();let release;f.setSolve(()=>new Promise(resolve=>{release=resolve;}));f.setBackend(true);
  f.setContext({setId:20,challengeId:10});f.panel.init();f.tick();f.tick();const pending=f.button().click();
  f.setContext({setId:20,challengeId:11});f.tick();assert.deepEqual(f.navigations,[['20:10','20:11']]);
  f.exchange.remove();f.tick();assert.equal(f.button().disabled,true);release();await pending;f.controller.dispose();
});
test('late-created native anchor is mounted when ready; our cleanup preserves later wrappers',()=>{
  const f=fixture();delete f.panel._btnExchange;f.panel.init();assert.equal(f.button(),undefined);
  f.panel._btnExchange={__root:f.exchange};f.tick();assert.ok(f.button());
  const later=function(){};f.proto.init=later;f.controller.dispose();assert.equal(f.proto.init,later);
});
