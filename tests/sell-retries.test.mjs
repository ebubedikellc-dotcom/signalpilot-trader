import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function harness() {
  const data={pending:{},fills:[],notices:{},sourceSells:{}};
  const report={positions:{},pending:data.pending};
  const executions=[];
  const context=vm.createContext({Map,Date,BigInt,canonicalSignalId:s=>s,
    primarySwapLeg:t=>t.leg,tradeWallet:()=> 'wallet',
    executionJournal:{load:async()=>data,save:async()=>{},snapshot:async()=>report},
    executeCopiedSwap:async(profile,transaction)=>{executions.push(transaction.signature);return {status:'Submitted - confirmation pending'};}
  });
  vm.runInContext(server.slice(server.indexOf('const sourceSellQueue ='),server.indexOf('const sourceObservationQueue =')),context);
  const transaction={signature:'source-sell',leg:{action:'sell',inputMint:'COIN'}};
  const add=()=>context.queueSourceSell('safe',transaction,{});
  const run=()=>context.retrySourceSells({});
  const held=(cycle='purchase-1')=>{report.positions['wallet:safe:COIN']={raw:'100',verified:true,cycle};};
  return {data,report,executions,add,run,held};
}

test('old sells with no copied holding stop retrying without any provider or execution call',async()=>{
  const h=harness();await h.add();await h.run();
  assert.equal(Object.keys(h.data.sourceSells).length,0);
  assert.deepEqual(h.executions,[]);
  h.held('later-purchase');await h.run();
  assert.deepEqual(h.executions,[],'the retired sale cannot sell a later purchase');
});

test('a sell waits for an incoming copied buy and remains eligible after confirmation',async()=>{
  const h=harness();h.data.pending.buy={wallet:'wallet',profile:'safe',mint:'COIN',side:'buy',source:'source-buy'};
  await h.add();await h.run();
  assert.equal(Object.keys(h.data.sourceSells).length,1);
  assert.deepEqual(h.executions,[]);
  delete h.data.pending.buy;h.held();await h.run();
  assert.deepEqual(h.executions,['source-sell']);
  h.data.fills.push({source:'source-sell',side:'sell'});await h.run();
  assert.equal(Object.keys(h.data.sourceSells).length,0);
});

test('an uncertain holding stays queued for review without automatic submission',async()=>{
  const h=harness();h.report.positions['wallet:safe:COIN']={verified:false,raw:'0'};
  await h.add();await h.run();
  assert.equal(Object.keys(h.data.sourceSells).length,1);
  assert.match(h.data.notices['source-sell'],/review/);
  assert.deepEqual(h.executions,[]);
});

test('a queued sale is tied to its original purchase cycle',async()=>{
  const h=harness();h.held();await h.add();h.held('new-purchase');await h.run();
  assert.equal(Object.keys(h.data.sourceSells).length,0);
  assert.deepEqual(h.executions,[]);
});

test('an empty old position does not bind a sell waiting for a new buy to its old cycle',async()=>{
  const h=harness();h.held('old-purchase');h.report.positions['wallet:safe:COIN'].raw='0';
  h.data.pending.buy={wallet:'wallet',profile:'safe',mint:'COIN',side:'buy'};
  await h.add();await h.run();delete h.data.pending.buy;h.held('new-purchase');await h.run();
  assert.deepEqual(h.executions,['source-sell']);
});
