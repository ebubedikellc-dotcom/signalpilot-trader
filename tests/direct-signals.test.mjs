import test from 'node:test';
import {directMonitoringEnabled} from '../lib/rpc-provider.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {decodeDirectSwap,verifySourceSignal,canonicalSignalId} from '../lib/direct-signals.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/source-swaps.json',import.meta.url)));
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const section=(a,b)=>server.slice(server.indexOf(a),server.indexOf(b,server.indexOf(a)));
const SOL='So11111111111111111111111111111111111111112';
for(const [i,row] of fixtures.entries())test(`recorded source swap ${i}: ${row.expectedSide} has the correct mint and exact token units`,()=>{
 const t=decodeDirectSwap(row.transaction,row.wallet,row.signature,'2026-10-04T01:00:00Z');assert(t);
 const swap=t.events.swap,input=swap.tokenInputs[0],output=swap.tokenOutputs[0];
 assert.equal(row.expectedSide==='buy'?input.mint:output.mint,SOL);
 assert.equal(row.expectedSide==='buy'?output.mint:input.mint,row.expectedMint);
 const token=row.expectedSide==='buy'?output:input;
 const pre=row.transaction.meta.preTokenBalances.find(x=>x.owner===row.wallet&&x.mint===row.expectedMint);
 const post=row.transaction.meta.postTokenBalances.find(x=>x.owner===row.wallet&&x.mint===row.expectedMint);
 const delta=BigInt(post?.uiTokenAmount.amount||0)-BigInt(pre?.uiTokenAmount.amount||0);
 assert.equal(token.rawTokenAmount.tokenAmount,String(delta<0n?-delta:delta));
 assert.equal(t.detectedAt,'2026-10-04T01:00:00Z');
 if(row.expectedSide==='buy')assert.equal(input.rawTokenAmount.tokenAmount,'3000010000');
});
test('failed transactions, plain transfers and logs from an unknown program are not decoded as swaps',()=>{
 const r=fixtures[0];let tx=structuredClone(r.transaction);tx.meta.err={failed:1};assert.equal(decodeDirectSwap(tx,r.wallet,r.signature),null);
 tx=structuredClone(r.transaction);tx.meta.logMessages=['Program log: Instruction: SellV2'];assert.equal(decodeDirectSwap(tx,r.wallet,r.signature),null);
 tx=structuredClone(r.transaction);tx.meta.logMessages=['Program FakeProgram invoke [1]','Program log: Instruction: SellV2','Program FakeProgram success'];assert.equal(decodeDirectSwap(tx,r.wallet,r.signature),null);
 assert.equal(decodeDirectSwap(r.transaction,'unrelated-wallet',r.signature),null);
});
test('canonical transaction identity joins GMGN and direct notifications without merging unrelated activities',()=>{
 const signature=fixtures[0].signature;
 assert.equal(canonicalSignalId(`gmgn:${signature}`),canonicalSignalId(signature));
 assert.equal(canonicalSignalId('gmgn:timestamp:buy:coin'),'gmgn:timestamp:buy:coin');
});
function harness(running=true) {
 const row=fixtures[0],feeds=new Map();let reads=0;
 const state={profiles:{safe:{running}},settings:{}};
 const sub={connection:{getParsedTransaction:async()=>{reads++;return row.transaction}}};
 const c=vm.createContext({Map,Set,Date,Number,Math,setTimeout,clearTimeout,directMonitoringEnabled,directReadRetryMs:10,process:{env:{}},solanaConnection:()=>sub.connection,decodeDirectSwap,signalFeeds:feeds,supportedProfiles:['safe'],readState:async()=>state,targetWallet:()=>row.wallet,sub,wallet:row.wallet});
 vm.runInContext(section('let wakeCopyWorker =','const signalFeeds ='),c);
 vm.runInContext('liveSubscriptions.set(wallet,sub)',c);
 return {c,sub,state,feeds,row,reads:()=>reads};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('duplicate notifications fetch once and deliver directly without a history feed',async()=>{
 const h=harness();h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);await flush();
 assert.equal(h.reads(),1);assert.equal(h.feeds.get('safe:Solana live').transactions[0].signature,h.row.signature);
 h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);await flush();assert.equal(h.reads(),1);
});
test('stopped trading suppresses direct reads; stopping during a read discards its delivery',async()=>{
 let h=harness(false);h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);await flush();assert.equal(h.reads(),0);assert.equal(h.feeds.size,0);
 h=harness();let release;h.sub.connection.getParsedTransaction=()=>new Promise(r=>release=r);
 h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);await flush();h.state.profiles.safe.running=false;release(h.row.transaction);await flush();assert.equal(h.feeds.size,0);
});
test('read-only observation can decode activity while the execution worker remains stopped',async()=>{
 const h=harness(false);vm.runInContext('observationUntil=Date.now()+45000',h.c);
 h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);await flush();assert.equal(h.reads(),1);assert.equal(h.feeds.size,1);
 vm.runInContext(section('async function runCopyWorkerOnce()','function startCopyWorker()'),h.c);
 // Missing execution dependencies deliberately fail if the worker passes its stopped guard.
 await h.c.runCopyWorkerOnce();assert.equal(h.state.profiles.safe.running,false);
});
test('direct read diagnostics remove RPC credentials and endpoint URLs',()=>{
 const h=harness();const result=h.c.directReadFailure(new Error('RPC failed https://example.test/?api-key=secret-key secret-key'),{heliusKey:'secret-key'});
 assert(!result.includes('secret-key'));assert(!result.includes('https://'));assert(result.includes('RPC failed'));
});
test('direct lookup accepts version 1 transactions as well as older recorded swaps',async()=>{
 const h=harness();h.sub.connection.getParsedTransaction=async(_,config)=>{
  if(config.maxSupportedTransactionVersion<1)throw new Error('Transaction version (1) is not supported');
  return {...h.row.transaction,version:1};
 };
 h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);await flush();
 assert.equal(h.feeds.get('safe:Solana live').transactions[0].signature,h.row.signature);
 assert.equal(h.feeds.get('safe:Solana live').error,'');
});

