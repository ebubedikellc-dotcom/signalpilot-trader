import {createMonitorSleep} from '../lib/monitor-sleep.mjs';
import {rpcProvider,monitoredProfiles,directMonitoringEnabled} from '../lib/rpc-provider.mjs';
import { sellFraction, proportionalAmount, tokenAmounts } from '../lib/position-accounting.mjs';
import {copyBuyPriceCheck} from '../lib/copy-price-guard.mjs';
import { canonicalSignalId } from "../lib/direct-signals.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
test('speed test checks real read-only routing but cannot sign or submit trades',()=>{
 const endpoint=section(server,'  if (request.method === "POST" && url.pathname === "/api/simple-speed-test")','  if (request.method === "POST" && url.pathname === "/api/fnzero/coins")');
 assert.match(endpoint,/requireOwner/);
 assert.match(endpoint,/fetchGmgnTransactionsForAddress/);
 assert.match(endpoint,/prepareTradingOrder/);
 assert.match(endpoint,/executeCopiedSwapLocked/);
 assert.match(endpoint,/undefined, true/);
 assert.match(endpoint,/hasPendingMint/);
 assert.doesNotMatch(endpoint,/signSolanaTransaction|executeTradingOrder|sendRawTransaction|submitFnzeroOrder/);
 assert.doesNotMatch(script,/fnzeroMint|fnzeroCoin|fnzeroSide|testFnzero/);
 assert.match(script,/runSimpleSpeedTest/);
 assert.match(script,/BUY preparation/);
 assert.match(script,/not run in this test/);
 assert.doesNotMatch(endpoint,/buyReactionMs|sellReactionMs|Fake trader/);
});
test('poll cadence does not expire buys; a known subsequent source sell cancels them',()=>{
 const feeds=new Map();const c=vm.createContext({Number,signalFeeds:feeds,primarySwapLeg:t=>t.leg,targetWallet:()=> 'wallet'});
 vm.runInContext(section(server,'// Poll cadence','async function executeCopiedSwap('),c);
 const buy={timestamp:100,leg:{action:'buy',outputMint:'COIN'}};
 assert.equal(c.buySignalError('safe',buy,{}),'');
 feeds.set('safe:Helius',{profile:'safe',wallet:'wallet',transactions:[{timestamp:101,leg:{action:'sell',inputMint:'COIN'}}]});
 assert.match(c.buySignalError('safe',buy,{}),/already sold/);
});
function executionHarness() {
 const submitted=[];let stopped=false;
 const state={profiles:{safe:{running:true}},strategy:{activeProfile:'safe'},settings:{}};
 const c=vm.createContext({Date,BigInt,Number,emergencyStopRequested:false,canonicalSignalId,sellFraction,proportionalAmount,tokenAmounts,copyBuyPriceCheck,
 verifyCopySource:async(_,t)=>({leg:t.leg,sourceTx:{blockTime:1,slot:1,meta:t.leg.action==='buy'?{preTokenBalances:[],postTokenBalances:[{owner:'wallet',mint:'COIN',uiTokenAmount:{amount:'123'}}]}:{preTokenBalances:[{owner:"wallet",mint:"COIN",uiTokenAmount:{amount:"123"}}],postTokenBalances:[]}},verifiedAt:new Date().toISOString()}),
 trackedPosition:async()=>({raw:'123'}),hasPendingMint:async()=>false,recordPendingSwap:async()=> 'test',recordExecutionResponse:async()=>{},supportedProfiles:['safe'],signalFeeds:new Map(),targetWallet:()=> 'wallet',
 readState:async()=>({...state,profiles:{safe:{running:!stopped}}}),primarySwapLeg:t=>t.leg,
 tradeWallet:()=> 'wallet',signerId:()=> 'wallet',jupiterApiKey:()=> 'test',solanaConnection:()=>({getParsedTransaction:async()=>({meta:{preTokenBalances:[{owner:'wallet',mint:'COIN',uiTokenAmount:{amount:'123'}}],postTokenBalances:[]}})}),
 scaledCopyAmount:()=>({amount:'1'}),isQuoteMint:m=>m==='USDC',usdcMint:'USDC',profileSellOnly:()=>false,
 buyUsdAmount:()=>50,profileTradeableUsdc:async()=>100,profileBuyMode:()=> 'cap50',usdcRawFromUsd:x=>String(Math.floor(x*1e6)),
 tokenBalanceRaw:async()=> '123',profileCopySizing:()=> 'test',
 signSolanaTransaction:async()=>({signedTransactionBase64:'signed',signWith:'wallet'}),
 jupiterJson:async(path,options)=>{if(path.includes('execute')){submitted.push(options);return {signature:'test'}}return {transaction:'test',inAmount:options.query.amount,outAmount:'123',slippageBps:0}}});
 vm.runInContext(section(server,'const walletJobs =','async function readProfitReserves'),c);
 vm.runInContext(section(server,'// Poll cadence','function transactionSignature('),c);
 const buy={timestamp:Date.now()/1000-1,leg:{action:'buy',inputMint:'USDC',outputMint:'COIN',amount:'50000000',sourceUsd:50}};
 const sell={timestamp:1,leg:{action:'sell',inputMint:'COIN',outputMint:'USDC',amount:'123'}};
 return {c,state,buy,sell,submitted,stop:()=>{stopped=true}};
}
test('unheld source sales do not consume verification RPC calls',async()=>{
 const h=executionHarness();h.c.trackedPosition=async()=>null;
 h.c.verifyCopySource=async()=>{throw new Error('unheld sell must not use RPC');};
 const result=await h.c.executeCopiedSwap('safe',h.sell,h.state);
 assert.match(result.status,/no verified copied holding/);assert.equal(h.submitted.length,0);
 h.c.hasPendingMint=async()=>true;
 assert.match((await h.c.executeCopiedSwap('safe',h.sell,h.state)).status,/remains queued/);
});
test('unsigned buy route overlaps verification but no signing occurs until verification succeeds',async()=>{
 const h=executionHarness();let release,quotes=0,signs=0;
 const verified=new Promise(r=>release=r),original=h.c.verifyCopySource,quote=h.c.jupiterJson;
 h.c.profileSurviveMaxUsd=()=>50;h.c.cachedProfileTradeableUsdcValue=()=>100;h.c.tradeFundsFastMaxAgeMs=10000;
 h.c.verifyCopySource=async(...args)=>{await verified;return original(...args);};
 h.c.jupiterJson=async(...args)=>{quotes++;return quote(...args);};
 h.c.signSolanaTransaction=async()=>{signs++;return {signedTransactionBase64:'signed'};};
 const preparation=h.c.executeCopiedSwap('safe',h.buy,h.state);
 await new Promise(r=>setImmediate(r));assert.equal(quotes,1);assert.equal(signs,0);
 release();await preparation;assert.equal(quotes,2);assert.equal(signs,1); // One order and one execute.
});
test('speculative order is discarded when verified sizing changes',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson,amounts=[];let sizes=0;
 h.c.profileSurviveMaxUsd=()=>50;h.c.cachedProfileTradeableUsdcValue=()=>100;h.c.tradeFundsFastMaxAgeMs=10000;
 h.c.buyUsdAmount=()=>++sizes===1?50:20;
 h.c.jupiterJson=async(path,options)=>{if(options.query)amounts.push(options.query.amount);return original(path,options);};
 const result=await h.c.executeCopiedSwap('safe',h.buy,h.state);
 assert.deepEqual(amounts,['50000000','20000000']);assert.equal(result.copiedTradeAmount,'20000000');
});
test('full-amount copies skip insufficient budget and never reduce the purchase',async()=>{
 const h=executionHarness();h.c.profileBuyMode=()=> 'exactFull';
 h.c.profileTradeableUsdc=async()=>20;
 h.c.signSolanaTransaction=async()=>{throw new Error('must not sign');};
 const result=await h.c.executeCopiedSwap('safe',h.buy,h.state);
 assert.match(result.status,/insufficient tradeable USDC/);assert.equal(h.submitted.length,0);
});
test('full-amount copies recheck locked funds before signing and reject undersized orders',async()=>{
 const h=executionHarness();h.c.profileBuyMode=()=> 'exactFull';let checks=0;
 h.c.profileTradeableUsdc=async()=>++checks===1?100:20;
 h.c.signSolanaTransaction=async()=>{throw new Error('must not sign');};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/locked profit protected/);
 h.c.profileTradeableUsdc=async()=>100;
 h.c.jupiterJson=async()=>({transaction:'test',inAmount:'20000000'});
 await assert.rejects(h.c.executeCopiedSwap('safe',h.buy,h.state),/complete authorized purchase amount/);
 assert.equal(h.submitted.length,0);
});
test('full-amount copy retains proportional source selling',async()=>{
 const h=executionHarness();h.c.profileBuyMode=()=> 'exactFull';
 h.c.verifyCopySource=async()=>({leg:h.sell.leg,sourceTx:{blockTime:1,slot:1,meta:{preTokenBalances:[{owner:'wallet',mint:'COIN',uiTokenAmount:{amount:'100'}}],postTokenBalances:[{owner:'wallet',mint:'COIN',uiTokenAmount:{amount:'50'}}]}}});
 h.c.trackedPosition=async()=>({raw:'120'});h.c.tokenBalanceRaw=async()=> '120';
 const result=await h.c.executeCopiedSwap('safe',h.sell,h.state);
 assert.equal(result.copiedTradeAmount,'60');assert.equal(h.submitted.length,1);
});
test('one-second-old buys and late sells are eligible; Stop during signing cancels submission',async()=>{
 const h=executionHarness();
 assert.equal((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,'Submitted - confirmation pending');
 assert.equal((await h.c.executeCopiedSwap('safe',h.sell,h.state)).status,'Submitted - confirmation pending');
 h.c.signSolanaTransaction=async()=>{h.stop();return {signedTransactionBase64:'test'}};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/stopped/);
 assert.equal(h.submitted.length,2);
});
test('a sell submits while a different buy is still awaiting its quote',async()=>{
 const h=executionHarness();let releaseQuote,quoteStarted;
 const started=new Promise(r=>quoteStarted=r),waiting=new Promise(r=>releaseQuote=r);
 h.c.jupiterJson=async(path,options)=>{
  if(path.includes('execute')){h.submitted.push(options);return {signature:'test'}}
  if(options.query.inputMint==='USDC'){quoteStarted();await waiting;}
  return {transaction:'test',inAmount:options.query.amount,outAmount:'123',slippageBps:0};
 };
 const pending=h.c.executeCopiedSwap('safe',h.buy,h.state);await started;
 assert.equal((await h.c.executeCopiedSwap('safe',h.sell,h.state)).status,'Submitted - confirmation pending');
 assert.equal(h.submitted.length,1);releaseQuote();await pending;assert.equal(h.submitted.length,2);
});
test('source exit received while a buy quote is pending cancels that buy',async()=>{
 const h=executionHarness();const original=h.c.jupiterJson;
 h.c.jupiterJson=async(...args)=>{
  const result=await original(...args);
  if(args[0].includes('order'))h.c.signalFeeds.set('safe:Helius',{profile:'safe',wallet:'wallet',transactions:[{...h.sell,timestamp:h.buy.timestamp+1}]});
  return result;
 };
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/already sold/);
 assert.equal(h.submitted.length,0);
});
test('sold-at-loss is closed; positive wallet quantity is open; absent wallet data is unknown',()=>{
 let balance={tokens:{},updatedAt:new Date().toISOString()};
 const c=vm.createContext({Date,Map,Set,BigInt,latestState:{},walletBalance:()=>balance,balanceUsdc:()=>179,
 profileTradeMatches:()=>true,tradeDateValue:t=>Date.parse(t.time)});
 vm.runInContext(section(script,'function tradeSide(','function renderOpenPositions('),c);
 const trades=[{action:'Buy signal',status:'Executed',tradedTokenMint:'AbCd',amount:50,time:'2026-10-04T00:00:00Z'},
 {action:'Sell signal',status:'Executed',tradedTokenMint:'AbCd',amount:44.6,time:'2026-10-04T00:00:01Z'}];
 assert.equal(c.openPositionsFromTrades(trades).length,0);
 assert.equal(c.stockCoinsFromTrades(trades).length,0);
 assert.equal(c.closedTradesFromTrades(trades).length,1);
 assert(Math.abs(c.closedTradesFromTrades(trades)[0].netProceeds+5.4)<1e-8);
 balance.tokens.AbCd={raw:'2',amount:2};
 assert.equal(c.openPositionsFromTrades(trades).length,1);
 assert.equal(c.stockCoinsFromTrades(trades).length,1);
 balance={error:'RPC failed'};
 assert.equal(c.closedTradesFromTrades(trades).length,0);
 assert.equal(c.stockCoinsFromTrades(trades).length,0);
 assert.equal(c.openPositionsFromTrades(trades)[0].held,null);
});
test('GMGN is the sole activity feed even with a saved Helius key',async()=>{
 const c=vm.createContext({Date,Map,Set,Promise,monitoredProfiles,executionReport:null,syncLiveSubscriptions:async()=>{},monitorSleepStatus:()=>({recoveryPollMs:1000}),wakeCopyWorker:async()=>{},wakeSellWorker:async()=>{},supportedProfiles:['safe'],
 readState:async()=>({profiles:{safe:{running:true}},settings:{heliusKey:'test',gmgnApiKey:'test'}}),
 targetWallet:()=> 'wallet',process:{env:{}},fetchTransactionsForAddress:async()=>[{signature:'new',timestamp:1}],
 fetchGmgnTransactionsForAddress:()=>new Promise(()=>{})});
 vm.runInContext(section(server,'const signalFeeds =','async function runCopyWorkerOnce()'),c);
 await c.pollSignalFeeds(); await new Promise(resolve=>setImmediate(resolve));
 const health=c.feedHealth(); assert.equal(health.find(f=>f.source==='Helius'),undefined);assert.equal(health.find(f=>f.source==='GMGN').status,'Connecting');
});
test('stale worker cannot resume stopped trading',async()=>{
 let disk={strategy:{controlRevision:20},profiles:{safe:{running:false}}},temp;
 const c=vm.createContext({readFile:async()=>JSON.stringify(disk),writeFile:async(_,v)=>{temp=v},rename:async()=>{disk=JSON.parse(temp)},mkdir:async()=>{},dataFile:'test',dataDir:'.',supportedProfiles:['safe']});
 vm.runInContext(section(server,'let stateSaveQueue =','async function readBody'),c);
 await c.saveState({strategy:{controlRevision:10},profiles:{safe:{running:true}}});
 assert.equal(disk.profiles.safe.running,false);
});
test('queued sells run before queued buys after the current operation completes',async()=>{
 let unlock; const first=new Promise(r=>unlock=r);const order=[];
 const c=vm.createContext({Promise});
 vm.runInContext(section(server,'const walletJobs =','async function readProfitReserves'),c);
 const running=c.withWalletOperation(async()=>{await first;order.push('running')});
 const buy=c.withWalletOperation(async()=>order.push('buy'));
 const sell=c.withWalletOperation(async()=>order.push('sell'),100);
 unlock();await Promise.all([running,buy,sell]);assert.deepEqual(order,['running','sell','buy']);
});
test('Helius alerts stay warm while paused and retain traders with holdings',async()=>{
 const callbacks=new Map();const removed=[];let id=0;
 const c=vm.createContext({Map,Set,Date,process:{env:{}},rpcProvider,monitoredProfiles,directMonitoringEnabled,createMonitorSleep,executionReport:{positions:{old:{profile:'safe',raw:'1'}},pending:{}},supportedProfiles:['safe','frog','truenest'],PublicKey:class{constructor(x){this.value=x}},
 targetWallet:(_,p)=>p,solanaConnection:()=>({onLogs:(wallet,cb)=>{callbacks.set(wallet.value,cb);return ++id},removeOnLogsListener:async n=>removed.push(n)})});
 vm.runInContext(section(server,'let wakeCopyWorker =','const signalFeeds ='),c);
 const state={profiles:{safe:{running:true}},settings:{heliusKey:'test'},strategy:{activeProfile:'safe'}};
 await c.syncLiveSubscriptions(state);assert.equal(callbacks.size,1);
 state.strategy.activeProfile='frog';await c.syncLiveSubscriptions(state);assert.equal(id,2);assert.equal(removed.length,0);
 state.profiles.safe.running=false;await c.syncLiveSubscriptions(state);assert.equal(removed.length,0);
 delete state.settings.heliusKey;await c.syncLiveSubscriptions(state);assert.equal(removed.length,2);
});
test('sell-first processing keeps its checkpoint and blocks buying a coin already sold in that batch',async()=>{
 const executed=[];
 const c=vm.createContext({canonicalSignalId,Set,Number,Date,queueSourceObservation:()=>{},queueSourceSell:async()=>{},supportedProfiles:['safe'],copyableSignal:()=>true,
 primarySwapLeg:t=>t.leg,tradeFromTransaction:(_,t)=>({signature:t.signature}),
 liveTradingAllowed:()=>true,executeCopiedSwap:async(_,t)=>{executed.push(t.signature);return {status:'Executed'}},
 autoSellStuckTokenAfterSellSignal:async()=>null,applyAutoSwitchStrategy:()=>{},line:x=>x,profileLabel:p=>p,shouldLogNoSignal:()=>false});
 vm.runInContext(section(server,'async function processSignalTransactions(','let wakeCopyWorker ='),c);
 const state={profiles:{safe:{lastSignature:'old'}},strategy:{activeProfile:'safe'},trades:[]};
 const tx=[{signature:'sell',timestamp:2,leg:{action:'sell',inputMint:'COIN'}},{signature:'buy',timestamp:1,leg:{action:'buy',outputMint:'COIN'}},{signature:'old'}];
 await c.processSignalTransactions(state,'safe',tx,'sell','lastSignature','Helius',{side:'sell'});
 assert.equal(state.profiles.safe.lastSignature,'old');
 await c.processSignalTransactions(state,'safe',tx,'sell','lastSignature','Helius',{side:'buy'});
 assert.deepEqual(executed,['sell']);assert.equal(state.profiles.safe.lastSignature,'sell');
 assert.match(state.trades.find(t=>t.signature==='buy').status,/already sold/);
});
test('the sell lane detects a newly arrived sell while the buy lane is waiting',async()=>{
 const state={profiles:{safe:{running:true,lastSignature:'old'}},strategy:{activeProfile:'safe'},activity:[]};
 const feeds=new Map([['safe:Helius',{profile:'safe',wallet:'wallet',transactions:[{signature:'buy'}]}]]);
 let buyStarted,releaseBuy;const started=new Promise(r=>buyStarted=r),pending=new Promise(r=>releaseBuy=r);const seen=[];
 const c=vm.createContext({Map,Number,readState:async()=>state,supportedProfiles:['safe'],signalFeeds:feeds,
 targetWallet:()=> 'wallet',newestSignature:ts=>ts[0]?.signature,line:x=>x,
 retrySourceSells:async()=>{},autoSellStockCoinsFromHistory:async()=>{},saveState:async()=>{},
 processSignalTransactions:async(_,profile,tx,newest,field,source,options)=>{
   if(options.side==='buy'){buyStarted();await pending;}
   else seen.push({signature:newest,field});
 }});
 vm.runInContext('let wakeSellWorker = async()=>{};'+section(server,'async function runCopyWorkerOnce()','function startCopyWorker()'),c);
 const run=c.runCopyWorkerOnce();await started;
 feeds.set('safe:Helius',{profile:'safe',wallet:'wallet',transactions:[{signature:'sell'}]});
 await vm.runInContext('wakeSellWorker()',c);
 assert(seen.some(x=>x.signature==='sell'&&x.field==='lastSignatureSell'));
 releaseBuy();await run;
});
test('a prepared buy cannot spend funds that became locked before submission',async()=>{
 const h=executionHarness();let reads=0;
 h.c.profileTradeableUsdc=async()=>++reads===1?100:10;
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/locked profit protected/);
 assert.equal(h.submitted.length,0);
});
test('a purchase-limit change while quoting blocks the old prepared buy',async()=>{
 const h=executionHarness();h.state.strategy.controlRevision=1;
 const original=h.c.jupiterJson;let changed=false;
 h.c.jupiterJson=async(...args)=>{const result=await original(...args);if(args[0].includes('order'))changed=true;return result;};
 h.c.readState=async()=>({...h.state,strategy:{...h.state.strategy,controlRevision:changed?2:1}});
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/controls changed/);
 assert.equal(h.submitted.length,0);
});
test('a purchase-limit change during signing also cancels the prepared buy',async()=>{
 const h=executionHarness();h.state.strategy.controlRevision=1;let changed=false;
 h.c.readState=async()=>({...h.state,strategy:{...h.state.strategy,controlRevision:changed?2:1}});
 h.c.signSolanaTransaction=async()=>{changed=true;return {signedTransactionBase64:'signed'}};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/controls changed/);
 assert.equal(h.submitted.length,0);
});
test('restart excludes buys from the stopped period without expiring new session trades',()=>{
 const c=vm.createContext({Date,Number,supportedProfiles:['safe'],signalFeeds:new Map(),primarySwapLeg:t=>t.leg,targetWallet:()=> 'wallet'});
 vm.runInContext(section(server,'function beginTradingSession','async function executeCopiedSwap('),c);
 const state={strategy:{},profiles:{safe:{running:false}}};c.beginTradingSession(state);
 const start=state.strategy.buySessionStartedAt;
 assert.match(c.buySignalError('safe',{timestamp:Math.floor(start/1000)-1},state),/predates/);
 assert.equal(c.buySignalError('safe',{timestamp:Math.floor(start/1000),leg:{action:'buy',outputMint:'COIN'}},state),'');
 state.profiles.safe.running=true;c.beginTradingSession(state);assert.equal(state.strategy.buySessionStartedAt,start);
});
test('dashboard status reports poll cadence without referencing a removed buy deadline',()=>{
 const c=vm.createContext({fnzeroRouter:{status:()=>({})},executionReport:null,rpcProvider,process:{env:{}},liveTradingAllowed:()=>false,publicSettings:()=>({}),workerIntervalMs:500,
 monitorSleepStatus:()=>({sleeping:false}),rpcConnections:new Map(),gmgnConnectionCheck:null,observationUntil:0,feedHealth:()=>[],liveSubscriptions:new Map(),customerPublic:x=>x});
 vm.runInContext(section(server,'function statusPayload(','async function walletBalances('),c);
 const result=c.statusPayload({settings:{},customers:[],profiles:{safe:{running:false}}},{role:'owner',id:'owner'});
 assert.equal(result.backend.pollIntervalMs,500);assert.equal(result.backend.maxSignalAgeMs,null);
 assert.equal(result.profiles.safe.running,false);
});
test('first direct notification is processed once even when GMGN later reports the same transaction',async()=>{
 let executions=0;const signature='A'.repeat(88);
 const c=vm.createContext({canonicalSignalId,Set,Number,Date,queueSourceObservation:()=>{},queueSourceSell:async()=>{},supportedProfiles:['safe'],copyableSignal:()=>true,
 primarySwapLeg:t=>t.leg,tradeFromTransaction:(_,t)=>({signature:t.signature}),liveTradingAllowed:()=>true,
 executeCopiedSwap:async()=>{executions++;return {status:'Executed'}},applyAutoSwitchStrategy:()=>{},line:x=>x,profileLabel:p=>p,shouldLogNoSignal:()=>false});
 vm.runInContext(section(server,'async function processSignalTransactions(','let wakeCopyWorker ='),c);
 const state={profiles:{safe:{lastGmgnSignature:'old'}},strategy:{activeProfile:'safe'},trades:[]};
 const tx={signature,timestamp:1,leg:{action:'buy',outputMint:'COIN'}};
 await c.processSignalTransactions(state,'safe',[tx],signature,'lastDirectSignature','Solana live',{side:'buy',realtime:true,advanceCheckpoint:true});
 await c.processSignalTransactions(state,'safe',[{...tx,signature:`gmgn:${signature}`}],`gmgn:${signature}`,'lastGmgnSignature','GMGN',{side:'buy',advanceCheckpoint:true});
 assert.equal(executions,1);assert.equal(state.trades.length,1);
});

