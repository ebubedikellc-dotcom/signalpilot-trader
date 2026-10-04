import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exitReason,buildPositions,sellFraction,proportionalAmount,dailyResults} from '../lib/position-accounting.mjs';
import {createTradingJournal} from '../lib/trading-journal.mjs';
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const section=(a,b)=>server.slice(server.indexOf(a),server.indexOf(b,server.indexOf(a)));
test('three modes have their agreed independent exits, scaling to smaller purchases',()=>{
 for(const cost of [10,20,30,50]){
  assert.equal(exitReason('limits',cost,cost*.7),'30% loss limit');
  assert.equal(exitReason('limits',cost,cost*1.6),'60% profit target');
  assert.equal(exitReason('loss',cost,cost*4),null);
  assert.equal(exitReason('loss',cost,cost*.7),'30% loss limit');
  assert.equal(exitReason('exact',cost,0),null);
  assert.equal(exitReason('limits',cost,NaN),null);
  assert.equal(exitReason('limits',cost,cost*.71),null);
 }
});
test('maximum is a ceiling, not a forced purchase amount; Exact Copy has no ceiling',()=>{
 let mode='limits';
 const c=vm.createContext({Number,Math,profileBuyMode:()=>mode,profileSurviveMaxUsd:()=>50});
 vm.runInContext(section('function buyUsdAmount(', 'function sourceUsdFromSignal('),c);
 assert.equal(c.buyUsdAmount({},'safe',20),20);assert.equal(c.buyUsdAmount({},'safe',200),50);
 mode='loss';assert.equal(c.buyUsdAmount({},'safe',200),50);
 mode='exact';assert.equal(c.buyUsdAmount({},'safe',200),200);
});
test('partial sale follows source fraction, including huge integer quantities',()=>{
 const b=(amount)=>({owner:'source',mint:'coin',uiTokenAmount:{amount}});
 const f=sellFraction({meta:{preTokenBalances:[b('100')],postTokenBalances:[b('75')]}},'source','coin');
 assert.deepEqual(f,{sold:'25',before:'100'});
 assert.equal(proportionalAmount('8000000000000000000',f),'2000000000000000000');
 assert.equal(sellFraction({meta:{err:'failed'}},'source','coin'),null);
});
test('cost follows remaining tokens after partial sales and is attributed to the original trader',()=>{
 const base={wallet:'w',profile:'safe',mint:'m'};
 const report=buildPositions([{...base,side:'buy',raw:'100',usd:50,time:1}, {...base,side:'sell',raw:'40',usd:30,time:2}]);
 const p=report.positions['w:safe:m'];assert.equal(p.raw,'60');assert.equal(p.cost,30);
 assert.equal(report.closed[0].pnl,10);
 assert.equal(exitReason('limits',p.cost,21),'30% loss limit');
 assert.equal(exitReason('limits',p.cost,48),'60% profit target');
});
test('sales with missing purchase history are not invented as profit',()=>{
 const r=buildPositions([{wallet:'w',profile:'safe',mint:'m',side:'sell',raw:'3',usd:10,time:1}]);
 assert.equal(r.closed.length,0);assert.equal(r.positions['w:safe:m'].verified,false);
});
test('daily accounting uses Lagos midnight, not browser or server timezone',()=>{
 const now=Date.parse('2026-10-04T00:10:00+01:00');
 const r=dailyResults([{time:Date.parse('2026-10-03T23:30:00Z'),pnl:8},{time:Date.parse('2026-10-03T22:30:00Z'),pnl:99}],now);
 assert.equal(r.gains,8);
});
function controls(){
 const state={settings:{modesConfirmed:'yes'},strategy:{activeProfile:'safe',controlRevision:1},profiles:{safe:{running:false},frog:{running:false},truenest:{running:false}}};let output;
 const c=vm.createContext({Date,Number,Boolean,Object,Math,structuredClone,supportedProfiles:['safe','frog','truenest'],readState:async()=>state,requireOwner:()=>false,sessionFromRequest:()=>({role:'owner'}),readBody:async r=>r.body||{},saveState:async()=>{},send:(_,code,body)=>{output={code,body}},statusPayload:s=>s,profileLabel:p=>p,strategyLossKey:p=>p+'Losses',line:x=>x,ready:()=>true,assertHeliusReadyForProfile:async()=>{},defaultState:{strategy:{}},beginTradingSession:()=>{},queueFailureSwitchLimit:()=>3,liveTradingAllowed:()=>false,withWalletOperation:f=>f(),emergencyStopRequested:false});
 vm.runInContext(section('async function handleApi(', 'function serveFile('),c);
 return {c,state,run:async(url,body)=>{await c.handleApi({method:'POST',body},{},{pathname:url});return output;}};
}
test('changing trader does not start trading; changing while running is rejected',async()=>{
 const h=controls();assert.equal((await h.run('/api/queue/switch',{profile:'frog'})).code,200);
 assert.equal(h.state.strategy.activeProfile,'frog');assert(Object.values(h.state.profiles).every(p=>!p.running));
 h.state.profiles.frog.running=true;assert.equal((await h.run('/api/queue/switch',{profile:'safe'})).code,409);assert.equal(h.state.strategy.activeProfile,'frog');
});
test('automatic switching and old start routes cannot bypass manual controls',async()=>{
 const h=controls();assert.equal((await h.run('/api/queue/automatic',{enabled:true})).code,410);
 assert.equal((await h.run('/api/start/frog')).code,410);
 h.state.settings.modesConfirmed='no';assert.equal((await h.run('/api/queue/start')).code,409);
});
test('Stop persists all profiles off and raises emergency intent',async()=>{
 const h=controls();Object.values(h.state.profiles).forEach(p=>p.running=true);
 assert.equal((await h.run('/api/queue/stop')).code,200);
 assert(Object.values(h.state.profiles).every(p=>!p.running));assert.equal(h.c.emergencyStopRequested,true);
});
test('journal only counts confirmed fills and survives a restart without duplicating them',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'signalpilot-test-'));try{
  const file=path.join(dir,'journal.json'),j=createTradingJournal(file,'USDC'),d=await j.load();
  d.pending.tx={wallet:'w',profile:'safe',mint:'coin',side:'buy',txid:'tx'};await j.save();
  await j.reconcile({getParsedTransaction:async()=>null});assert.equal((await j.load()).fills.length,0);
  const b=(mint,amount)=>({owner:'w',mint,uiTokenAmount:{amount}});
  const tx={blockTime:100,meta:{fee:5000,preTokenBalances:[b('USDC','100000000')],postTokenBalances:[b('USDC','50000000'),b('coin','999')]}};
  await j.reconcile({getParsedTransaction:async()=>tx});assert.equal((await j.snapshot()).positions['w:safe:coin'].cost,50);
  const reloaded=createTradingJournal(file,'USDC');await reloaded.reconcile({getParsedTransaction:async()=>tx});assert.equal((await reloaded.load()).fills.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
