import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { availableCachedCash } from '../lib/wallet-budget.mjs';
import { growthSnapshot, growthTradeable } from '../lib/growth-goal.mjs';
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const section = (s,a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const sample = () => ({wallet:'wallet',cash:100,fillIds:new Set(['old'])});
test('cached cash reserves pending buys across profiles and ignores unobserved sell proceeds', () => {
  const journal = {pending:{a:{wallet:'wallet',side:'buy',profile:'safe',reservedUsd:20},
    b:{wallet:'wallet',side:'buy',profile:'frog',reservedUsd:30},
    c:{wallet:'other',side:'buy',reservedUsd:90}},
    fills:[{wallet:'wallet',txid:'old',side:'buy',usd:10},
      {wallet:'wallet',txid:'sale',side:'sell',usd:80}]};
  assert.equal(availableCachedCash(sample(),journal),50);
  delete journal.pending.a;
  journal.fills.push({wallet:'wallet',txid:'confirmed',side:'buy',usd:20});
  assert.equal(availableCachedCash(sample(),journal),50);
  delete journal.pending.b; // Expired, never spent.
  assert.equal(availableCachedCash(sample(),journal),80);
});
test('unknown spending blocks cached cash and rounding never adds spendable money', () => {
  assert.equal(availableCachedCash(sample(),{pending:{a:{wallet:'wallet',side:'buy'}}}),0);
  assert.equal(availableCachedCash(sample(),{fills:[{wallet:'wallet',txid:'new',side:'buy',usd:NaN}]}),0);
  assert.equal(availableCachedCash(sample(),{pending:{a:{wallet:'wallet',side:'buy',reservedUsd:100.01}}}),0);
});
function harness() {
  const journal={pending:{},fills:[]}, reserves={wallet:{lockedUsd:60}};
  const state={settings:{profitMode:'lock'},strategy:{activeProfile:'safe'},profiles:{safe:{running:true}}};
  const c=vm.createContext({Date,Map,Set,Number,JSON,Promise,availableCachedCash,growthSnapshot,growthTradeable,
    executionJournal:{load:async()=>journal},readProfitReserves:async()=>reserves,
    profileDepositUsd:()=>100,tokenUiBalance:async()=>100,
    protectProfit:async()=>reserves.wallet.lockedUsd,readState:async()=>state,
    supportedProfiles:['safe'],tradeWallet:()=> 'wallet',solanaConnection:()=>({}),
    usdcMint:"USDC",budgetWarmMaxAgeMs:5000});
  vm.runInContext(section(server,'const walletJobs =','async function readProfitReserves'),c);
  vm.runInContext(section(server,'const tradeableUsdcCache =','function profileTraderBankrollUsd'),c);
  return {c,journal,reserves,state};
}
test('pending and confirmed buys reduce a warmed budget and locked profit stays excluded',async()=>{
  const h=harness();assert.equal(await h.c.profileTradeableUsdc({},h.state,'safe','wallet'),40);
  h.journal.pending.a={wallet:'wallet',side:'buy',reservedUsd:25};
  assert.equal(await h.c.cachedProfileTradeableUsdc({},h.state,'safe','wallet'),15);
  delete h.journal.pending.a;h.journal.fills.push({wallet:'wallet',txid:'a',side:'buy',usd:25});
  assert.equal(h.c.cachedProfileTradeableUsdcValue(h.state,'safe','wallet'),15);
  h.reserves.wallet.lockedUsd=70;
  assert.equal(h.c.cachedProfileTradeableUsdcValue(h.state,'safe','wallet'),5);
  h.c.invalidateWalletBudget('wallet');
  assert.equal(h.c.cachedProfileTradeableUsdcValue(h.state,'safe','wallet'),null);
});
test('a slow background balance read does not hold the wallet queue',async()=>{
  const h=harness();let release,started;
  const wait=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  h.c.tokenUiBalance=async()=>{started();await wait;return 100;};
  const warm=h.c.warmTradeableUsdcCache();await ready;
  assert.equal(await h.c.withWalletOperation(async()=> 'sell can run',100),'sell can run');
  h.journal.pending.a={wallet:'wallet',side:'buy',reservedUsd:10};
  release();await warm;
  assert.equal(h.c.cachedProfileTradeableUsdcValue(h.state,'safe','wallet'),null);
});
test('withdrawal invalidation rejects an in-flight background sample',async()=>{
  const h=harness();let release,started;
  const wait=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  h.c.tokenUiBalance=async()=>{started();await wait;return 100;};
  const warm=h.c.warmTradeableUsdcCache();await ready;h.c.invalidateWalletBudget('wallet');
  release();await warm;
  assert.equal(h.c.cachedProfileTradeableUsdcValue(h.state,'safe','wallet'),null);
});
test('trading tape renders actual submission and blocked-decision timings without crashing',()=>{
  const tape={innerHTML:'',rows:[],appendChild(row){this.rows.push(row);}};
  const c=vm.createContext({Number,Math,$:()=>tape,profileName:()=> 'Frog',profileTradeMatches:()=>true,
    document:{createElement:()=>({})},escapeHtml:s=>String(s),money:n=>String(n)});
  vm.runInContext(section(script,'function renderWatchTape(','function renderLiveWatch('),c);
  c.renderWatchTape('frog',[{execution:{timingsMs:{sourceVerification:12,signing:45,detectionToSubmit:510}}},
    {execution:{timingsMs:{detectionToDecision:1000}}},{status:'Observed'}]);
  assert.match(tape.rows[0].innerHTML,/Detect to submit: 510ms/);
  assert.match(tape.rows[0].innerHTML,/Sign: 45ms/);
  assert.match(tape.rows[1].innerHTML,/Detect to blocked decision: 1000ms/);
  assert.equal(tape.rows.length,3);
});
