import {PublicKey} from '@solana/web3.js';
import {decodeDirectSwap} from './direct-signals.mjs';
import {sourceAmountsFromSwap} from './trader-amounts.mjs';

export const SOL='So11111111111111111111111111111111111111112';
export const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT='Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const symbols={[SOL]:'SOL',[USDC]:'USDC',[USDT]:'USDT'};
const expectedDecimals={[SOL]:9,[USDC]:6,[USDT]:6};
export function decimalAmount(raw,decimals) {
  const digits=String(raw).padStart(decimals+1,'0');
  if(!decimals)return digits;
  return (digits.slice(0,-decimals)+'.'+digits.slice(-decimals)).replace(/\.?0+$/,'');
}
function amount(raw,decimals,mint) {return {raw:String(raw),decimals,mint,symbol:symbols[mint],value:decimalAmount(raw,decimals)};}

// This is a bounded sample of confirmed swaps, never a guess at starting capital.
// Keep currencies separate and use integer units, including for even-sized medians.
export function summarizeTraderBuys(transactions=[]) {
  const seen=new Set(),buys=[];
  for(const tx of transactions) {
    if(!tx?.signature || seen.has(tx.signature) || !Number.isFinite(tx.timestamp) || tx.timestamp<=0)continue;
    const source=sourceAmountsFromSwap(tx);
    if(!source?.verified || source.side!=='buy' || source.paid.decimals!==expectedDecimals[source.paid.mint])continue;
    seen.add(tx.signature);
    buys.push({...amount(source.paid.raw,source.paid.decimals,source.paid.mint),signature:tx.signature,timestamp:tx.timestamp});
  }
  buys.sort((a,b)=>b.timestamp-a.timestamp);
  const typical=[];
  for(const mint of Object.keys(symbols)) {
    const group=buys.filter(b=>b.mint===mint);
    if(!group.length)continue;
    const sorted=group.map(b=>BigInt(b.raw)).sort((a,b)=>a<b?-1:a>b?1:0),middle=Math.floor(sorted.length/2);
    const even=sorted.length%2===0;
    typical.push({...amount(even?(sorted[middle-1]+sorted[middle])*5n:sorted[middle],expectedDecimals[mint]+(even?1:0),mint),count:group.length});
  }
  return {latestBuy:buys[0]||null,typical,buyCount:buys.length,startingCapital:null};
}

export function createTraderSizingReader({connectionFor,canRead,now=Date.now,ttlMs=60000,cooldownMs=15000}={}) {
  const cache=new Map();let pending=null,lastStarted=-Infinity;
  const paused={status:'deferred',message:'Fresh amount checks are available while copying is stopped.'};
  async function read(wallet,settings) {
    const key=new PublicKey(wallet),connection=connectionFor(settings);
    const started=now(),transactions=[];let issues=0,scanned=0,rows=[];
    const balances={sol:null,usdc:null};let interrupted=false;
    async function query(action) {
      if(now()-started>45000 || !await canRead()) {interrupted=true;throw Error('deferred');}
      return action();
    }
    // One RPC operation at a time. The shared pool gives trade checks priority.
    try {rows=await query(()=>connection.getSignaturesForAddress(key,{limit:8},'confirmed'));}catch {issues++;}
    for(const row of rows.slice(0,8)) {
      if(interrupted)break;
      scanned++;
      if(row.err)continue;
      try {
        const tx=await query(()=>connection.getParsedTransaction(row.signature,{commitment:'confirmed',maxSupportedTransactionVersion:1}));
        if(!tx){issues++;continue;}
        const decoded=decodeDirectSwap(tx,wallet,row.signature);
        if(decoded)transactions.push(decoded);
      }catch {issues++;}
    }
    if(!interrupted)try {
      const raw=await query(()=>connection.getBalance(key,'confirmed'));
      if(!Number.isSafeInteger(raw)||raw<0)throw Error('unavailable');
      balances.sol=amount(BigInt(raw),9,SOL);
    }catch {issues++;}
    if(!interrupted)try {
      const result=await query(()=>connection.getParsedTokenAccountsByOwner(key,{mint:new PublicKey(USDC)},'confirmed'));
      let raw=0n;
      for(const account of result.value) {
        const info=account.account?.data?.parsed?.info,t=info?.tokenAmount;
        if(info?.mint!==USDC || info?.owner!==wallet || t?.decimals!==6 || !/^\d+$/.test(t?.amount))throw Error('unavailable');
        raw+=BigInt(t.amount);
      }
      balances.usdc=amount(raw,6,USDC);
    }catch {issues++;}
    const summary=summarizeTraderBuys(transactions);
    return {...summary,wallet,balances,checkedAt:new Date(now()).toISOString(),sampleLimit:8,transactionsScanned:scanned,
      status:interrupted?'partial':issues?'partial':'available',
      message:interrupted?'The lookup stopped to leave the connection available for copying.':issues?'Some reads were unavailable. Missing values are not zero.':''};
  }
  return {async get({wallet,settings={}}) {
    const prior=cache.get(wallet);
    if(prior && now()-prior.at<ttlMs)return {...prior.value,cached:true};
    if(!await canRead())return prior?{...prior.value,cached:true,stale:true,...paused}:{...paused,wallet};
    if(pending?.wallet===wallet)return pending.promise;
    if(pending || now()-lastStarted<cooldownMs)return prior?{...prior.value,cached:true,stale:true,message:'Showing the previous check. Wait briefly before refreshing.'}:{wallet,status:'busy',message:'Another amount check just ran. Wait 15 seconds, then check again.'};
    lastStarted=now();
    const promise=read(wallet,settings).then(value=>{
      cache.set(wallet,{at:now(),value});if(cache.size>64)cache.delete(cache.keys().next().value);
      return {...value,cached:false};
    }).finally(()=>{pending=null;});
    pending={wallet,promise};return promise;
  }};
}
