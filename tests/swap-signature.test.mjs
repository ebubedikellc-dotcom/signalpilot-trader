import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {inspectSwapSignature} from '../lib/swap-signature.mjs';
import vm from 'node:vm';
import fs from 'node:fs';

function fixture(sponsored=true) {
  const owner=generateKeyPairSync('ed25519'), payer=generateKeyPairSync('ed25519');
  const key=(name,pair)=>({toBase58:()=>name,toBytes:()=>pair.publicKey.export({type:'spki',format:'der'}).subarray(-32)});
  const bytes=Buffer.from('deterministic quoted swap message');
  const message={serialize:()=>bytes,staticAccountKeys:sponsored?[key('payer',payer),key('wallet',owner)]:[key('wallet',owner)],header:{numRequiredSignatures:sponsored?2:1}};
  const signature=sign(null,bytes,owner.privateKey);
  return {tx:{message,signatures:sponsored?[new Uint8Array(64),signature]:[signature]},original:{message},order:{requestId:'request-1',signatureFeePayer:sponsored?'payer':'wallet'}};
}
test('valid owner-signed sponsored swap waits for Jupiter transaction ID',()=>{
  const f=fixture();assert.equal(inspectSwapSignature(f.tx,f.original,'wallet',f.order),null);
});
test('normal wallet-paid swap retains predictable transaction ID',()=>{
  const f=fixture(false);assert.match(inspectSwapSignature(f.tx,f.original,'wallet',f.order),/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
});
test('missing or corrupted owner signature is never accepted',()=>{
  const f=fixture();f.tx.signatures[1]=new Uint8Array(64);
  assert.throws(()=>inspectSwapSignature(f.tx,f.original,'wallet',f.order),/missing or invalid/);
  f.tx.signatures[1][0]=1;
  assert.throws(()=>inspectSwapSignature(f.tx,f.original,'wallet',f.order),/missing or invalid/);
});
test('changed message and unknown sponsor are rejected',()=>{
  const f=fixture();
  assert.throws(()=>inspectSwapSignature(f.tx,{message:{serialize:()=>Buffer.from('different')}},'wallet',f.order),/differs/);
  assert.throws(()=>inspectSwapSignature(f.tx,f.original,'wallet',{...f.order,signatureFeePayer:'unknown'}),/no matching/);
});
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function journalHarness(txid=null){
  const d={pending:{},notices:{},growthGoal:{id:'goal',wallet:'wallet',status:'active'}};
  let saves=0;
  const c=vm.createContext({Date,Number,String,executionJournal:{load:async()=>d,save:async()=>{saves++;}},transactionSignature:()=>txid});
  vm.runInContext(server.slice(server.indexOf('async function hasPendingMint'),server.indexOf('async function trackedPosition')),c);
  return {c,d,saves:()=>saves};
}
test('partial order is durably reserved before execution; returned txid is persisted for confirmation',async()=>{
  const h=journalHarness();
  const key=await h.c.recordPendingSwap({wallet:'wallet',mint:'coin',side:'buy'}, {}, {requestId:'r1',inAmount:'20000000'});
  assert.equal(key,'jupiter:r1');assert.equal(h.d.pending[key].txid,null);assert.equal(h.d.pending[key].reservedUsd,20);assert.equal(h.saves(),1);
  await assert.rejects(h.c.recordPendingSwap({wallet:'wallet',mint:'coin',side:'buy'}, {}, {requestId:'r2'}),/awaits confirmation/);
  const signature='2'.repeat(88);
  await h.c.recordExecutionResponse(key,{status:'Success',signature});
  assert.equal(h.d.pending[key].txid,signature);assert.equal(h.saves(),2);
});
test('ordinary buys also reserve spending before submission',async()=>{
  const h=journalHarness();delete h.d.growthGoal;
  const key=await h.c.recordPendingSwap({wallet:'wallet',mint:'coin',side:'buy'}, {}, {requestId:'r1',inAmount:'5000000'});
  assert.equal(h.d.pending[key].reservedUsd,5);
  assert.equal(h.d.pending[key].goalId,undefined);
  await assert.rejects(h.c.recordPendingSwap({wallet:'wallet',mint:'other',side:'buy'}, {}, {requestId:'r2'}),/Cannot reserve/);
  assert.equal(Object.keys(h.d.pending).length,1);
});
test('uncertain execution retains reservation and missing signature cannot report success',async()=>{
  const h=journalHarness();const key=await h.c.recordPendingSwap({wallet:'wallet',mint:'coin',side:'buy'}, {}, {requestId:'r1',inAmount:'20000000'});
  await assert.rejects(h.c.recordExecutionResponse(key,{status:'Success'}),/valid transaction ID/);
  assert.equal(h.d.pending[key].reservedUsd,20);assert.equal(h.d.pending[key].txid,null);
});
test('normal execution cannot silently replace its expected signature',async()=>{
  const h=journalHarness('2'.repeat(88));const key=await h.c.recordPendingSwap({wallet:'wallet',mint:'coin',side:'sell'}, {}, {requestId:'r1'});
  await assert.rejects(h.c.recordExecutionResponse(key,{status:'Success',signature:'3'.repeat(88)}),/different signature/);
});

test('sponsored fees are not charged to growth cash; owner-paid rent remains counted',()=>{
  const source=fs.readFileSync(new URL('../lib/trading-journal.mjs',import.meta.url),'utf8');
  const c=vm.createContext({Number,String,Math});
  vm.runInContext(source.slice(source.indexOf('function solCost'),source.indexOf('export function')),c);
  const tx={transaction:{message:{accountKeys:['sponsor','wallet']}},meta:{fee:5000,preBalances:[10000,3000000],postBalances:[5000,3000000]}};
  assert.equal(c.solCost(tx,'wallet'),0);
  tx.meta.postBalances[1]=1000000;assert.equal(c.solCost(tx,'wallet'),0.002);
  assert.equal(c.solCost(tx,'missing'),null);
});

test('failed sponsored execution saves returned signature before reporting failure',async()=>{
 const h=journalHarness();const key=await h.c.recordPendingSwap({wallet:'wallet',mint:'coin',side:'sell'}, {}, {requestId:'r1'});
 const signature='2'.repeat(88);
 await assert.rejects(h.c.recordExecutionResponse(key,{status:'Failed',code:-1000,errorMessage:'Slippage tolerance exceeded',signature}),/checking chain/);
 assert.equal(h.d.pending[key].txid,signature);assert.match(h.d.notices[key],/checking chain/);
});
test('failed execution without a receipt retains its reservation',async()=>{
 const h=journalHarness();const key=await h.c.recordPendingSwap({wallet:'wallet',mint:'coin',side:'sell'}, {}, {requestId:'r1'});
 await assert.rejects(h.c.recordExecutionResponse(key,{status:'Failed',code:-1001}),/checking chain/);
 assert.equal(h.d.pending[key].txid,null);
});