test('source verification failure blocks quotation, signing and submission',async()=>{
 const h=executionHarness();let quotes=0,signatures=0;
 h.c.verifyCopySource=async()=>{throw new Error('Source token mismatch');};
 h.c.jupiterJson=async()=>{quotes++;};h.c.signSolanaTransaction=async()=>{signatures++;};
 await assert.rejects(h.c.executeCopiedSwap('safe',h.buy,h.state),/Source token mismatch/);
 assert.equal(quotes,0);assert.equal(signatures,0);assert.equal(h.submitted.length,0);
});

test('a retry cannot sell a replacement purchase that appeared while it waited for the wallet lock',async()=>{
 const h=executionHarness();let quotes=0;
 h.c.trackedPosition=async()=>({raw:'123',cycle:'new-purchase'});
 h.c.jupiterJson=async()=>{quotes++;throw new Error('Must not quote a replacement position');};
 assert.match((await h.c.executeCopiedSwap('safe',h.sell,h.state,'old-purchase')).status,/original copied holding already closed/);
 assert.equal(quotes,0);assert.equal(h.submitted.length,0);
});

test('copy sell waits for an existing exit without requesting another sale',async()=>{
 const h=executionHarness();h.c.hasPendingMint=async()=>true;
 h.c.tokenBalanceRaw=async()=>{throw new Error('must not read while a sale is pending');};
 assert.match((await h.c.executeCopiedSwap('safe',h.sell,h.state)).status,/awaits confirmation/);
 assert.equal(h.submitted.length,0);
});
test('a sale confirmed during the balance read is reported as closed, not a mismatch',async()=>{
 const h=executionHarness();let closed=false;
 h.c.trackedPosition=async()=>({raw:closed?'0':'123',cycle:'original'});
 h.c.tokenBalanceRaw=async()=>{closed=true;return '';};
 assert.match((await h.c.executeCopiedSwap('safe',h.sell,h.state)).status,/already closed/);
 assert.equal(h.submitted.length,0);
});
test('a genuine unexplained holdings shortfall still blocks a copy sell',async()=>{
 const h=executionHarness();h.c.tokenBalanceRaw=async()=> '12';
 await assert.rejects(h.c.executeCopiedSwap('safe',h.sell,h.state),/holding differs/);
 assert.equal(h.submitted.length,0);
});
test('stuck coin shortcut only opens holdings and never submits a sale',async()=>{
 let loads=0,focus=0,scroll=0;
 const c=vm.createContext({$:()=>({focus:()=>focus++,scrollIntoView:()=>scroll++}),loadWalletCoins:async()=>loads++});
 vm.runInContext(section(script,'async function openStuckCoinSales()', '$("openStuckCoinSales")'),c);
 await c.openStuckCoinSales();assert.equal(loads,1);assert.equal(focus,1);assert.equal(scroll,1);
});
test('manual held-coin sale retains its original trader after selection changes',()=>{
 const c=vm.createContext({Set,Object,BigInt});
 vm.runInContext(section(script,'function heldCoinProfile(', 'let walletCoinsLoading'),c);
 assert.equal(c.heldCoinProfile({strategy:{activeProfile:'frog'},executionReport:{positions:{p:{wallet:'w',mint:'coin',raw:'3',profile:'safe'}}}},'w','coin'),'safe');
});

