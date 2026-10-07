import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createTradingJournal} from '../lib/trading-journal.mjs';
const wallet='12HrFUw9v7em5ZQ1c3jcAFcSrfXSxqhHLqv1mSCbRprb';
async function fixture(run){const dir=await mkdtemp(path.join(tmpdir(),'sponsor-'));try{await run(path.join(dir,'journal.json'));}finally{await rm(dir,{recursive:true,force:true});}}
test('sponsored receipt discovery matches owner signature and reconciles a failed transaction',async()=>fixture(async file=>{
 const j=createTradingJournal(file,'cash'),d=await j.load();
 d.pending.order={wallet,mint:'coin',side:'sell',submittedAt:Date.now()-45000,ownerSignature:'owner-signed-message'};
 let lookups=0;
 await j.reconcile({getSignaturesForAddress:async key=>{assert.equal(key.toBase58(),wallet);return [{signature:'unrelated',blockTime:Date.now()/1000},{signature:'failed-sale',blockTime:Date.now()/1000}];},getParsedTransaction:async sig=>{lookups++;return {transaction:{signatures:['sponsor-signature',sig==='failed-sale'?'owner-signed-message':'other-signature'],message:{accountKeys:[{pubkey:'sponsor',signer:true},{pubkey:wallet,signer:true}]}},meta:{err:{InstructionError:[3,{Custom:6001}]}}};}});
 assert.equal(d.pending.order,undefined);assert.equal(d.checked['failed-sale'],true);assert.match(d.notices.order,/failed on chain/);assert.equal(lookups,3);
}));
test('empty history, wrong owner signatures and provider failures never release uncertain orders',async()=>fixture(async file=>{
 const j=createTradingJournal(file,'cash'),d=await j.load();
 d.pending.order={wallet,mint:'coin',submittedAt:Date.now()-45000,ownerSignature:'owner-signed-message'};
 await j.reconcile({getSignaturesForAddress:async()=>[]});assert(d.pending.order);
 delete d.pending.order.lastDiscovery;
 await j.reconcile({getSignaturesForAddress:async()=>[{signature:'unrelated',blockTime:Date.now()/1000}],getParsedTransaction:async()=>({transaction:{signatures:['other-signature'],message:{accountKeys:[{pubkey:wallet,signer:true}]}},meta:{err:true}})});assert(d.pending.order);assert.equal(d.pending.order.txid,undefined);
 delete d.pending.order.lastDiscovery;
 await j.reconcile({getSignaturesForAddress:async()=>{throw new Error('provider unavailable');}});assert(d.pending.order);assert.match(d.notices.order,/unavailable/);
}));
test('legacy recovery identities require every pending identity field and still reconcile on chain',async()=>fixture(async file=>{
 const pending={wallet,mint:'coin',requestId:'r1',submittedAt:100,side:'sell',txid:null};
 const txid='2'.repeat(88);
 await writeFile(file,JSON.stringify({fills:[],pending:{order:pending},checked:{},notices:{}}));
 await writeFile(file+'.recoveries.json',JSON.stringify([{...pending,key:'order',requestId:'wrong',txid}]));
 assert.equal((await createTradingJournal(file,'cash').load()).pending.order.txid,null);
 await writeFile(file+'.recoveries.json',JSON.stringify([{...pending,key:'order',txid}]));
 const j=createTradingJournal(file,'cash'),d=await j.load();assert.equal(d.pending.order.txid,txid);
 await j.reconcile({getParsedTransaction:async()=>({meta:{err:true}})});assert.equal(d.pending.order,undefined);assert.equal(d.checked[txid],true);
}));
