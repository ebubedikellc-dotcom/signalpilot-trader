import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Keypair,PublicKey,SystemProgram,ComputeBudgetProgram,VersionedTransaction} from '@solana/web3.js';
import {prepareWalletPaidSell,submitWalletPaidSell,gaslessMinimumError} from '../lib/jupiter-sell-route.mjs';
import {base58} from '../lib/swap-signature.mjs';
const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const encode=ix=>({programId:ix.programId.toBase58(),accounts:ix.keys.map(k=>({...k,pubkey:k.pubkey.toBase58()})),data:Buffer.from(ix.data).toString('base64')});
function harness() {
 const signer=Keypair.generate(),query={inputMint:Keypair.generate().publicKey.toBase58(),outputMint:usdc,amount:'300',taker:signer.publicKey.toBase58(),swapMode:'ExactIn'};
 const build={inputMint:query.inputMint,outputMint:usdc,inAmount:'300',outAmount:'3600000',otherAmountThreshold:'3564000',swapMode:'ExactIn',slippageBps:100,
 blockhashWithMetadata:{blockhash:[...PublicKey.default.toBytes()],lastValidBlockHeight:200},transactionVersion:'0',addressesByLookupTableAddress:{},
 computeBudgetInstructions:[encode(ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000000000n}))],
 setupInstructions:[],otherInstructions:[],swapInstruction:encode(SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}))};
 let sends=0,simulations=0;const requests=[];
 const connection={simulateTransaction:async tx=>{simulations++;assert(tx.signatures.every(s=>s.every(b=>b===0)));return {context:{slot:100},value:{err:null,unitsConsumed:200000}};},
 getFeeForMessage:async()=>({value:15000}),getBalance:async()=>2220210,
 sendRawTransaction:async(wire,opts)=>{sends++;assert.equal(opts.skipPreflight,false);assert.equal(opts.maxRetries,0);return base58(VersionedTransaction.deserialize(wire).signatures[0]);}};
 return {signer,query,build,connection,requests,sends:()=>sends,simulations:()=>simulations,
 prepare:()=>prepareWalletPaidSell({query,connection,request:async(path,q)=>{requests.push({path,q});return build;},now:()=>100000})};
}
test('small wallet-paid sale preserves amount, simulates unsigned and caps network priority fees',async()=>{
 const h=harness(),order=await h.prepare();assert.equal(order.executionEngine,'jupiter-rpc');assert.equal(order.inAmount,'300');
 assert.equal(order.outAmount,'3600000');assert.equal(h.sends(),0);assert.equal(h.simulations(),1);
 assert.equal(h.requests[0].path,'/swap/v2/build');assert.equal(h.requests[0].q.slippageBps,100);
 const tx=VersionedTransaction.deserialize(Buffer.from(order.transaction,'base64'));
 const limit=Buffer.from(tx.message.compiledInstructions[0].data).readUInt32LE(1),price=Buffer.from(tx.message.compiledInstructions[1].data).readBigUInt64LE(1);
 assert.equal(limit,240000);assert((price*BigInt(limit)+999999n)/1000000n<=10000n);
 assert.equal(tx.message.header.numRequiredSignatures,1);assert(tx.signatures.every(s=>s.every(b=>b===0)));
 tx.sign([h.signer]);const signed=Buffer.from(tx.serialize()).toString('base64');
 const result=await submitWalletPaidSell(h.connection,signed,order,()=>100001);assert.equal(result.confirmed,false);assert.equal(h.sends(),1);
 await assert.rejects(submitWalletPaidSell(h.connection,signed,order,()=>116000),/expired/);assert.equal(h.sends(),1);
});
test('mismatched quote, excessive slippage, missing SOL or failed simulation never reach a send',async()=>{
 for(const problem of ['amount','mint','slippage','threshold','blockhash','version','signer','simulation','sol']) {
  const h=harness();
  if(problem==='amount')h.build.inAmount='301';
  if(problem==='mint')h.build.inputMint=usdc;
  if(problem==='slippage')h.build.slippageBps=500;
  if(problem==='threshold')h.build.otherAmountThreshold='1';
  if(problem==='blockhash')h.build.blockhashWithMetadata.blockhash=[];
  if(problem==='version')h.build.transactionVersion='1';
  if(problem==='signer')h.build.swapInstruction.accounts[1].isSigner=true;
  if(problem==='simulation')h.connection.simulateTransaction=async()=>({value:{err:'InsufficientFunds'}});
  if(problem==='sol')h.connection.getBalance=async()=>0;
  await assert.rejects(h.prepare(),undefined,problem);assert.equal(h.sends(),0);
 }
});
test('changed signed messages and unsigned swaps cannot be submitted',async()=>{
 const h=harness(),order=await h.prepare();
 await assert.rejects(submitWalletPaidSell(h.connection,order.transaction,order,()=>100001),/signature/);
 const tx=VersionedTransaction.deserialize(Buffer.from(order.transaction,'base64'));tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.sign([h.signer]);
 await assert.rejects(submitWalletPaidSell(h.connection,Buffer.from(tx.serialize()).toString('base64'),order,()=>100001),/differs/);assert.equal(h.sends(),0);
});
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
test('only an unsigned gasless-minimum SELL gets fallback; 429, buys and uncertain sends do not',async()=>{
 let fallbacks=0,executions=0,error=new Error('Minimum $5 for gasless');
 const c=vm.createContext({usdcMint:usdc,jupiterApiKey:()=>'',solanaConnection:()=>({}),gaslessMinimumError,
 prepareWalletPaidSell:async({query})=>{fallbacks++;return {executionEngine:'jupiter-rpc',inAmount:query.amount};},
 submitWalletPaidSell:async()=>{throw Error('RPC timeout after send');},
 jupiterJson:async path=>{if(path.includes('execute'))executions++;throw error;}});
 vm.runInContext(source.slice(source.indexOf('async function prepareTradingOrder('),source.indexOf('async function executeCopiedSwap(')),c);
 const state={settings:{}},query={inputMint:'coin',outputMint:usdc,amount:'300',taker:'wallet'};
 const order=await c.prepareTradingOrder(state,query);assert.equal(order.inAmount,'300');assert.equal(fallbacks,1);
 await assert.rejects(c.prepareTradingOrder(state,{...query,inputMint:usdc,outputMint:'coin'}));
 await assert.rejects(c.prepareTradingOrder(state,query,{quoteOnly:true}));assert.equal(fallbacks,1);
 error=new Error('Jupiter returned 429');await assert.rejects(c.prepareTradingOrder(state,query));assert.equal(fallbacks,1);
 await assert.rejects(c.executeTradingOrder(state,{signedTransactionBase64:'x'},order),/timeout/);assert.equal(executions,0);assert.equal(fallbacks,1);
});