test('SOL valuation and initial funds verification overlap, with a fresh funds recheck before signing',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson;
 let releaseValue,releaseFunds,valueStarted,fundsStarted,reads=0;
 const valueReady=new Promise(r=>valueStarted=r),fundsReady=new Promise(r=>fundsStarted=r);
 const valuation=new Promise(r=>releaseValue=r),funds=new Promise(r=>releaseFunds=r);
 h.buy.leg={...h.buy.leg,inputMint:'SOL',sourceUsd:0};h.c.isQuoteMint=m=>['SOL','USDC'].includes(m);
 h.c.jupiterJson=async(path,options)=>{if(options.query?.inputMint==='SOL'){valueStarted();await valuation;return {outAmount:'50000000'};}return original(path,options);};
 h.c.profileTradeableUsdc=async()=>{reads++;if(reads===1){fundsStarted();await funds;}return 100;};
 const pending=h.c.executeCopiedSwap('safe',h.buy,h.state);
 await Promise.race([Promise.all([valueReady,fundsReady]),new Promise((_,reject)=>setTimeout(()=>reject(new Error('independent checks did not overlap')),1000))]);
 assert.equal(h.submitted.length,0);releaseValue();releaseFunds();
 assert.equal((await pending).status,'Submitted - confirmation pending');assert.equal(reads,2);
});
test('failed parallel funds verification may quote but never signs or submits a purchase',async()=>{
 const h=executionHarness();let orders=0,signed=0;
 h.c.profileTradeableUsdc=async()=>{throw new Error('unverified funds');};
 h.c.jupiterJson=async()=>{orders++;};
 h.c.signSolanaTransaction=async()=>{signed++;};
 await assert.rejects(h.c.executeCopiedSwap('safe',h.buy,h.state),/unverified funds/);
 assert.equal(orders,1);assert.equal(signed,0);assert.equal(h.submitted.length,0);
});

