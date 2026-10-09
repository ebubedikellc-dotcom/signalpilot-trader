import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {riseStepExit} from '../lib/position-accounting.mjs';
import {createTradingJournal} from '../lib/trading-journal.mjs';

const p={verified:true,wallet:'wallet',profile:'safe',mint:'coin',cycle:'buy1',raw:'1000',cost:100};
const receipt=mark=>({...p,side:'sell',txid:`step${mark.step}`,raw:mark.raw,
  riseStep:{cycle:p.cycle,step:mark.step,triggerUnit:mark.triggerUnit}});

test('20% rise sells 30% of remaining coins at compounded price levels',()=>{
 assert.equal(riseStepExit(p,119.99).triggered,false);
 const first=riseStepExit(p,120);assert.equal(first.raw,'300');assert.equal(first.step,1);
 const remaining={...p,raw:'700',cost:70},fills=[receipt(first)];
 assert.equal(riseStepExit(remaining,84,fills).triggered,false);
 assert.equal(riseStepExit(remaining,100.799,fills).triggered,false);
 const second=riseStepExit(remaining,100.8,fills);
 assert.equal(second.raw,'210');assert.equal(second.step,2);assert.equal(second.triggerUnit,0.144);
 const last={...p,raw:'490',cost:49};fills.push(receipt(second));
 const third=riseStepExit(last,84.672,fills);
 assert.equal(third.raw,'147');assert.equal(third.step,3);
});
test('failed or unconfirmed attempts never advance, and a lower quote waits',()=>{
 const first=riseStepExit(p,120);
 assert.deepEqual(riseStepExit(p,120),first);
 assert.equal(riseStepExit(p,90).reason,null);
 assert.equal(riseStepExit(p,120).step,1);
});
test('trader partial sells do not advance the price step',()=>{
 const reduced={...p,raw:'500',cost:50};
 assert.equal(riseStepExit(reduced,59,[{...p,side:'sell',raw:'500'}]).triggered,false);
 assert.equal(riseStepExit(reduced,60,[]).raw,'150');
 const first=riseStepExit(p,120);
 assert.equal(riseStepExit(reduced,72,[receipt(first)]).raw,'150');
});
test('receipts are scoped to wallet, trader, coin, cycle and confirmed sells',()=>{
 const f=receipt(riseStepExit(p,120));
 for(const patch of [{wallet:'other'},{profile:'frog'},{mint:'other'},{side:'buy'},
   {riseStep:{...f.riseStep,cycle:'old'}},{riseStep:{...f.riseStep,step:NaN}},
   {riseStep:{...f.riseStep,triggerUnit:Infinity}}]) {
  assert.equal(riseStepExit(p,120,[{...f,...patch}]).step,1);
 }
 assert.equal(riseStepExit({...p,cycle:'buy2'},120,[f]).step,1);
});
test('a price gap processes each crossed level only after its confirmed sale',()=>{
 const first=riseStepExit(p,144);assert.equal(first.step,1);assert.equal(first.triggerUnit,.12);
 const second=riseStepExit({...p,raw:'700',cost:70},100.8,[receipt(first)]);
 assert.equal(second.step,2);assert.equal(second.raw,'210');
 assert.equal(riseStepExit({...p,raw:'490',cost:49},70.56,[receipt(first),receipt(second)]).triggered,false);
});
test('invalid prices, unverified cost and rounding dust cannot cause a full sale',()=>{
 for(const price of [0,-1,NaN,Infinity])assert.equal(riseStepExit(p,price),null);
 assert.equal(riseStepExit({...p,verified:false},120),null);
 assert.equal(riseStepExit({...p,cost:Infinity},120),null);
 assert.equal(riseStepExit({...p,cycle:undefined},120),null);
 const dust=riseStepExit({...p,raw:'3'},120);assert.equal(dust.dust,true);assert.equal(dust.raw,null);
 assert.equal(riseStepExit({...p,raw:'101'},120).raw,'30');
});
test('additional purchases update average entry before the first step',()=>{
 assert.equal(riseStepExit({...p,raw:'2000',cost:300},359).triggered,false);
 assert.equal(riseStepExit({...p,raw:'2000',cost:300},360).raw,'600');
});
test('a confirmed partial receipt survives journal restart and advances exactly once',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rise-step-'));const file=path.join(dir,'journal.json');
 try {
  const j=createTradingJournal(file,'USDC'),d=await j.load();
  d.fills.push({...p,side:'buy',txid:'buy1',usd:100,time:1000});
  const mark=riseStepExit(p,120);
  d.pending.sell1={...receipt(mark),txid:'sell1',submittedAt:1};await j.save();
  const balance=(mint,raw)=>({owner:p.wallet,mint,uiTokenAmount:{amount:raw}});
  await j.reconcile({getParsedTransaction:async()=>({blockTime:2,meta:{err:null,fee:5000,
    preTokenBalances:[balance('coin','1000'),balance('USDC','0')],
    postTokenBalances:[balance('coin','700'),balance('USDC','36000000')]}})});
  const restarted=createTradingJournal(file,'USDC'),loaded=await restarted.load(),report=await restarted.snapshot();
  const held=report.positions['wallet:safe:coin'];
  assert.equal(held.raw,'700');assert.equal(held.cost,70);
  assert.equal(loaded.fills.length,2);assert.equal(Object.keys(loaded.pending).length,0);
  assert.equal(riseStepExit(held,84,loaded.fills).triggered,false);
  assert.equal(riseStepExit(held,100.8,loaded.fills).step,2);
 } finally {await rm(dir,{recursive:true,force:true});}
});
