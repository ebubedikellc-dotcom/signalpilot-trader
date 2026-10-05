import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('const jupiterQuoteCooldowns ='),source.indexOf('async function tokenBalanceRaw('));
function harness(header='2') {
 let now=100000,calls=0,status=429;
 const context=vm.createContext({URL,AbortSignal,Map,Number,Math,JSON,Object,Error,
  Date:class extends Date {static now(){return now;}},
  setTimeout:fn=>fn(),fetch:async()=>{calls++;return {ok:status===200,status,headers:{get:()=>header},json:async()=>status===200?{status:'Success'}:{}};}});
 vm.runInContext(snippet,context);
 return {quote:key=>context.jupiterJson('/swap/v2/order',{apiKey:key}),execute:()=>context.jupiterJson('/swap/v2/execute',{method:'POST'}),calls:()=>calls,advance:ms=>now+=ms,success:()=>status=200};
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