test('cold buy quote overlaps funds read and is rebuilt when budget reduces the size',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson,amounts=[];let release,signed=0;
 const funds=new Promise(r=>release=r);
 h.c.profileTradeableUsdc=async()=>{await funds;return 20;};
 h.c.jupiterJson=async(path,options)=>{if(options.query)amounts.push(options.query.amount);return original(path,options);};
 h.c.signSolanaTransaction=async()=>{signed++;return {signedTransactionBase64:'test'};};
 const pending=h.c.executeCopiedSwap('safe',h.buy,h.state);
 await new Promise(r=>setImmediate(r));assert.deepEqual(amounts,['50000000']);assert.equal(signed,0);
 release();const result=await pending;
 assert.deepEqual(amounts,['50000000','20000000']);assert.equal(result.copiedTradeAmount,'20000000');assert.equal(signed,1);
});
test('sell quote overlaps balance read but a shortfall prevents signing and sending',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson;let release,quoted=0,signed=0;
 const balance=new Promise(r=>release=r);
 h.c.tokenBalanceRaw=()=>balance;
 h.c.jupiterJson=async(path,options)=>{if(options.query)quoted++;return original(path,options);};
 h.c.signSolanaTransaction=async()=>{signed++;};
 const pending=h.c.executeCopiedSwap('safe',h.sell,h.state);
 await new Promise(r=>setImmediate(r));assert.equal(quoted,1);assert.equal(signed,0);
 release('0');await assert.rejects(pending,/holding differs/);
 assert.equal(signed,0);assert.equal(h.submitted.length,0);
});
test('sell quote is rebuilt when a partial exit changes the remaining position',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson,amounts=[];let raw='123';
 h.c.trackedPosition=async()=>({raw,cycle:'same'});
 h.c.tokenBalanceRaw=async()=>{raw='60';return '60';};
 h.c.jupiterJson=async(path,options)=>{if(options.query)amounts.push(options.query.amount);return original(path,options);};
 const result=await h.c.executeCopiedSwap('safe',h.sell,h.state);
 assert.deepEqual(amounts,['123','60']);assert.equal(result.copiedTradeAmount,'60');
});


