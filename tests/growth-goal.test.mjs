import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {growthSnapshot,growthTradeable,growthTransition,validateGrowthSettings} from '../lib/growth-goal.mjs';
import {createTradingJournal} from '../lib/trading-journal.mjs';
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const section=(a,b)=>server.slice(server.indexOf(a),server.indexOf(b,server.indexOf(a)));
const goal=()=>({id:'g1',wallet:'w',principal:100,target:200,excludedCash:79,status:'active'});
const journal=()=>({growthGoal:goal(),fills:[],pending:{},charges:[]});
const fill=(side,usd,other={})=>({goalId:'g1',wallet:'w',profile:'safe',mint:'coin',raw:'100',side,usd,feeUsd:0,time:side==='buy'?1:2,...other});

test('100 to 200 budget compounds confirmed profits and subtracts losses and costs',()=>{
 const d=journal();d.fills=[fill('buy',20),fill('sell',30,{feeUsd:0.05})];
 let s=growthSnapshot(d);assert.equal(s.availableUsd,109.95);assert.equal(s.realizedProfitUsd,9.95);
 assert.equal(growthTradeable(s,189,35),109.95);
 d.fills.push(fill('buy',20,{time:3}),fill('sell',10,{time:4}));
 s=growthSnapshot(d);assert.equal(s.availableUsd,99.95);assert.equal(s.targetReached,false);
});
test('unrelated deposits, old fills and existing locked money never count toward the goal',()=>{
 const d=journal();d.fills=[fill('buy',100,{goalId:'old'}),fill('sell',10000,{goalId:'old'})];
 const s=growthSnapshot(d);assert.equal(s.cashUsd,100);assert.equal(growthTradeable(s,10000,35),100);
 assert.equal(growthTradeable(s,90,35),11);assert.equal(growthTradeable(s,179,100),79);
 assert.equal(s.targetReached,false);
});
test('pending buys reserve funds; pending sales never count as profit or permit new buys',()=>{
 const d=journal();d.pending.buy={goalId:'g1',side:'buy',reservedUsd:80};
 assert.equal(growthSnapshot(d).availableUsd,20);
 d.pending.sell={goalId:'g1',side:'sell'};
 assert.equal(growthSnapshot(d).availableUsd,0);assert.equal(growthSnapshot(d).targetReached,false);
 delete d.pending.sell;delete d.pending.buy.reservedUsd;
 assert.equal(growthSnapshot(d).availableUsd,0);
});
test('partial sales retain cost and target liquidation waits for all confirmations',()=>{
 const d=journal();d.fills=[fill('buy',100),fill('sell',100,{raw:'50'})];
 let s=growthSnapshot(d);assert.equal(s.positions[0].raw,'50');assert.equal(s.openCostUsd,50);
 assert.equal(growthTransition(s,100),'closing');assert.equal(s.targetReached,false);
 d.growthGoal.status='closing';assert.equal(growthSnapshot(d).availableUsd,0);
 d.pending.sell={goalId:'g1',side:'sell'};assert.equal(growthTransition(growthSnapshot(d),200),'closing');
 delete d.pending.sell;d.fills.push(fill('sell',101,{raw:'50',time:3,feeUsd:1}));
 s=growthSnapshot(d);assert.equal(s.netCashUsd,200);assert.equal(s.targetReached,true);
 assert.equal(s.availableUsd,0);assert.equal(growthTransition(s),'completed');
});
test('a sale below target because of fees or slippage resumes the same goal',()=>{
 const d=journal();d.growthGoal.status='closing';
 d.fills=[fill('buy',100),fill('sell',200,{feeUsd:0.01})];
 let s=growthSnapshot(d);assert.equal(s.netCashUsd,199.99);assert.equal(s.targetReached,false);
 assert.equal(growthTransition(s),'active');d.growthGoal.status='active';assert.equal(growthSnapshot(d).availableUsd,199.99);
 d.charges.push({goalId:'g1',wallet:'w',feeUsd:1});assert.equal(growthSnapshot(d).availableUsd,198.99);
});
test('missing fee prices and missing purchase history fail closed',()=>{
 const d=journal();d.fills=[fill('buy',100),fill('sell',201,{feeUsd:undefined})];
 let s=growthSnapshot(d);assert.equal(s.netCashUsd,null);assert.equal(s.availableUsd,0);assert.equal(s.targetReached,false);
 d.fills=[fill('sell',500)];s=growthSnapshot(d);assert.equal(s.verified,false);assert.equal(s.availableUsd,0);assert.equal(s.targetReached,false);
});
test('bad targets are rejected; 100 to 200 and custom 100 to 500 are accepted',()=>{
 for(const args of [['bad',100,200],['target',0,200],['target',100,100],['target',100,99],['target',NaN,200],['target',100,Infinity]]) assert.throws(()=>validateGrowthSettings(...args));
 validateGrowthSettings('target',100,200);validateGrowthSettings('target',100,500);validateGrowthSettings('save',0,0);
});

