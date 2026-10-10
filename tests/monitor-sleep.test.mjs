import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonitorSleep} from '../lib/monitor-sleep.mjs';

function harness() {
  let at=1000000;
  const sleep=createMonitorSleep({now:()=>at});
  const context={report:{positions:{},pending:{}},listenerReady:true};
  return {sleep,context,advance:ms=>at+=ms,status:()=>sleep.status(context),now:()=>at};
}
test('idle flat wallet sleeps, keeps recovery, and verified activity wakes it immediately',()=>{
  const h=harness();assert.equal(h.status().sleeping,false);
  h.advance(120000);assert.equal(h.status().sleeping,true);
  assert.equal(h.status().walletRefreshMs,60000);assert.equal(h.status().recoveryPollMs,30000);
  h.sleep.observeTrade();assert.equal(h.status().sleeping,false);
  assert.equal(h.status().walletRefreshMs,null);assert.equal(h.status().recoveryPollMs,500);
});
test('open holdings, pending transactions, queued exits and closing growth plans cannot sleep',()=>{
  for(const report of [null,{positions:{p:{raw:'1'}}},{pending:{p:{side:'buy'}}},
    {pendingSells:[{profile:'frog'}]},{growth:{status:'closing'}}]) {
    const h=harness();h.advance(120000);h.context.report=report;
    assert.equal(h.status().sleeping,false);
  }
});
test('disconnected subscriptions and transaction lookups retain active checks',()=>{
  const h=harness();h.advance(120000);
  h.context.listenerReady=false;assert.equal(h.status().sleeping,false);
  h.context.listenerReady=true;h.context.queuedReads=true;assert.equal(h.status().sleeping,false);
  h.context.queuedReads=false;assert.equal(h.status().sleeping,true);
});
test('retained review-only sell history can sleep while actual holdings still keep it awake',()=>{
  const h=harness();h.advance(120000);
  h.context.report.pendingSells=[{requiresActiveChecks:false,message:'Review retained history'}];
  assert.equal(h.status().sleeping,true);
  h.context.report.positions={p:{raw:'1',verified:false}};
  assert.equal(h.status().sleeping,false);
});
test('old recovery history and invalid future timestamps do not repeatedly wake the bot',()=>{
  const h=harness();const old=h.now();h.advance(120000);
  for(const at of [old-1000,old,NaN,Infinity,h.now()+1000])h.sleep.observeTrade(at);
  assert.equal(h.status().sleeping,true);
  h.sleep.observeTrade(h.now()-1000);assert.equal(h.status().sleeping,false);
});
