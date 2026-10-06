import {rpcProvider,monitoredProfiles} from '../lib/rpc-provider.mjs';
import { sellFraction, proportionalAmount } from '../lib/position-accounting.mjs';
import { canonicalSignalId } from "../lib/direct-signals.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
test('simple speed test is fake only and cannot sign or submit trades',()=>{
 const endpoint=section(server,'  if (request.method === "POST" && url.pathname === "/api/simple-speed-test")','  if (request.method === "POST" && url.pathname === "/api/fnzero/coins")');
 assert.match(endpoint,/requireOwner/);
 assert.match(endpoint,/Fake buy and fake sell/);
 assert.doesNotMatch(endpoint,/signSolanaTransaction|executeTradingOrder|sendRawTransaction|jupiterJson|fnzeroRouter/);
 assert.doesNotMatch(script,/fnzeroMint|fnzeroCoin|fnzeroSide|testFnzero/);
 assert.match(script,/runSimpleSpeedTest/);
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
 const c=vm.createContext({Date,BigInt,Number,emergencyStopRequested:false,canonicalSignalId,sellFraction,proportionalAmount,
 verifyCopySource:async(_,t)=>({leg:t.leg,sourceTx:{blockTime:1,slot:1,meta:{preTokenBalances:[{owner:"wallet",mint:"COIN",uiTokenAmount:{amount:"123"}}],postTokenBalances:[]}},verifiedAt:new Date().toISOString()}),
 trackedPosition:async()=>({raw:'123'}),hasPendingMint:async()=>false,recordPendingSwap:async()=> 'test',recordExecutionResponse:async()=>{},supportedProfiles:['safe'],signalFeeds:new Map(),targetWallet:()=> 'wallet',
 readState:async()=>({...state,profiles:{safe:{running:!stopped}}}),primarySwapLeg:t=>t.leg,
 tradeWallet:()=> 'wallet',signerId:()=> 'wallet',jupiterApiKey:()=> 'test',solanaConnection:()=>({getParsedTransaction:async()=>({meta:{preTokenBalances:[{owner:'wallet',mint:'COIN',uiTokenAmount:{amount:'123'}}],postTokenBalances:[]}})}),
 scaledCopyAmount:()=>({amount:'1'}),isQuoteMint:m=>m==='USDC',usdcMint:'USDC',profileSellOnly:()=>false,
 buyUsdAmount:()=>50,profileTradeableUsdc:async()=>100,profileBuyMode:()=> 'cap50',usdcRawFromUsd:x=>String(Math.floor(x*1e6)),
 tokenBalanceRaw:async()=> '123',profileCopySizing:()=> 'test',
 signSolanaTransaction:async()=>({signedTransactionBase64:'signed',signWith:'wallet'}),
 jupiterJson:async(path,options)=>{if(path.includes('execute')){submitted.push(options);return {signature:'test'}}return {transaction:'test',inAmount:options.query.amount,outAmount:'123'}}});
 vm.runInContext(section(server,'const walletJobs =','async function readProfitReserves'),c);
 vm.runInContext(section(server,'// Poll cadence','function transactionSignature('),c);
 const buy={timestamp:Date.now()/1000-1,leg:{action:'buy',inputMint:'USDC',outputMint:'COIN',amount:'50000000',sourceUsd:50}};
 const sell={timestamp:1,leg:{action:'sell',inputMint:'COIN',outputMint:'USDC',amount:'123'}};
 return {c,state,buy,sell,submitted,stop:()=>{stopped=true}};
}
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
  return {transaction:'test',inAmount:options.query.amount,outAmount:'123'};
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
 const c=vm.createContext({Date,Map,Set,Promise,monitoredProfiles,executionReport:null,syncLiveSubscriptions:async()=>{},wakeCopyWorker:async()=>{},wakeSellWorker:async()=>{},supportedProfiles:['safe'],
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
test('direct alerts use public Solana without spending Helius credits and retain traders with holdings',async()=>{
 const callbacks=new Map();const removed=[];let id=0;
 const c=vm.createContext({Map,Set,Date,process:{env:{}},rpcProvider,monitoredProfiles,executionReport:{positions:{old:{profile:'safe',raw:'1'}},pending:{}},supportedProfiles:['safe','frog','truenest'],PublicKey:class{constructor(x){this.value=x}},
 targetWallet:(_,p)=>p,solanaConnection:()=>({onLogs:(wallet,cb)=>{callbacks.set(wallet.value,cb);return ++id},removeOnLogsListener:async n=>removed.push(n)})});
 vm.runInContext(section(server,'let wakeCopyWorker =','const signalFeeds ='),c);
 const state={profiles:{safe:{running:true}},settings:{heliusKey:'test'},strategy:{activeProfile:'safe'}};
 await c.syncLiveSubscriptions(state);assert.equal(callbacks.size,1);
 state.strategy.activeProfile='frog';await c.syncLiveSubscriptions(state);assert.equal(id,2);assert.equal(removed.length,0);
 state.profiles.safe.running=false;await c.syncLiveSubscriptions(state);assert.equal(removed.length,2);
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
 rpcConnections:new Map(),gmgnConnectionCheck:null,observationUntil:0,feedHealth:()=>[],liveSubscriptions:new Map(),customerPublic:x=>x});
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
 const h=executionHarness();let reads=0;
 h.c.trackedPosition=async()=>++reads===1?{raw:'123',cycle:'original'}:{raw:'0',cycle:'original'};
 h.c.tokenBalanceRaw=async()=>'';
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
test('failed parallel funds verification never builds or submits a purchase',async()=>{
 const h=executionHarness();let orders=0;
 h.c.profileTradeableUsdc=async()=>{throw new Error('unverified funds');};
 h.c.jupiterJson=async()=>{orders++;};
 await assert.rejects(h.c.executeCopiedSwap('safe',h.buy,h.state),/unverified funds/);
 assert.equal(orders,0);assert.equal(h.submitted.length,0);
});


test('FnZero copied buys and sells retain spending checks and Stop during signing',async()=>{
 const h=executionHarness();h.state.settings.executionEngine='fnzero';let sends=0;
 h.c.fnzeroRouter={prepare:async({query})=>({transaction:'fnzero',inAmount:query.amount,outAmount:'123',executionEngine:'fnzero'})};
 h.c.submitFnzeroOrder=async()=>{sends++;return {signature:'test',status:'Success'};};
 assert.equal((await h.c.executeCopiedSwap('safe',h.buy,h.state)).executionEngine,'fnzero');
 assert.equal((await h.c.executeCopiedSwap('safe',h.sell,h.state)).executionEngine,'fnzero');
 assert.equal(sends,2);assert.equal(h.submitted.length,0);
 h.c.signSolanaTransaction=async()=>{h.stop();return {signedTransactionBase64:'signed'};};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/stopped/);assert.equal(sends,2);
});
test('FnZero cannot use locked profit when the spendable balance changes',async()=>{
 const h=executionHarness();h.state.settings.executionEngine='fnzero';let checks=0,sends=0;
 h.c.fnzeroRouter={prepare:async({query})=>({transaction:'fnzero',inAmount:query.amount,outAmount:'123',executionEngine:'fnzero'})};
 h.c.profileTradeableUsdc=async()=>++checks===1?100:0;
 h.c.submitFnzeroOrder=async()=>{sends++;};
 assert.match((await h.c.executeCopiedSwap('safe',h.buy,h.state)).status,/locked profit protected/);assert.equal(sends,0);
});