function harness(d=journal()) {
 let cash=279,saves=0;
 const state={settings:{profitMode:'target',growthPrincipal:'100',growthTarget:'200'},strategy:{controlRevision:1},profiles:{safe:{running:true}},activity:[]};
 const reserves={w:{lockedUsd:35,history:[]}};
 const c=vm.createContext({growthSnapshot,growthTradeable,growthTransition,validateGrowthSettings,Date,Number,Math,BigInt,Object,
  readState:async()=>state,readBody:async r=>r.body,requireOwner:()=>false,sessionFromRequest:()=>({role:'owner'}),
  supportedProfiles:['safe'],emergencyStopRequested:false,executionReport:{},executionJournal:{load:async()=>d,save:async()=>{saves++;},snapshot:async()=>({pending:{},positions:{}})},
  readProfitReserves:async()=>reserves,saveProfitReserves:async()=>{},saveState:async()=>{},line:x=>x,
  coinMarket:async()=>({priceUsd:100}),solMint:'SOL',usdcMint:'USDC',solanaConnection:()=>({}),tokenUiBalance:async()=>cash,
  jupiterJson:async()=>({inAmount:'100',outAmount:'200000000'}),jupiterApiKey:()=>'',
  tradeWallet:()=> 'w',refreshExecutionReport:async()=>{},protectProfit:async()=>35,randomUUID:()=> 'new-id',
  withWalletOperation:f=>f(),statusPayload:s=>s,send:(_,code,body)=>{c.output={code,body}}});
 vm.runInContext(section('async function assertNoOpenGrowthPlan(', 'function profileTraderBankrollUsd('),c);
 vm.runInContext(section('async function handleApi(', 'function serveFile('),c);
 return {c,d,state,reserves,setCash:n=>cash=n,saves:()=>saves,run:async body=>{await c.handleApi({method:'POST',body},{},{pathname:'/api/growth/settings'});return c.output;}};
}
test('completed goal stops all trading and locks profit once, including after restart',async()=>{
 const h=harness();h.d.fills=[fill('buy',100),fill('sell',200)];
 await h.c.updateGrowthProgress();assert.equal(h.d.growthGoal.status,'completed');assert.equal(h.state.profiles.safe.running,false);
 assert.equal(h.c.emergencyStopRequested,true);assert.equal(h.reserves.w.lockedUsd,135);
 await h.c.updateGrowthProgress();assert.equal(h.reserves.w.lockedUsd,135);
 await assert.rejects(h.c.prepareGrowthSession(h.state),/already reached/);
});
test('external wallet shortfall prevents declaring target completion',async()=>{
 const h=harness();h.d.fills=[fill('buy',100),fill('sell',200)];h.setCash(200);
 await h.c.updateGrowthProgress();assert.equal(h.d.growthGoal.status,'active');assert.match(h.d.growthGoal.reviewMessage,/differs/);
 assert.equal(growthSnapshot(h.d).availableUsd,0);assert.equal(h.reserves.w.lockedUsd,35);
});
test('resume preserves initial principal and old profit instead of resetting at each Start',async()=>{
 const h=harness();h.d.fills=[fill('buy',20),fill('sell',40)];
 await h.c.prepareGrowthSession(h.state);assert.equal(h.d.growthGoal.id,'g1');assert.equal(growthSnapshot(h.d).availableUsd,120);
});
test('first Start checks available cash and unresolved earlier holdings',async()=>{
 const h=harness();delete h.d.growthGoal;h.setCash(134);
 await assert.rejects(h.c.prepareGrowthSession(h.state),/available USDC/);assert.equal(h.d.growthGoal,undefined);
 h.setCash(179);await h.c.prepareGrowthSession(h.state);assert.equal(h.d.growthGoal.excludedCash,79);
 delete h.d.growthGoal;h.c.executionJournal.snapshot=async()=>({pending:{p:{wallet:'w'}},positions:{}});
 await assert.rejects(h.c.prepareGrowthSession(h.state),/pending trades/);
});
test('settings cannot change a running plan; saving while stopped never starts it',async()=>{
 const h=harness();delete h.d.growthGoal;
 const body={profitMode:'target',growthPrincipal:'100',growthTarget:'200'};
 assert.equal((await h.run(body)).code,409);assert.equal(h.d.growthGoal,undefined);
 h.state.profiles.safe.running=false;assert.equal((await h.run(body)).code,200);
 assert.equal(h.state.profiles.safe.running,false);assert.equal(h.d.growthGoal,undefined);
 h.d.growthGoal=goal();h.d.fills=[fill('buy',20)];assert.equal((await h.run(body)).code,409);
});
test('failed chain transactions retain goal fees and pending reservations survive restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'growth-'));
 try {
  const file=path.join(dir,'journal.json'),j=createTradingJournal(file,'USDC'),d=await j.load();
  d.growthGoal=goal();d.pending.tx={goalId:'g1',wallet:'w',mint:'coin',side:'buy',reservedUsd:20,txid:'tx'};await j.save();
  const reload=createTradingJournal(file,'USDC');assert.equal(growthSnapshot(await reload.load()).availableUsd,80);
  await reload.reconcile({getParsedTransaction:async()=>({blockTime:1,meta:{err:{failed:true},fee:5000}})});
  const result=await reload.load();assert.equal(result.charges.length,1);assert.equal(result.charges[0].costSol,0.000005);
  assert.equal(growthSnapshot(result).availableUsd,0);result.charges[0].feeUsd=0.001;
  assert.equal(growthSnapshot(result).availableUsd,99.999);
 }finally{await rm(dir,{recursive:true,force:true});}
});