const multihop=JSON.parse(fs.readFileSync(new URL('./fixtures/multihop-source-swap.json',import.meta.url)));
test('real routed swap uses the final token received, never its zero-balance intermediate token',()=>{
 const decoded=decodeDirectSwap(multihop.transaction,multihop.wallet,multihop.signature);
 assert(decoded);assert.equal(decoded.events.swap.tokenOutputs[0].mint,multihop.expectedMint);
 assert.throws(()=>verifySourceSignal(multihop.transaction,multihop.wallet,multihop.signature,{action:'buy',outputMint:multihop.intermediateMint}),/Source token mismatch/);
 const verified=verifySourceSignal(multihop.transaction,multihop.wallet,multihop.signature,{action:'buy',outputMint:multihop.expectedMint});
 assert.equal(verified.events.swap.tokenOutputs[0].rawTokenAmount.tokenAmount,'65292180737220');
 assert.throws(()=>verifySourceSignal(multihop.transaction,multihop.wallet,multihop.signature,{action:'sell',inputMint:multihop.expectedMint}),/Source token mismatch/);
});
test('missing or failed source confirmation cannot authorize a copy',()=>{
 const expected={action:'buy',outputMint:multihop.expectedMint};
 assert.throws(()=>verifySourceSignal(null,multihop.wallet,multihop.signature,expected),/could not be verified/);
 const failed=structuredClone(multihop.transaction);failed.meta.err={failed:true};
 assert.throws(()=>verifySourceSignal(failed,multihop.wallet,multihop.signature,expected),/could not be verified/);
});

 test('missing source transactions retry promptly without waiting for a worker tick',async()=>{
 const h=harness();let reads=0;
 h.sub.connection.getParsedTransaction=async()=>++reads===1?null:h.row.transaction;
 h.c.queueDirectRead(h.row.wallet,h.row.signature,h.sub);
 await new Promise(r=>setTimeout(r,50));
 assert.equal(reads,2);assert.equal(h.feeds.get('safe:Solana live').transactions[0].signature,h.row.signature);
 });
