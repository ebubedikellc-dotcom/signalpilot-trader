import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {freeConnection} from '../lib/rpc-provider.mjs';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
function harness({holding=false,buyFails=false,testVersion=2,publicMode=false,running=false}={}) {
 let response;const calls=[];
 const state={settings:{copyConnection:publicMode?'public':'legacy'},profiles:{safe:{running}},strategy:{activeProfile:'safe'},trades:[]};
 const c=vm.createContext({Date,Number,BigInt,Object,structuredClone,
   supportedProfiles:['safe'],routeReplayBusy:false,freeConnection,process:{env:{}},canonicalSignalId:x=>x,
   request:{method:'POST'},response:{},url:{pathname:'/api/simple-speed-test'},
   readBody:async()=>({testVersion}),readState:async()=>state,requireOwner:()=>false,sessionFromRequest:()=>({}),tradeWallet:()=> 'wallet',targetWallet:()=> 'source',
   fetchGmgnTransactionsForAddress:async()=>[{signature:'source-buy',leg:{action:'buy',inputMint:'USDC',outputMint:'COIN',outputSymbol:'Coin'}}],
   primarySwapLeg:t=>t.leg,isQuoteMint:m=>m==='USDC',usdcMint:'USDC',
   executeCopiedSwapLocked:async(...args)=>{calls.push(args);if(buyFails)throw new Error('Source mismatch');return {routeReady:true,copiedTradeAmount:'5000000',routeOutputAmount:'100',outputMint:'COIN',executionEngine:'jupiter',timingsMs:{sourceVerification:20}};},
   solanaConnection:()=>({}),executionJournal:{snapshot:async()=>({positions:holding ? {a:{wallet:'wallet',profile:'safe',verified:true,mint:'COIN',raw:'90'}} : {}})},
   tokenBalanceRaw:async()=> '100',hasPendingMint:async()=>false,
   jupiterApiKey:()=> 'test',jupiterJson:async(_path,options)=>{calls.push(options.query);return {outAmount:'4900000'};},
   prepareTradingOrder:async(_s,q)=>{calls.push(q);return {transaction:'unused',outAmount:'4900000',inAmount:q.amount,executionEngine:'jupiter'};},
   send:(_r,_status,data)=>response=data});
 vm.runInContext('async function run(){'+section(server,'  if (request.method === "POST" && url.pathname === "/api/simple-speed-test")','  if (request.method === "POST" && url.pathname === "/api/fnzero/coins")')+'}',c);
 return {c,calls,result:()=>response};
}
test('free connection replays public source activity without contacting GMGN',async()=>{
 const h=harness({publicMode:true});let publicReads=0;
 h.c.recentPublicSwaps=async wallet=>{assert.equal(wallet,'source');publicReads++;return [{signature:'public-buy',timestamp:123,leg:{action:'buy',inputMint:'USDC',outputMint:'COIN'}}];};
 h.c.fetchGmgnTransactionsForAddress=async()=>{assert.fail('Free mode must not call GMGN');};
 await h.c.run();const r=h.result();
 assert.equal(r.real.ok,true);assert.equal(publicReads,1);assert.equal(r.real.feedSource,'Public Solana');
 assert.equal(r.real.traderWallet,'source');assert.equal(r.real.sourceSignature,'public-buy');assert.equal(r.real.sourceTimestamp,123);
 assert.equal(h.calls[0][5],true);assert.equal(h.c.routeReplayBusy,false);
});
test('legacy replay retains GMGN and public replay errors never switch to GMGN',async()=>{
 const legacy=harness();await legacy.c.run();assert.equal(legacy.result().real.feedSource,'GMGN');
 const h=harness({publicMode:true});h.c.recentPublicSwaps=async()=>{throw Error('Public RPC unavailable');};
 h.c.fetchGmgnTransactionsForAddress=async()=>assert.fail('No paid fallback is authorized');
 await h.c.run();assert.match(h.result().real.message,/Public RPC unavailable/);assert.equal(h.c.routeReplayBusy,false);
});
test('test requests are rejected while trading or another replay is active',async()=>{
 for(const running of [true,false]) {
  const h=harness({running});if(!running)h.c.routeReplayBusy=true;
  h.c.fetchGmgnTransactionsForAddress=async()=>assert.fail('No feed request while blocked');
  await h.c.run();assert.match(h.result().error,running?/Stop trading/:/already running/);assert.equal(h.calls.length,0);
 }
});
test('concurrent request bodies cannot start two route replays',async()=>{
 const h=harness();let releaseFeed,feedCalls=0;const bodies=[];
 h.c.readBody=()=>new Promise(r=>bodies.push(r));
 h.c.fetchGmgnTransactionsForAddress=()=>{feedCalls++;return new Promise(r=>releaseFeed=r);};
 const first=h.c.run(),second=h.c.run();
 await new Promise(r=>setImmediate(r));
 bodies[0]({testVersion:2});bodies[1]({testVersion:2});
 await second;assert.match(h.result().error,/already running/);assert.equal(feedCalls,1);
 releaseFeed([]);await first;assert.equal(h.c.routeReplayBusy,false);
});
test('unexpected replay failure still releases the test lock',async()=>{
 const h=harness();h.c.targetWallet=()=>{throw Error('Unexpected configuration error');};
 await assert.rejects(h.c.run(),/Unexpected configuration error/);assert.equal(h.c.routeReplayBusy,false);
});
test('route test calls internal replay and labels an unheld reverse route hypothetical',async()=>{
 const h=harness();await h.c.run();const r=h.result();
 assert.equal(r.readOnly,true);assert.equal(r.real.ok,true);
 assert.equal(h.calls[0][5],true);assert.equal(h.calls[1].amount,'100');
 assert.equal(h.calls[1].taker,undefined);
 assert.equal(r.real.sell.routeReady,false);assert.equal(r.real.sell.quoteReady,true);
 assert.match(r.real.sell.kind,/wallet does not hold/);assert.equal(r.latestLive,null);
 assert.equal(r.buyReactionMs,undefined);
});
test('a failed buy still checks a verified full holding exit',async()=>{
 const h=harness({holding:true,buyFails:true});await h.c.run();const r=h.result();
 assert.equal(r.real.ok,false);assert.match(r.real.message,/Source mismatch/);
 assert.equal(r.real.sell.routeReady,true);assert.equal(h.calls[1].amount,'90');
 assert.match(r.real.sell.kind,/no matching trader sell/);
});
test('test display separates preparation, hypothetical sales and unmeasured signing',async()=>{
 const result={textContent:'',innerHTML:''},button={disabled:false};
 const c=vm.createContext({Number,Math,performance:{now:()=>100},$:id=>id==='runSpeedTest'?button:result,
   escapeHtml:s=>String(s).replaceAll('<','&lt;'),api:async()=>({real:{ok:true,buyReadyMs:620,plannedUsd:5,token:'<Coin>',feedMs:10,
     buy:{executionEngine:'jupiter',fundsCacheUsed:false,fundsCacheAgeMs:30000,liveControlMessage:'Trading stopped',timingsMs:{sourceVerification:20}},
     sell:{quoteReady:true,routeReady:false,kind:'Hypothetical reverse route',elapsedMs:400}}})});
 vm.runInContext(section(script,'async function runSimpleSpeedTest()','async function saveManualDeposit()'),c);
 await c.runSimpleSpeedTest();
 assert.match(result.innerHTML,/BUY preparation ready in 620 ms/);
 assert.match(result.innerHTML,/Source verification/);assert.match(result.innerHTML,/fresh balance read required/);
 assert.match(result.innerHTML,/hypothetical quote ready/);assert.match(result.innerHTML,/not run in this test/);
 assert.match(result.innerHTML,/&lt;Coin>/);assert.doesNotMatch(result.innerHTML,/Fake reaction|machine BUY 1ms/);
 assert.equal(button.disabled,false);
});

test('outdated testing clients get a refresh message before any route requests',async()=>{
 const h=harness({testVersion:1});await h.c.run();
 assert.match(h.result().error,/Refresh this page/);assert.equal(h.calls.length,0);
});

