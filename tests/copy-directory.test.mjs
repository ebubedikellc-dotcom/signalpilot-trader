import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {Keypair} from '@solana/web3.js';
import {addCopyAccount,addCopyTrader,registeredSolanaTraders,prepareOwnerStart,startReadiness} from '../lib/copy-directory.mjs';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const section=(a,b)=>server.slice(server.indexOf(a),server.indexOf(b,server.indexOf(a)));
test('new broker entries are setup records, never connected accounts or funded actions',()=>{
 const {directory,account}=addCopyAccount({}, {name:'Gold demo',market:'gold',platform:'ctrader',mode:'demo',broker:'Synthetic broker',password:'MUST-NOT-SAVE',balance:100});
 assert.equal(account.status,'connection_required');assert.equal(account.password,undefined);assert.equal(account.balance,undefined);
 const r=addCopyTrader(directory,{name:'Gold candidate',market:'gold',profileUrl:'https://example.test/strategy',accountId:account.id});
 assert.equal(r.trader.status,'connection_required');assert.equal(r.trader.feeStatus,'unverified');assert.equal(registeredSolanaTraders(r.directory).length,0);
 assert.throws(()=>addCopyTrader(directory,{name:'Forex candidate',market:'forex',profileUrl:'https://example.test/strategy',accountId:account.id}),/saved account/);
});
test('new Solana sources require valid distinct public wallets and no credentials in links',()=>{
 const wallet=Keypair.generate().publicKey.toBase58();
 const r=addCopyTrader({}, {name:'Test source',market:'solana',wallet});
 assert.equal(registeredSolanaTraders(r.directory)[0].wallet,wallet);assert.equal(r.trader.accountId,'existing-solana');
 assert.throws(()=>addCopyTrader(r.directory,{name:'Second name',market:'solana',wallet}),/already/);
 assert.throws(()=>addCopyTrader({}, {name:'Frog',market:'solana',wallet}),/already/);
 assert.throws(()=>addCopyTrader({}, {name:'Test',market:'solana',wallet:'invalid'}),/valid/);
 for(const profileUrl of ['http://example.test','https://secret:password@example.test'])assert.throws(()=>addCopyTrader({}, {name:'Gold',market:'gold',profileUrl}));
});
test('boot reset preserves balances, keys, limits and active choice but stops every saved profile',()=>{
 const state={settings:{key:'synthetic',frogSurviveMax:'10'},strategy:{activeProfile:'safe',controlRevision:500},profiles:{safe:{running:true},custom:{running:true}},trades:[{id:1}],copyDirectory:{accounts:[]}};
 prepareOwnerStart(state,100);assert.equal(state.strategy.controlRevision,501);assert.equal(state.strategy.activeProfile,'safe');assert(Object.values(state.profiles).every(p=>!p.running));assert.equal(state.settings.key,'synthetic');assert.equal(state.settings.frogSurviveMax,'10');assert.equal(state.trades.length,1);
});
function startHarness({funds=5,allowed=true,mode='yes',feedError}={}) {
 let disk={settings:{copyConnection:'public',modesConfirmed:mode},profiles:{safe:{running:false}},strategy:{activeProfile:'safe',controlRevision:1},activity:[]},response;
 const calls=[];
 const c=vm.createContext({process:{env:{ENABLE_LIVE_TRADING:'true',EXECUTE_REAL_SWAPS:'true'}},startReadiness,queueStartPending:false,routeReplayBusy:false,fnzeroTestBusy:false,emergencyStopRequested:false,Date,Number,Math,
  readState:async()=>structuredClone(disk),saveState:async s=>{disk=structuredClone(s);},requireOwner:()=>false,sessionFromRequest:()=>({role:'owner'}),ready:()=>true,liveTradingAllowed:()=>allowed,
  statusPayload:s=>s,send:(_,code,body)=>response={code,body},supportedProfiles:['safe'],profileLabel:()=> 'Synthetic source',line:x=>x,
  assertHeliusReadyForProfile:async()=>{calls.push('feed');if(feedError)throw Error(feedError);},withWalletOperation:f=>f(),tradeWallet:()=> 'no-funded-wallet',solanaConnection:()=>({}),
  profileTradeableUsdc:async()=>{calls.push('budget');return funds;},beginTradingSession:s=>{s.strategy.buySessionStartedAt=Date.now();}});
 vm.runInContext('async function run(request,response,url){'+section('  if (request.method === "POST" && url.pathname === "/api/queue/start")','  if (request.method === "POST" && url.pathname === "/api/queue/stop")')+'}',c);
 return {c,calls,get state(){return disk;},get response(){return response;},changeControls:()=>{disk.strategy.controlRevision++;c.emergencyStopRequested=true;},run:()=>c.run({method:'POST'},{},{pathname:'/api/queue/start'})};
}
test('explicit Start enables only after feed and budget checks, without submitting any trade in the handler',async()=>{
 const h=startHarness();await h.run();assert.equal(h.response.code,200);assert.equal(h.state.profiles.safe.running,true);assert(h.state.strategy.buySessionStartedAt);assert.deepEqual(h.calls,['feed','budget']);
});
test('unavailable funds, feed, unsaved mode and permission keep the queue stopped',async()=>{
 for(const args of [{funds:0},{feedError:'RPC unavailable'},{mode:'no'},{allowed:false}]){const h=startHarness(args);await h.run();assert.equal(h.response.code,409);assert.equal(h.state.profiles.safe.running,false);}
});
test('Stop while Start is checking cancels activation; concurrent Starts cannot both proceed',async()=>{
 const h=startHarness();let release;h.c.assertHeliusReadyForProfile=()=>new Promise(r=>release=r);
 const first=h.run();await new Promise(r=>setImmediate(r));await h.run();assert.equal(h.response.code,409);assert.match(h.response.body.error,/already/);
 h.changeControls();release();await first;assert.equal(h.response.code,409);assert.match(h.response.body.error,/cancelled/);assert.equal(h.state.profiles.safe.running,false);assert.equal(h.c.queueStartPending,false);
});
test('route checks prevent Start and release no state change',async()=>{
 const h=startHarness();h.c.routeReplayBusy=true;await h.run();assert.equal(h.response.code,409);assert.equal(h.calls.length,0);assert.equal(h.state.profiles.safe.running,false);
});
test('custom source attribution and shared sizing use the selected trader and existing owner limits',()=>{
 const id='copy_00000000-0000-0000-0000-000000000001',customTraderNames=new Map([[id,'Synthetic source']]);
 const c=vm.createContext({supportedProfiles:['safe','frog','truenest',id],customTraderNames});
 vm.runInContext(section('function profileSetting(','function profileWalletSync(')+section('function profileFromTrade(','function tradeIsBuyExecutionFailure(')+section('function roomMatchesProfile(','async function autoSellStuckTokenAfterSellSignal('),c);
 const s={settings:{[id+'Wallet']:'source',frogWallet:'different-source',frogBuyMode:'exact',frogLiveTradingSwitch:'on'}};
 assert.equal(c.profileSetting(s,id,'wallet'),'source');assert.equal(c.profileSetting(s,id,'buyMode'),'exact');assert.equal(c.profileFromTrade({profileId:id}),id);assert.equal(c.roomMatchesProfile({profileId:id},'safe'),false);assert.equal(c.roomMatchesProfile({profileId:id},id),true);
});