test('FnZero copied buys and sells retain spending checks and Stop during signing',async()=>{
 const h=executionHarness();h.state.settings.executionEngine='fnzero';let sends=0;
 h.c.fnzeroRouter={prepare:async({query})=>({transaction:'fnzero',inAmount:query.amount,outAmount:'123',slippageBps:0,executionEngine:'fnzero'})};
 h.c.submitFnzeroOrder=async()=>{sends++;return {signature:'test',status:'Success'};};
 assert.equal((await h.c.executeCopiedSwap('safe',h.buy,h.state)).executionEngine,'fnzero');
 assert.equal((await h.c.executeCopiedSwap('safe',h.sell,h.state)).executionEngine,'fnzero');
 assert.equal(sends,2);assert.equal(h.submitted.length,0);
 h.c.signSolanaTransaction=async()=>{h.stop();return {signedTransactionBase64:'signed'};};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/stopped/);assert.equal(sends,2);
});
test('FnZero cannot use locked profit when the spendable balance changes',async()=>{
 const h=executionHarness();h.state.settings.executionEngine='fnzero';let checks=0,sends=0;
 h.c.fnzeroRouter={prepare:async({query})=>({transaction:'fnzero',inAmount:query.amount,outAmount:'123',slippageBps:0,executionEngine:'fnzero'})};
 h.c.profileTradeableUsdc=async()=>++checks===1?100:0;
 h.c.submitFnzeroOrder=async()=>{sends++;};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/locked profit protected/);assert.equal(sends,0);
});

