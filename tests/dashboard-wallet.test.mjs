import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardWalletBalances} from '../lib/dashboard-wallet.mjs';
test('hung wallet reads finish with explicit unavailable balances instead of zero',async()=>{
 const fallback={frog:{address:'wallet',usdc:null,sol:null,error:'Provider unavailable'}};
 assert.equal(await dashboardWalletBalances(()=>new Promise(()=>{}),fallback,10),fallback);
});
test('successful and failed wallet reads settle promptly',async()=>{
 const fallback={error:'Unavailable'},verified={frog:{usdc:193.58}};
 assert.equal(await dashboardWalletBalances(async()=>verified,fallback,100),verified);
 assert.equal(await dashboardWalletBalances(async()=>{throw Error('429')},fallback,100),fallback);
});
test('timing out the display does not cancel shared verification for later refreshes',async()=>{
 let resolve;const shared=new Promise(r=>resolve=r),fallback={error:'Not verified'};
 assert.equal(await dashboardWalletBalances(()=>shared,fallback,10),fallback);
 const verified={frog:{usdc:193.58}};resolve(verified);
 assert.equal(await dashboardWalletBalances(()=>shared,fallback,100),verified);
});
