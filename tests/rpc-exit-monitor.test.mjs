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