test('SOL valuation starts during source verification, but cannot authorize an unverified buy',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson;
 let release,started=false,signed=0;
 const verification=new Promise(r=>release=r);
 h.buy.leg={...h.buy.leg,inputMint:'SOL',sourceUsd:0};h.c.isQuoteMint=m=>['SOL','USDC'].includes(m);
 h.c.verifyCopySource=async()=>{await verification;throw new Error('Source token mismatch');};
 h.c.jupiterJson=async(path,options)=>{if(options.query?.inputMint==='SOL'){started=true;return {outAmount:'50000000'};}return original(path,options);};
 h.c.signSolanaTransaction=async()=>{signed++;};
 const pending=h.c.executeCopiedSwap('safe',h.buy,h.state);
 await new Promise(r=>setImmediate(r));assert.equal(started,true);assert.equal(signed,0);
 release();await assert.rejects(pending,/Source token mismatch/);assert.equal(signed,0);assert.equal(h.submitted.length,0);
});
test('a different verified source amount requires its own valuation',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson,amounts=[];
 h.buy.leg={...h.buy.leg,inputMint:'SOL',sourceUsd:0};h.c.isQuoteMint=m=>['SOL','USDC'].includes(m);
 h.c.verifyCopySource=async()=>({leg:{...h.buy.leg,amount:'100000000'},sourceTx:{blockTime:1,slot:1}});
 h.c.jupiterJson=async(path,options)=>{if(options.query?.inputMint==='SOL'){amounts.push(options.query.amount);return {outAmount:'50000000'};}return original(path,options);};
 await h.c.executeCopiedSwap('safe',h.buy,h.state);assert.deepEqual(amounts,['50000000','100000000']);
});
test('FnZero learning cannot delay a Jupiter fallback order',async()=>{
 const h=executionHarness();h.state.settings.executionEngine='fnzero';let learned=0;
 h.c.fnzeroRouter={prepare:async()=>{throw new Error('cold route');},learn:()=>{learned++;return new Promise(()=>{});}};
 const order=await h.c.prepareTradingOrder(h.state,{inputMint:'USDC',outputMint:'COIN',amount:'100',taker:'wallet'});
 assert.equal(order.executionEngine,'jupiter');assert.equal(learned,1);assert.match(order.fnzeroFallbackReason,/background/);
});
test('buy target and backup are measured without cancelling a valid slower copy',async()=>{
 for (const elapsed of [500,501,1000,1001]) {
  const h=executionHarness();let clock=Date.now();
  h.c.Date=class extends Date {static now(){return clock;}};
  h.c.signSolanaTransaction=async()=>{clock+=elapsed;return {signedTransactionBase64:'signed',signWith:'wallet'};};
  const result=await h.c.executeCopiedSwap('safe',h.buy,h.state);
  assert.equal(h.submitted.length,1);
  assert.equal(result.speedWindow,elapsed<=500?'0.5 s target':elapsed<=1000?'1 s backup':'Buy continued after 1 s');
  assert.equal(result.timingsMs.signing,elapsed);
 }
});
test('journal delay does not cancel a valid buy, but a source sell during persistence does',async()=>{
 for(const sold of [false,true]) {
  const h=executionHarness();let clock=Date.now(),saved=0;
  h.c.Date=class extends Date {static now(){return clock;}};
  const journal={pending:{test:{}}};h.c.executionJournal={load:async()=>journal,save:async()=>{saved++;}};
  h.c.recordPendingSwap=async()=>{clock+=1001;if(sold) h.c.signalFeeds.set('safe:Helius',{profile:'safe',wallet:'wallet',transactions:[{timestamp:h.buy.timestamp+1,leg:{action:'sell',inputMint:'COIN'}}]});return 'test';};
  const result=await h.c.executeCopiedSwap('safe',h.buy,h.state);
  if(sold) {assert.match(result.status,/already sold/);assert.equal(h.submitted.length,0);assert.equal(journal.pending.test,undefined);assert.equal(saved,1);}
  else {assert.equal(h.submitted.length,1);assert.equal(result.speedWindow,'Buy continued after 1 s');assert.equal(saved,0);}
 }
});
test('cold funds cache still starts unsigned routing before source verification and never signs without funds',async()=>{
 const h=executionHarness();let release,quotes=0,signs=0;
 const wait=new Promise(r=>release=r),verify=h.c.verifyCopySource,quote=h.c.jupiterJson;
 h.c.profileSurviveMaxUsd=()=>50;h.c.cachedProfileTradeableUsdcValue=()=>null;h.c.tradeFundsFastMaxAgeMs=10000;
 h.c.verifyCopySource=async(...args)=>{await wait;return verify(...args);};
 h.c.jupiterJson=async(...args)=>{quotes++;return quote(...args);};
 h.c.profileTradeableUsdc=async()=>0;
 h.c.signSolanaTransaction=async()=>{signs++;throw new Error('must not sign');};
 const resultPromise=h.c.executeCopiedSwap('safe',h.buy,h.state);
 await new Promise(r=>setImmediate(r));assert.equal(quotes,1);assert.equal(signs,0);
 release();const result=await resultPromise;
 assert.match(result.status,/no tradeable USDC/);assert.equal(signs,0);assert.equal(h.submitted.length,0);
});
test('sell uses the backup window and remains eligible after one second',async()=>{
 for(const elapsed of [750,1500]) {
  const h=executionHarness();let clock=Date.now();h.c.Date=class extends Date {static now(){return clock;}};
  h.c.signSolanaTransaction=async()=>{clock+=elapsed;return {signedTransactionBase64:'signed',signWith:'wallet'};};
  const result=await h.c.executeCopiedSwap('safe',h.sell,h.state);
  assert.equal(h.submitted.length,1);assert.equal(result.speedWindow,elapsed<=1000?'1 s backup':'Exit continued after 1 s');
 }
});
test('route test replays the live buy path and exits before signing or submission',async()=>{
 const h=executionHarness();let signed=0,recorded=0;
 h.c.signSolanaTransaction=async()=>{signed++;throw new Error('test must never sign');};
 h.c.recordPendingSwap=async()=>{recorded++;throw new Error('test must never journal orders');};
 const result=await h.c.executeCopiedSwapLocked('safe',h.buy,h.state,false,undefined,true);
 assert.equal(result.readOnly,true);assert.equal(result.routeReady,true);
 assert.equal(result.copiedTradeAmount,'50000000');
 assert(Number.isFinite(result.timingsMs.preparationToReady));
 assert.equal(signed,0);assert.equal(recorded,0);assert.equal(h.submitted.length,0);
});
test('stopped trading can check routes while test reports the live control block',async()=>{
 const h=executionHarness();h.stop();
 h.c.signSolanaTransaction=async()=>{throw new Error('must not sign');};
 const result=await h.c.executeCopiedSwapLocked('safe',h.buy,h.state,false,undefined,true);
 assert.equal(result.routeReady,true);assert.equal(result.liveControlsReady,false);
 assert.match(result.liveControlMessage,/stopped/);assert.equal(h.submitted.length,0);
});
test('route replay keeps source verification and exact-copy funds protections',async()=>{
 const h=executionHarness();h.c.verifyCopySource=async()=>{throw new Error('Source token mismatch');};
 await assert.rejects(h.c.executeCopiedSwapLocked('safe',h.buy,h.state,false,undefined,true),/mismatch/);
 const h2=executionHarness();h2.c.profileBuyMode=()=> 'exactFull';h2.c.profileTradeableUsdc=async()=>20;
 h2.c.signSolanaTransaction=async()=>{throw new Error('must not sign');};
 const result=await h2.c.executeCopiedSwapLocked('safe',h2.buy,h2.state,false,undefined,true);
 assert.match(result.status,/insufficient/);assert.equal(result.routeReady,undefined);
 assert.equal(h2.submitted.length,0);
});
test('sell replay checks verified copied holdings but never signs an exit',async()=>{
 const h=executionHarness();h.c.signSolanaTransaction=async()=>{throw new Error('must not sign');};
 const result=await h.c.executeCopiedSwapLocked('safe',h.sell,h.state,false,undefined,true);
 assert.equal(result.routeReady,true);assert.equal(result.copiedTradeAmount,'123');assert.equal(h.submitted.length,0);
 h.c.tokenBalanceRaw=async()=> '0';
 await assert.rejects(h.c.executeCopiedSwapLocked('safe',h.sell,h.state,false,undefined,true),/holding differs/);
});

