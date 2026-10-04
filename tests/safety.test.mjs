import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
test('buy deadline: late, missing and future timestamps fail closed',()=>{
 const c=vm.createContext({Date});
 vm.runInContext(section(server,'const buyFreshnessLimitMs','async function executeCopiedSwap('),c);
 assert.equal(c.buyFreshnessError({timestamp:100},100500),'');
 assert.match(c.buyFreshnessError({timestamp:100},100501),/blocked/);
 assert.match(c.buyFreshnessError({},100000),/unavailable/);
 assert.match(c.buyFreshnessError({timestamp:101},100000),/clock/);
});
test('expired buy never submits, including expiry during signing; an old sell still submits',async()=>{
 let now=100000, action='buy', submitted=0;
 class Clock extends Date { static now(){return now;} }
 const state={profiles:{safe:{running:true}},strategy:{activeProfile:'safe'},settings:{}};
 const c=vm.createContext({Date:Clock,BigInt,supportedProfiles:['safe'],readState:async()=>state,
 primarySwapLeg:()=>({action,inputMint:action==='buy'?'USDC':'COIN',outputMint:action==='buy'?'COIN':'USDC',amount:'50000000',sourceUsd:50}),
 tradeWallet:()=> 'wallet',signerId:()=> 'wallet',jupiterApiKey:()=> 'test',solanaConnection:()=>({}),
 scaledCopyAmount:()=>({amount:'1'}),isQuoteMint:m=>m==='USDC',usdcMint:'USDC',profileSellOnly:()=>false,
 buyUsdAmount:()=>50,profileTradeableUsdc:async()=>100,profileBuyMode:()=> 'cap50',usdcRawFromUsd:()=> '50000000',
 tokenBalanceRaw:async()=> '123',profileCopySizing:()=> 'test',
 signSolanaTransaction:async()=>{now=100600;return {signedTransactionBase64:'test',signWith:'wallet'}},
 jupiterJson:async(path)=>{if(path.includes('execute')){submitted++;return {signature:'test'}}return {transaction:'test',inAmount:'50000000',outAmount:'123'}}});
 vm.runInContext(section(server,'const buyFreshnessLimitMs','async function executeManualTokenSell('),c);
 assert.match((await c.executeCopiedSwapLocked('safe',{timestamp:100},state)).status,/blocked/);assert.equal(submitted,0);
 action='sell';assert.equal((await c.executeCopiedSwapLocked('safe',{timestamp:1},state)).status,'Executed');assert.equal(submitted,1);
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
test('a slow GMGN request does not prevent independent Helius delivery',async()=>{
 const c=vm.createContext({Date,Map,Set,Promise,supportedProfiles:['safe'],
 readState:async()=>({profiles:{safe:{running:true}},settings:{heliusKey:'test',gmgnApiKey:'test'}}),
 targetWallet:()=> 'wallet',process:{env:{}},fetchTransactionsForAddress:async()=>[{signature:'new',timestamp:1}],
 fetchGmgnTransactionsForAddress:()=>new Promise(()=>{})});
 vm.runInContext(section(server,'const signalFeeds =','async function runCopyWorkerOnce()'),c);
 await c.pollSignalFeeds(); await new Promise(resolve=>setImmediate(resolve));
 const health=c.feedHealth(); assert.equal(health.find(f=>f.source==='Helius').status,'Connected');assert.equal(health.find(f=>f.source==='GMGN').status,'Connecting');
});
test('stale worker cannot resume stopped trading',async()=>{
 let disk={strategy:{controlRevision:20},profiles:{safe:{running:false}}},temp;
 const c=vm.createContext({readFile:async()=>JSON.stringify(disk),writeFile:async(_,v)=>{temp=v},rename:async()=>{disk=JSON.parse(temp)},mkdir:async()=>{},dataFile:'test',dataDir:'.',supportedProfiles:['safe']});
 vm.runInContext(section(server,'let stateSaveQueue =','async function readBody'),c);
 await c.saveState({strategy:{controlRevision:10},profiles:{safe:{running:true}}});
 assert.equal(disk.profiles.safe.running,false);
});
