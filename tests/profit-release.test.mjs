import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {profitLockFloor,releaseProfitReserve} from '../lib/profit-release.mjs';
const requestId='release-request-0001';
test('partial release preserves remaining profit and is not immediately locked again',()=>{
 const {reserve}=releaseProfitReserve({lockedUsd:185.58},{amountUsd:'20.00',requestId,cash:193.58,now:'now'});
 assert.equal(reserve.lockedUsd,165.58);assert.equal(reserve.releasedUsd,20);
 assert.equal(Math.max(reserve.lockedUsd,profitLockFloor(193.58,100,reserve.releasedUsd)),165.58);
 assert.equal(Math.round((193.58-reserve.lockedUsd)*100)/100,28);
 assert.equal(profitLockFloor(300,100,reserve.releasedUsd),180);
});
test('retries after reserve persistence cannot release twice',()=>{
 const first=releaseProfitReserve({lockedUsd:185.58},{amountUsd:'20',requestId,cash:193.58,now:'now'});
 const reloaded=JSON.parse(JSON.stringify(first.reserve));
 const retry=releaseProfitReserve(reloaded,{amountUsd:'20',requestId,cash:193.58,now:'later'});
 assert.equal(retry.duplicate,true);assert.equal(retry.reserve.lockedUsd,165.58);
 assert.throws(()=>releaseProfitReserve(reloaded,{amountUsd:'30',requestId,cash:193.58,now:'later'}),/already used/);
});
test('invalid, oversized and unverifiable releases fail closed',()=>{
 for(const amountUsd of ['0','-1','1.001','NaN','186',20])
  assert.throws(()=>releaseProfitReserve({lockedUsd:185.58},{amountUsd,requestId,cash:193.58,now:'now'}));
 assert.throws(()=>releaseProfitReserve({lockedUsd:185.58},{amountUsd:'20',requestId,cash:10,now:'now'}));
 assert.throws(()=>releaseProfitReserve({lockedUsd:185.58},{amountUsd:'20',requestId,cash:NaN,now:'now'}));
});
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
function harness() {
 const state={settings:{},strategy:{},profiles:{safe:{running:false}},activity:[]};
 const reserves={wallet:{lockedUsd:185.58}};const journal={pending:{}};
 let saved=0,invalidated=0,cash=193.58,owner=true;
 const c=vm.createContext({Date,Math,Number,Object,releaseProfitReserve,supportedProfiles:['safe'],
  readState:async()=>state,readBody:async r=>r.body,sessionFromRequest:()=>({}),requireOwner:()=>!owner,
  withWalletOperation:async f=>f(),tradeWallet:()=> 'wallet',executionJournal:{load:async()=>journal},
  tokenUiBalance:async()=>cash,solanaConnection:()=>({}),usdcMint:'USDC',protectProfit:async()=>{},
  readProfitReserves:async()=>reserves,saveProfitReserves:async()=>saved++,invalidateWalletBudget:()=>invalidated++,
  saveState:async()=>{},line:x=>x,statusPayload:s=>s,send:(_,code,body)=>{c.output={code,body}}});
 const start=server.indexOf('async function handleApi('),end=server.indexOf('function serveFile(',start);
 vm.runInContext(server.slice(start,end),c);
 return {state,journal,reserves,setOwner:x=>owner=x,setCash:x=>cash=x,saved:()=>saved,invalidated:()=>invalidated,
  run:async()=>{await c.handleApi({method:'POST',body:{amountUsd:'20',requestId}},{},{pathname:'/api/profit/release'});return c.output;}};
}
test('owner release only changes reserve, clears cached budget and leaves trading stopped',async()=>{
 const h=harness();const r=await h.run();assert.equal(r.code,200);assert.equal(h.saved(),1);assert.equal(h.invalidated(),1);
 assert.equal(h.state.profiles.safe.running,false);assert.equal(h.reserves.wallet.lockedUsd,165.58);
 await h.run();assert.equal(h.saved(),1);
});
test('running, pending and growth-plan wallets cannot release reserves',async()=>{
 const h=harness();h.state.profiles.safe.running=true;assert.equal((await h.run()).code,409);
 h.state.profiles.safe.running=false;h.journal.pending.x={wallet:'wallet'};assert.equal((await h.run()).code,409);
 h.journal.pending={};h.journal.growthGoal={};assert.equal((await h.run()).code,409);assert.equal(h.saved(),0);
});
test('release requires owner access and verified wallet cash',async()=>{
 const h=harness();h.setOwner(false);await h.run();assert.equal(h.saved(),0);
 h.setOwner(true);h.setCash(NaN);assert.equal((await h.run()).code,409);assert.equal(h.saved(),0);
});
