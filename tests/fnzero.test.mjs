import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PublicKey, VersionedTransaction, Keypair} from '@solana/web3.js';
import {PoolTradeHint} from '../vendor/fnzero/builders.mjs';
import {prepareFnzeroOrder, createFnzeroRouter, routeHint, submitFnzeroOrder, USDC} from '../lib/fnzero-route.mjs';
import {base58} from '../lib/swap-signature.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/fnzero-cpmm.json',import.meta.url)));
function setup() {
 const accounts=new Map(fixture.accounts.map(a=>[a.pubkey,{owner:new PublicKey(a.owner),data:Buffer.from(a.data,'base64')}]));
 const clock=Buffer.alloc(40);clock.writeBigUInt64LE(100n,0);clock.writeBigInt64LE(1000n,32);
 accounts.set('SysvarC1ock11111111111111111111111111111111',{owner:PublicKey.default,data:clock});
 const signer=Keypair.generate();let reads=0,sends=0;
 const connection={getMultipleAccountsInfoAndContext:async keys=>{reads++;return {context:{slot:100},value:keys.map(k=>accounts.get(k.toBase58()) || null)};},
 getLatestBlockhash:async()=>({blockhash:PublicKey.default.toBase58(),lastValidBlockHeight:200}),
 sendRawTransaction:async bytes=>{sends++;return base58(VersionedTransaction.deserialize(bytes).signatures[0]);}};
 const hint=new PoolTradeHint(new PublicKey(fixture.pool),new PublicKey(fixture.input_mint),new PublicKey(fixture.output_mint));
 const query={inputMint:fixture.input_mint,outputMint:fixture.output_mint,amount:'1000',taker:signer.publicKey.toBase58()};
 return {accounts,connection,hint,query,signer,reads:()=>reads,sends:()=>sends};
}
test('FnZero builds unsigned exact-input v0 from fixture, then uses one fresh batch when warm',async()=>{
 const h=setup();const first=await prepareFnzeroOrder({...h,discover:true,now:()=>1000000});
 const tx=VersionedTransaction.deserialize(Buffer.from(first.order.transaction,'base64'));
 assert.equal(tx.version,0);assert.equal(first.order.inAmount,'1000');assert(BigInt(first.order.otherAmountThreshold)>0n);
 assert(tx.signatures.every(s=>s.every(b=>b===0)));assert.equal(h.sends(),0);
 const before=h.reads();await prepareFnzeroOrder({...h,knownKeys:first.knownKeys,now:()=>1000000});assert.equal(h.reads()-before,1);
});
test('FnZero rejects wrong owner, stale clock and unavailable state rather than treating it as a quote',async()=>{
 for(const failure of ['owner','clock','missing']) {
  const h=setup();
  if(failure==='owner')h.accounts.get(fixture.pool).owner=PublicKey.default;
  if(failure==='clock')h.accounts.get('SysvarC1ock11111111111111111111111111111111').data.writeBigInt64LE(1n,32);
  if(failure==='missing')h.accounts.delete(fixture.input_mint);
  await assert.rejects(prepareFnzeroOrder({...h,discover:true,now:()=>1000000}));assert.equal(h.sends(),0);
 }
});
test('split/multihop, mismatched endpoints and untested routes are not eligible',async()=>{
 const h=setup(),q={...h.query,inputMint:USDC};
 for(const order of [{routePlan:[]},{routePlan:[{},{}]},{inAmount:q.amount,routePlan:[{percent:50,swapInfo:{inputMint:USDC,outputMint:q.outputMint,ammKey:fixture.pool}}]}])assert.throws(()=>routeHint(order,q));
 await assert.rejects(createFnzeroRouter().prepare({...h}),/No recent successful/);
});
test('signed FnZero submission uses the same signature; expired and changed messages never send',async()=>{
 const h=setup();const {order}=await prepareFnzeroOrder({...h,discover:true,now:()=>1000000});
 const tx=VersionedTransaction.deserialize(Buffer.from(order.transaction,'base64'));tx.sign([h.signer]);
 const wire=Buffer.from(tx.serialize()).toString('base64');
 const result=await submitFnzeroOrder(h.connection,wire,order,()=>1000001);
 assert.equal(result.signature,base58(tx.signatures[0]));assert.equal(result.confirmed,false);
 await assert.rejects(submitFnzeroOrder(h.connection,wire,order,()=>1016000),/expired/);
 tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();
 await assert.rejects(submitFnzeroOrder(h.connection,Buffer.from(tx.serialize()).toString('base64'),order,()=>1000001),/message changed/);
 assert.equal(h.sends(),1);
});
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function routingHarness() {
 let quotes=0,executions=0;
 const c=vm.createContext({usdcMint:USDC,solanaConnection:()=>({}),jupiterApiKey:()=>'',
 fnzeroRouter:{prepare:async()=>{throw Error('unsupported pool');}},submitFnzeroOrder:async()=>{throw Error('RPC timeout after send');},
 jupiterJson:async path=>{if(path.includes('order'))quotes++;else executions++;return {transaction:'jupiter'};}});
 vm.runInContext(source.slice(source.indexOf('async function prepareTradingOrder('),source.indexOf('async function executeCopiedSwap(')),c);
 return {c,quotes:()=>quotes,executions:()=>executions};
}
test('fallback only happens before signing; uncertain FnZero sends never submit a Jupiter duplicate',async()=>{
 const h=routingHarness(),state={settings:{executionEngine:'fnzero'}};
 const order=await h.c.prepareTradingOrder(state,{});assert.equal(order.executionEngine,'jupiter');assert.equal(h.quotes(),1);
 await assert.rejects(h.c.executeTradingOrder(state,{signedTransactionBase64:'x'},{executionEngine:'fnzero'}),/timeout/);
 assert.equal(h.executions(),0);
});
test('read-only test endpoint requires owner, rejects running tests, and contains no signing or submission',()=>{
 const endpoint=source.slice(source.indexOf('  if (request.method === "POST" && url.pathname === "/api/fnzero/test")'),source.indexOf('  if (request.method === "POST" && url.pathname === "/api/settings")'));
 assert.match(endpoint,/requireOwner/);assert.match(endpoint,/Stop trading before/);
 assert.doesNotMatch(endpoint,/signSolanaTransaction|executeTradingOrder|sendRawTransaction/);
});
