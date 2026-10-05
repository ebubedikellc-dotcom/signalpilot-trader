import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function harness(reason,held='10') {
 const calls=[],p={verified:true,raw:'10',cost:20,wallet:'w',mint:'coin',profile:'safe',key:'p'};
 const state={settings:{},profiles:{safe:{running:true}},strategy:{controlRevision:1}};
 const d={notices:{},pending:{}};
 const c=vm.createContext({BigInt,Number,Object,Date,emergencyStopRequested:false,supportedProfiles:['safe'],readState:async()=>state,ready:()=>true,
 refreshExecutionReport:async()=>{},executionReport:{positions:{p}},withWalletOperation:async f=>f(),updateGrowthProgress:async()=>{},executionJournal:{load:async()=>d,save:async()=>{}},
 profileBuyMode:()=> 'limits',hasPendingMint:async()=>false,liveTradingAllowed:()=>true,trackedPosition:async()=>p,solanaConnection:()=>({}),
 tokenBalanceRaw:async()=>{calls.push('balance');return held;},jupiterApiKey:()=>'',usdcMint:'USDC',growthSnapshot:()=>null,exitReason:()=>reason,
 jupiterJson:async path=>{calls.push(path);return {outAmount:'25000000',inAmount:'10',transaction:'quote'};},
 signSolanaTransaction:async()=>{calls.push('sign');return {};},signerId:()=>'',recordPendingSwap:async()=> 'pending',recordExecutionResponse:async()=>{calls.push('record');}});
 vm.runInContext(source.slice(source.indexOf('let riskWorking='),source.indexOf('// Read-only market metadata.')),c);
 return {c,calls,d};
}
test('price watching does not consume a wallet read when no exit is triggered',async()=>{
 const h=harness(null);await h.c.runPositionWatch();assert.deepEqual(h.calls,['/swap/v2/order']);
});
test('triggered exit still requires fresh holdings before signing and submitting',async()=>{
 const h=harness('profit');await h.c.runPositionWatch();assert.deepEqual(h.calls,['/swap/v2/order','balance','sign','/swap/v2/execute','record']);
});
test('insufficient fresh holdings block the triggered sale',async()=>{
 const h=harness('profit','0');await h.c.runPositionWatch();assert.deepEqual(h.calls,['/swap/v2/order','balance']);assert.match(h.d.notices.p,/reconciliation/);
});

test('a waiting routine price quote leaves the wallet available to an urgent copy sell',async()=>{
 const h=harness(null);let release,started;
 const waiting=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 vm.runInContext(source.slice(source.indexOf('const walletJobs ='),source.indexOf('async function readProfitReserves')),h.c);
 h.c.jupiterJson=async()=>{started();await waiting;return {outAmount:'25000000',inAmount:'10',transaction:'quote'};};
 const monitor=h.c.runPositionWatch();await ready;
 await Promise.race([h.c.withWalletOperation(async()=>h.calls.push('urgent sell'),100),new Promise((_,reject)=>setTimeout(()=>reject(new Error('price quote held the wallet lock')),1000))]);
 assert.deepEqual(h.calls,['urgent sell']);release();await monitor;
});
test('position or controls changed while quoting discards the quote before signing',async()=>{
 for(const change of ['cycle','raw','cost','revision','pending','closed']) {
  const h=harness('profit');const original=h.c.jupiterJson;
  h.c.jupiterJson=async(...args)=>{
   const order=await original(...args);
   if(change==='revision')(await h.c.readState()).strategy.controlRevision++;
   else if(change==='pending')h.c.hasPendingMint=async()=>true;
   else if(change==='closed')h.c.trackedPosition=async()=>null;
   else {const p=await h.c.trackedPosition();p[change]=change==='raw'?'5':change==='cost'?10:'new-purchase';}
   return order;
  };
  await h.c.runPositionWatch();assert.deepEqual(h.calls,['/swap/v2/order'],change);
 }
});