test('owner-authorized expensive copy buy can submit and its sell lane remains eligible',async()=>{
 const h=executionHarness(),original=h.c.jupiterJson;let signs=0;
 h.c.signSolanaTransaction=async()=>{signs++;return {signedTransactionBase64:'signed'};};
 h.c.jupiterJson=async(...args)=>{const r=await original(...args);if(args[1]?.query?.inputMint==='USDC')return {...r,outAmount:'100'};return r;};
 const buy=await h.c.executeCopiedSwap('safe',h.buy,h.state);
 assert.equal(buy.status,'Submitted - confirmation pending');assert.equal(signs,1);assert.equal(h.submitted.length,1);
 const sell=await h.c.executeCopiedSwap('safe',h.sell,h.state);
 assert.equal(sell.status,'Submitted - confirmation pending');assert.equal(signs,2);assert.equal(h.submitted.length,2);
});
test('a missing verified source entry blocks a buy instead of treating its price as zero',async()=>{
 const h=executionHarness();h.c.verifyCopySource=async()=>({leg:h.buy.leg,sourceTx:{blockTime:1,meta:{}}});
 h.c.signSolanaTransaction=async()=>{throw new Error('must not sign');};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/source entry price cannot be verified/);
 assert.equal(h.submitted.length,0);
});
