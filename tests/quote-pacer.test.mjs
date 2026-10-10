import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuotePacer} from '../lib/quote-pacer.mjs';
test('quota recovery spaces routes, promotes sells and defers background checks',async()=>{
 let now=1000,wake;const starts=[];
 const p=createQuotePacer({now:()=>now,sleep:async ms=>new Promise(resolve=>wake=()=>{now+=ms;resolve();})});
 p.slow('key',2000);
 const buy=p.acquire('key',{priority:50}).then(()=>starts.push(['buy',now]));
 const sell=p.acquire('key',{priority:100}).then(()=>starts.push(['sell',now]));
 await assert.rejects(p.acquire('key',{background:true}),/deferred/);
 await p.acquire('other');assert.equal(starts.length,0);
 wake();await sell;assert.deepEqual(starts,[['sell',2050]]);
 wake();await buy;assert.deepEqual(starts,[['sell',2050],['buy',3100]]);
});
test('healthy quote traffic is not paced until an actual rate limit is reported',async()=>{
 let sleeps=0;const p=createQuotePacer({sleep:async()=>sleeps++});
 await Promise.all([p.acquire('key'),p.acquire('key'),p.acquire('key',{background:true})]);assert.equal(sleeps,0);
});
test('every held coin can get a paced price check instead of starving after the first coin',async()=>{
 let now=1000;const p=createQuotePacer({now:()=>now,sleep:async ms=>{now+=ms;}});
 p.slow('key',2000);
 await p.acquire('key',{background:true});assert.equal(now,2050);
 await p.acquire('key',{background:true});assert.equal(now,3100);
});
