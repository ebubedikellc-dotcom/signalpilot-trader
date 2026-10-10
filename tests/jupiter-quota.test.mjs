import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createQuotePacer} from '../lib/quote-pacer.mjs';
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('const jupiterQuoteCooldowns ='),source.indexOf('async function tokenBalanceRaw('));
function harness(header='2') {
 let now=100000,calls=0,status=429;
 const context=vm.createContext({URL,AbortSignal,Map,Number,Math,JSON,Object,Error,createQuotePacer,
  Date:class extends Date {static now(){return now;}},
  setTimeout:(fn,ms)=>{now+=ms;fn();},fetch:async()=>{calls++;return {ok:status===200,status,headers:{get:()=>header},json:async()=>status===200?{status:'Success'}:{}};}});
 vm.runInContext(snippet,context);
 return {quote:(key,options={})=>context.jupiterJson('/swap/v2/order',{apiKey:key,...options}),build:key=>context.jupiterJson('/swap/v2/build',{apiKey:key}),execute:()=>context.jupiterJson('/swap/v2/execute',{method:'POST'}),calls:()=>calls,advance:ms=>now+=ms,success:()=>status=200};
}
test('429 is not burst-retried; other quote requests respect Retry-After and resume afterward',async()=>{
 const h=harness();await assert.rejects(h.quote(),/429/);assert.equal(h.calls(),1);
 await assert.rejects(h.quote(),/rate-limited/);assert.equal(h.calls(),1);
 h.advance(2000);h.success();await h.quote();assert.equal(h.calls(),2);
});
test('quote cooldown never blocks signed execution, and execution is never retried',async()=>{
 const h=harness();await assert.rejects(h.quote());await assert.rejects(h.execute());assert.equal(h.calls(),2);
 h.success();await h.execute();assert.equal(h.calls(),3);
});
test('cooldowns use HTTP dates and isolate distinct credentials',async()=>{
 const h=harness(new Date(103000).toUTCString());await assert.rejects(h.quote('a'));
 h.success();await h.quote('b');await assert.rejects(h.quote('a'),/rate-limited/);assert.equal(h.calls(),2);
 h.advance(3000);await h.quote('a');assert.equal(h.calls(),3);
});
test('missing or invalid Retry-After gets a bounded default cooldown',async()=>{
 for(const header of [null,'invalid','0','-1']) {
  const h=harness(header);await assert.rejects(h.quote());h.advance(999);
  await assert.rejects(h.quote(),/rate-limited/);assert.equal(h.calls(),1);
  h.advance(1);h.success();await h.quote();assert.equal(h.calls(),2);
 }
});
test('execute error retains its structured receipt without retrying the signed order',async()=>{
 for(const ok of [true,false]) {
  let calls=0;const payload={status:'Failed',code:-1000,errorMessage:'Slippage tolerance exceeded',signature:'2'.repeat(88)};
  const c=vm.createContext({URL,AbortSignal,Map,Number,Math,JSON,Object,Error,Date,setTimeout,createQuotePacer,fetch:async()=>{calls++;return {ok,status:ok?200:400,headers:{get:()=>null},json:async()=>payload};}});
  vm.runInContext(snippet,c);
  await assert.rejects(c.jupiterJson('/swap/v2/execute',{method:'POST'}),error=>error.executionResponse===payload);
  assert.equal(calls,1);
 }
});
test('background price checks back off longer after quota errors while real routes resume',async()=>{
 const h=harness('1');await assert.rejects(h.quote(),/429/);
 h.advance(1000);h.success();
 await assert.rejects(h.quote(undefined,{background:true}),/deferred/);assert.equal(h.calls(),1);
 await h.build();assert.equal(h.calls(),2);
 h.advance(1001);await h.quote(undefined,{background:true});assert.equal(h.calls(),3);
});
test('build and order share cooldown, but background work cannot hold up a live route',async()=>{
 const h=harness('2');await assert.rejects(h.quote(),/429/);
 await assert.rejects(h.build(),/rate-limited/);assert.equal(h.calls(),1);
 let release,calls=0;
 const c=vm.createContext({URL,AbortSignal,Map,Number,Math,JSON,Object,Error,Date,setTimeout,createQuotePacer,
  fetch:async()=>{calls++;await new Promise(resolve=>release=resolve);return {ok:true,status:200,json:async()=>({outAmount:'1'})};}});
 vm.runInContext(snippet,c);
 const live=c.jupiterJson('/swap/v2/order');
 await assert.rejects(c.jupiterJson('/swap/v2/order',{background:true}),/deferred/);assert.equal(calls,1);
 release();await live;
 await assert.rejects(c.jupiterJson('/swap/v2/order',{background:true}),/deferred/);assert.equal(calls,1);
 const anotherLive=c.jupiterJson('/swap/v2/order');await new Promise(setImmediate);assert.equal(calls,2);release();await anotherLive;
});
