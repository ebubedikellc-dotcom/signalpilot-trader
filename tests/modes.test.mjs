import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exitReason,takeBackExit,profitLadderExit,buildPositions,sellFraction,proportionalAmount,dailyResults} from '../lib/position-accounting.mjs';
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
test('take my money back sells part after a strong gain and protects the rest',()=>{
 const p={verified:true,raw:'1000000',cost:50,cycle:'buy1'};
 const mark=takeBackExit(p,80);
 assert.equal(mark.reason,'Take my money back');
 assert.equal(mark.partial,true);
 assert(mark.raw !== p.raw);
 assert(BigInt(mark.raw)>0n);
 const watch=takeBackExit({...p,raw:'375000',cost:18.75},35,mark);
 assert.equal(watch.reason,null);
 assert.equal(Math.round(watch.trigger*100)/100,24.5);
 const exit=takeBackExit({...p,raw:'375000',cost:18.75},24.5,watch);
 assert.equal(exit.reason,'Take My Money Back protection');
 assert.equal(exit.raw,'375000');
 assert.equal(takeBackExit(p,35).reason,'30% loss limit');
});
test('profit ladder takes repeated profit and guards the remaining position',()=>{
 const p={verified:true,raw:'1000000',cost:100,cycle:'buy1'};
 const wait=profitLadderExit(p,119);
 assert.equal(wait.reason,null);
 assert.equal(wait.triggered,false);
 const first=profitLadderExit(p,120,wait);
 assert.equal(first.reason,'20% profit ladder');
 assert.equal(first.partial,true);
 assert(BigInt(first.raw)>0n);
 assert(BigInt(first.raw)<BigInt(p.raw));
 assert.equal(Math.round(first.baselineUnit*1e6),120);
 const retry=profitLadderExit(p,120,first);
 assert.equal(retry.reason,'20% profit ladder');
 assert.equal(retry.raw,first.raw);
 const remaining={...p,raw:'833333',cost:83.33};
 const afterSale=profitLadderExit(remaining,100,first);
 assert.equal(afterSale.reason,null);
 const second=profitLadderExit(remaining,120,afterSale);
 assert.equal(second.reason,'20% profit ladder');
 assert.equal(second.partial,true);
 const afterSecondSale={...p,raw:'578703',cost:57.86};
 const protectedExit=profitLadderExit(afterSecondSale,74,second);
 assert.equal(protectedExit.reason,'5% profit guard');
 assert.equal(protectedExit.raw,afterSecondSale.raw);
 assert.equal(profitLadderExit(p,95).reason,'5% loss guard');
});
test('maximum is a ceiling for every mode, including Exact Copy, without forcing smaller buys upward',()=>{
 let mode='limits';
 const c=vm.createContext({Number,Math,profileBuyMode:()=>mode,profileSurviveMaxUsd:()=>50});
 vm.runInContext(section('function buyUsdAmount(', 'function sourceUsdFromSignal('),c);
 assert.equal(c.buyUsdAmount({},'safe',20),20);assert.equal(c.buyUsdAmount({},'safe',200),50);
 mode='loss';assert.equal(c.buyUsdAmount({},'safe',200),50);
 mode='takeback';assert.equal(c.buyUsdAmount({},'safe',200),50);
 mode='exact';assert.equal(c.buyUsdAmount({},'safe',200),50);
 mode='ladder';assert.equal(c.buyUsdAmount({},'safe',3),50);assert.equal(c.buyUsdAmount({},'safe',200),50);
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

test('GMGN repair hold rejects Start even when mode and keys are ready',async()=>{
 const h=controls();h.state.settings.providerRepairHold=true;
 const result=await h.run('/api/queue/start');assert.equal(result.code,409);assert.match(result.body.error,/GMGN/);
 assert(Object.values(h.state.profiles).every(p=>!p.running));
});

test('5% ladder loss guard triggers at the boundary and sells the entire remaining holding',()=>{
 const p={verified:true,raw:'1000000',cost:5,cycle:'buy-five'};
 assert.equal(profitLadderExit(p,4.75001).triggered,false);
 for(const quote of [4.75,4.74,4]) {
  const exit=profitLadderExit(p,quote);
  assert.equal(exit.reason,'5% loss guard');assert.equal(exit.raw,p.raw);assert.equal(exit.partial,false);
 }
 assert.equal(profitLadderExit(p,6).reason,'20% profit ladder');
 assert.equal(profitLadderExit(p,NaN),null);
});
test('5% guard protects the latest profit ladder level after a partial sale',()=>{
 const p={verified:true,raw:'1000000',cost:5,cycle:'profit-five'};
 const mark=profitLadderExit(p,6);
 const remaining={...p,raw:'833333',cost:5*833333/1000000};
 const trigger=mark.baselineUnit*Number(remaining.raw)*0.95;
 assert.equal(profitLadderExit(remaining,trigger+0.00001,mark).triggered,false);
 const exit=profitLadderExit(remaining,trigger,mark);
 assert.equal(exit.reason,'5% profit guard');assert.equal(exit.raw,remaining.raw);assert.equal(exit.partial,false);
});
