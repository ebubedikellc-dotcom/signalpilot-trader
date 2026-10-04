import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tokenAmounts,buildPositions,dailyResults} from './position-accounting.mjs';
function solCost(tx, wallet) {
 const keys=tx.transaction?.message?.accountKeys || [];
 const index=keys.findIndex(k=>String(k.pubkey || k)===wallet);
 const balanceCost=index<0 ? 0 : Math.max(0, Number(tx.meta.preBalances?.[index] || 0)-Number(tx.meta.postBalances?.[index] || 0));
 // Includes network fees and account rent paid. SOL refunds are not counted as profit.
 return Math.max(Number(tx.meta.fee || 0),balanceCost)/1e9;
}
export function createTradingJournal(file,usdc) {
 let data, loading, writeQueue=Promise.resolve();
 async function load(){
   if(data)return data;
   if(!loading)loading=(async()=>{try{data=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;data={fills:[],pending:{},checked:{},notices:{},createdAt:new Date().toISOString()};}return data;})();
   return loading;
 }
 async function save(){const snapshot=JSON.stringify(await load());const work=writeQueue.then(async()=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',snapshot);await rename(file+'.tmp',file);});writeQueue=work.catch(()=>{});return work;}
 async function reconcile(connection){
   const d=await load();
   const jobs=Object.entries(d.pending).sort((a,b)=>Number(Boolean(a[1].historical))-Number(Boolean(b[1].historical)) || (a[1].lastLookup||0)-(b[1].lastLookup||0)).slice(0,6);
   for(const [key,p] of jobs) {
     p.lastLookup=Date.now();
     try {
     if(!p.txid)continue; // Unknown submission result needs review, never blind resubmission.
     const tx=await connection.getParsedTransaction(p.txid,{commitment:'confirmed',maxSupportedTransactionVersion:1});
     if(!tx){
       if(p.expires && await connection.getBlockHeight('confirmed') > Number(p.expires)) {
         const status=await connection.getSignatureStatuses([p.txid],{searchTransactionHistory:true});
         if(!status.value[0]){d.notices[key]='Transaction expired without confirmation';d.checked[p.txid]=true;delete d.pending[key];await save();}
       }
       continue;
     }
     if(tx.meta?.err){
       if(p.goalId){d.charges ||= [];if(!d.charges.some(f=>f.txid===p.txid))d.charges.push({...p,costSol:solCost(tx,p.wallet),time:tx.blockTime*1000});}
       d.notices[key]='Transaction failed on chain';d.checked[p.txid]=true;delete d.pending[key];await save();continue;
     }
     if(!tx.meta)continue;
     const t=tokenAmounts(tx,p.wallet,p.mint), cash=tokenAmounts(tx,p.wallet,usdc);
     const delta=t.after-t.before, usd=Number(cash.after-cash.before)/1e6;
     if((p.side==='buy' && delta>0n && usd<0)||(p.side==='sell' && delta<0n && usd>0)) {
       if(!d.fills.some(f=>f.txid===p.txid))d.fills.push({...p,raw:(delta<0n?-delta:delta).toString(),usd:Math.abs(usd),time:tx.blockTime*1000,order:d.fills.length,feeSol:Number(tx.meta.fee||0)/1e9,costSol:solCost(tx,p.wallet)});
       d.checked[p.txid]=true;delete d.pending[key];delete d.notices[key];await save();
     }else {d.notices[key]='Confirmed transaction amounts require review';await save();}
     }catch(error){d.notices[key]=`Confirmation check unavailable: ${error.message}`;}
   }
 }
 async function snapshot(){const d=await load(), result=buildPositions(d.fills);return {...result,pending:d.pending,notices:d.notices,today:dailyResults(result.closed),createdAt:d.createdAt};}
 return {load,save,reconcile,snapshot};
}
