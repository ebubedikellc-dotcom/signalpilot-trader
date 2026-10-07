import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {PublicKey} from '@solana/web3.js';
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const owner='12HrFUw9v7em5ZQ1c3jcAFcSrfXSxqhHLqv1mSCbRprb';
const program=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
function harness(){
 const data=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(data);new PublicKey(owner).toBuffer().copy(data,32);
 data.writeBigUInt64LE(212000000n,64);data[108]=1;
 let account={data,owner:program,executable:false};const calls=[];
 const c=vm.createContext({Number,PublicKey,usdcMint:mint,tokenProgramId:program,
   solanaAddress:v=>new PublicKey(v),isRateLimitError:e=>/429/.test(e.message),
   associatedTokenAddress:()=> 'canonical-account',
   solanaConnection:(_s,options)=>{calls.push(options);return {getAccountInfo:async address=>{assert.equal(address,'canonical-account');return account;}};}});
 vm.runInContext(source.slice(source.indexOf('async function tokenUiBalance('),source.indexOf('function associatedTokenAddress(')),c);
 return {c,calls,data,setAccount:v=>account=v,connection:{getParsedTokenAccountsByOwner:async()=>{throw new Error('429 rate limit');}}};
}
test('rate-limited USDC listing falls back to a verified canonical account, without indexed RPC',async()=>{
 const h=harness();assert.equal(await h.c.tokenUiBalance(h.connection,owner,mint),212);
 assert.equal(h.calls[0].publicNode,true);h.setAccount(null);
 assert.equal(await h.c.tokenUiBalance(h.connection,owner,mint),0);
});
test('fallback rejects frozen, wrong-owner and wrong-mint token accounts',async()=>{
 for(const offset of [0,32,108]){
  const h=harness();h.data[offset]=h.data[offset]===0?1:0;
  await assert.rejects(h.c.tokenUiBalance(h.connection,owner,mint),/Cannot verify/);
 }
});
test('unexpected balance failures are not masked by the fallback',async()=>{
 const h=harness();await assert.rejects(h.c.tokenUiBalance({getParsedTokenAccountsByOwner:async()=>{throw new Error('bad request');}},owner,mint),/bad request/);
 assert.equal(h.calls.length,0);
});
