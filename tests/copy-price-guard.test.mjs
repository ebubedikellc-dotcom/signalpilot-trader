import test from 'node:test';
import assert from 'node:assert/strict';
import {copyBuyPriceCheck} from '../lib/copy-price-guard.mjs';
const check=changes=>copyBuyPriceCheck({sourceRaw:'1050000',sourceUsd:5,inputRaw:'5000000',order:{inAmount:'5000000',outAmount:'1000000',slippageBps:0},...changes});
test('entry cost includes permitted slippage and the exact five percent boundary',()=>{
 assert.equal(check().allowed,true);
 assert.equal(check({order:{inAmount:'5000000',outAmount:'999999',slippageBps:0}}).allowed,false);
 assert.equal(check({order:{inAmount:'5000000',outAmount:'1050000',slippageBps:500}}).allowed,false);
 assert.equal(check({order:{inAmount:'5000000',outAmount:'1060000',otherAmountThreshold:'1000000'}}).allowed,true);
});
test('source and quote quantities are compared in raw units and scale with spend',()=>{
 assert.equal(check({inputRaw:'2500000',order:{inAmount:'2500000',outAmount:'500000',slippageBps:0}}).allowed,true);
 const r=copyBuyPriceCheck({sourceRaw:'96449438076795',sourceUsd:347.91,inputRaw:'5000000',order:{inAmount:'5000000',outAmount:'1151248173107',slippageBps:0}});
 assert.equal(r.allowed,false);assert(r.worseBps>2000);assert.match(r.message,/verified fill/);
});
test('unknown or invalid quote limits never authorize a purchase',()=>{
 for(const order of [
  {inAmount:'5000000',outAmount:'1000000'},
  {inAmount:'5000000',outAmount:'1000000',slippageBps:-1},
  {inAmount:'5000000',outAmount:'1000000',slippageBps:10000},
  {inAmount:'5000001',outAmount:'1000000',slippageBps:0},
  {inAmount:'5000000',outAmount:'0',slippageBps:0},
  {inAmount:'5000000',outAmount:'1000000',otherAmountThreshold:'1000001'}
 ])assert.equal(check({order}).allowed,false);
 for(const sourceUsd of [0,NaN,Infinity,-5])assert.equal(check({sourceUsd}).allowed,false);
 assert.equal(check({sourceRaw:'0'}).allowed,false);
});
