import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeTraderBuys,createTraderSizingReader,decimalAmount,SOL,USDC} from '../lib/trader-sizing.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/source-swaps.json',import.meta.url)));
const row=fixtures.find(t=>t.expectedSide==='buy');
const part=(mint,raw,decimals)=>({mint,rawTokenAmount:{tokenAmount:String(raw),decimals}});
const buy=(signature,raw,mint=SOL,decimals=9,timestamp=100)=>({signature,timestamp,source:'SOLANA_DIRECT',events:{swap:{tokenInputs:[part(mint,raw,decimals)],tokenOutputs:[part('coin',100,6)]}}});
test('median uses exact units, separates currencies, ignores unverified sources and duplicate transactions',()=>{
  const sol1=buy('a','9007199254740993'),sol2=buy('b','9007199254740994',SOL,9,102);
  const unverified={...buy('unverified','9999999999'),source:'FEED'};
  const result=summarizeTraderBuys([sol1,sol2,sol1,buy('c',10000000,USDC,6,101),unverified,buy('wrongDecimals',1,SOL,6)]);
  assert.equal(result.buyCount,3);assert.equal(result.latestBuy.signature,'b');assert.equal(result.typical.length,2);
  assert.equal(result.typical[0].value,'9007199.2547409935');assert.equal(result.typical[0].count,2);
  assert.equal(result.typical[1].value,'10');assert.equal(result.startingCapital,null);
  assert.equal(decimalAmount('0',9),'0');assert.equal(decimalAmount('100',0),'100');
});
function harness({canRead=async()=>true}={}) {
  let clock=100000;const calls=[];
  const connection={
    async getSignaturesForAddress(key,options){calls.push(['signatures',options]);return [{signature:row.signature,err:null}];},
    async getParsedTransaction(signature){calls.push(['transaction',signature]);return row.transaction;},
    async getBalance(){calls.push(['balance']);return 1230000000;},
    async getParsedTokenAccountsByOwner(){calls.push(['usdc']);return {value:[7,13].map(n=>({account:{data:{parsed:{info:{mint:USDC,owner:row.wallet,tokenAmount:{amount:String(n*1000000),decimals:6}}}}}}))};}
  };
  const reader=createTraderSizingReader({connectionFor:()=>connection,canRead,now:()=>clock});
  return {reader,connection,calls,advance:ms=>clock+=ms};
}
test('read-only reader bounds history, sums balances, caches and coalesces repeated checks without mutating settings',async()=>{
  const h=harness(),settings={budget:100,signer:'test-not-used',running:false},before=JSON.stringify(settings);
  const [a,b]=await Promise.all([h.reader.get({wallet:row.wallet,settings}),h.reader.get({wallet:row.wallet,settings})]);
  assert.deepEqual(a,b);assert.equal(h.calls.length,4);assert.equal(h.calls[0][1].limit,8);
  assert.equal(a.buyCount,1);assert.equal(a.balances.sol.value,'1.23');assert.equal(a.balances.usdc.value,'20');assert.equal(a.startingCapital,null);
  assert.equal((await h.reader.get({wallet:row.wallet})).cached,true);assert.equal(h.calls.length,4);
  assert.equal(JSON.stringify(settings),before);
  const other=await h.reader.get({wallet:'11111111111111111111111111111111'});assert.equal(other.status,'busy');assert.equal(h.calls.length,4);
});
test('no RPC calls are made when copying is active; an in-flight scan stops scheduling reads when Start occurs',async()=>{
  let allowed=false;const h=harness({canRead:async()=>allowed});
  assert.equal((await h.reader.get({wallet:row.wallet})).status,'deferred');assert.equal(h.calls.length,0);
  allowed=true;const old=h.connection.getParsedTransaction;
  h.connection.getParsedTransaction=async signature=>{const tx=await old(signature);allowed=false;return tx;};
  const data=await h.reader.get({wallet:row.wallet});assert.equal(data.status,'partial');assert.equal(data.buyCount,1);
  assert.equal(data.balances.sol,null);assert.equal(data.balances.usdc,null);assert.equal(h.calls.length,2);
  h.advance(61000);const stale=await h.reader.get({wallet:row.wallet});assert.equal(stale.stale,true);assert.equal(stale.status,'deferred');assert.equal(h.calls.length,2);
});
test('RPC failures remain unavailable instead of invented zero balances or leaked endpoint details',async()=>{
  const h=harness();for(const key of Object.keys(h.connection))h.connection[key]=async()=>{throw Error('SECRET_API_KEY');};
  const result=await h.reader.get({wallet:row.wallet});assert.equal(result.status,'partial');assert.equal(result.balances.sol,null);assert.equal(result.balances.usdc,null);
  assert.equal(result.latestBuy,null);assert.doesNotMatch(JSON.stringify(result),/SECRET_API_KEY/);
});
test('unsupported swaps and failed transactions never become a claimed buy size',async()=>{
  const h=harness();h.connection.getSignaturesForAddress=async()=>[{signature:'failed',err:{InstructionError:[1,'error']}},{signature:'unsupported',err:null}];
  h.connection.getParsedTransaction=async()=>({...row.transaction,meta:{...row.transaction.meta,logMessages:[]}});
  const result=await h.reader.get({wallet:row.wallet});assert.equal(result.transactionsScanned,2);assert.equal(result.buyCount,0);assert.equal(result.latestBuy,null);
});
