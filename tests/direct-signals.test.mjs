import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {decodeDirectSwap,canonicalSignalId} from '../lib/direct-signals.mjs';
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
 const c=vm.createContext({Map,Set,Date,Number,decodeDirectSwap,signalFeeds:feeds,supportedProfiles:['safe'],readState:async()=>state,targetWallet:()=>row.wallet,sub,wallet:row.wallet});
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
