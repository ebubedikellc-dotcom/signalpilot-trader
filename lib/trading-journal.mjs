import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {PublicKey as connectionPublicKey} from '@solana/web3.js';
import {tokenAmounts,buildPositions,dailyResults} from './position-accounting.mjs';
function solCost(tx, wallet) {
 const keys=tx.transaction?.message?.accountKeys || [];
 const index=keys.findIndex(k=>String(k.pubkey || k)===wallet);
 if(index<0 || !Number.isFinite(tx.meta.preBalances?.[index]) || !Number.isFinite(tx.meta.postBalances?.[index]))return null;
 const balanceCost= Math.max(0, Number(tx.meta.preBalances?.[index] || 0)-Number(tx.meta.postBalances?.[index] || 0));
 // Includes network fees and account rent paid. SOL refunds are not counted as profit.
 return Math.max(index===0 ? Number(tx.meta.fee || 0) : 0,balanceCost)/1e9;
}
export function createTradingJournal(file,usdc) {
 let data, loading, writeQueue=Promise.resolve();
 async function load(){
   if(data)return data;
   if(!loading)loading=(async()=>{try{data=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;data={fills:[],pending:{},checked:{},notices:{},createdAt:new Date().toISOString()};}
     // Operator-supplied receipt identities repair legacy orders that did not
     // retain the sponsor's returned signature. They still require chain checks.
     let recoveries=[];
     try { recoveries=JSON.parse(await readFile(file+'.recoveries.json','utf8')); } catch(e) {if(e.code!=='ENOENT')throw e;}
     for(const r of recoveries) {
       if(r.kind==='missing-sell-fill') {
         const position=buildPositions(data.fills).positions[`${r.wallet}:${r.profile}:${r.mint}`];
         // Recheck the receipt on chain; never fabricate a sale from a zero balance.
         if(position?.verified && position.cycle===r.cycle && position.raw===r.expectedRaw &&
             BigInt(position.raw)>0n && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(r.txid) &&
             !data.fills.some(f=>f.txid===r.txid) && !Object.values(data.pending).some(p=>p.txid===r.txid)) {
           delete data.checked[r.txid];
           data.pending[r.txid]={txid:r.txid,wallet:r.wallet,profile:r.profile,mint:r.mint,side:'sell',
             source:'manual:receipt-recovery',historical:true,submittedAt:Date.now(),expectedRaw:r.expectedRaw,expectedCycle:r.cycle,receiptRecovery:'Missing sell fill; chain verification required'};
         }
         continue;
       }
       const p=data.pending[r.key];
       if(p && !p.txid && p.requestId===r.requestId && p.wallet===r.wallet && p.mint===r.mint && p.submittedAt===r.submittedAt && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(r.txid)) {
         p.txid=r.txid;p.receiptRecovery='Verified legacy receipt identity';
       }
     }
     return data;})();
   return loading;
 }
 async function save(){const snapshot=JSON.stringify(await load());const work=writeQueue.then(async()=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',snapshot);await rename(file+'.tmp',file);});writeQueue=work.catch(()=>{});return work;}
 async function reconcile(connection){
   const d=await load();
   // A transport error can hide the sponsor's signature. Find the exact signed
   // message by its immutable owner signature; never infer absence from history.
   for(const [key,p] of Object.entries(d.pending).filter(([,p])=>!p.txid && p.ownerSignature && Date.now()-p.submittedAt>30000 && (!p.lastDiscovery || Date.now()-p.lastDiscovery>60000)).slice(0,1)) {
     p.lastDiscovery=Date.now();
     try {
       const history=await connection.getSignaturesForAddress(new connectionPublicKey(p.wallet),{limit:50},'confirmed');
       for(const row of history.filter(r=>r.blockTime && r.blockTime*1000>=p.submittedAt-30000).slice(0,10)) {
         const tx=await connection.getParsedTransaction(row.signature,{commitment:'confirmed',maxSupportedTransactionVersion:1});
         const keys=tx?.transaction?.message?.accountKeys || [];
         const index=keys.findIndex(k=>String(k.pubkey || k)===p.wallet && k.signer);
         if(index>=0 && tx.transaction.signatures[index]===p.ownerSignature) {
           p.txid=row.signature;delete d.notices[key];await save();break;
         }
       }
       if(!p.txid)d.notices[key]='Submission receipt not yet found; order remains reserved for review';
     } catch(error) { d.notices[key]=`Receipt recovery unavailable: ${error.message}`; }
   }
   const eligible=Object.entries(d.pending).filter(([,p])=>p.txid && (!p.historical || !p.lastLookup || Date.now()-p.lastLookup>=60000));
   // Old missing history must not consume the fast confirmation lane every two seconds.
   const jobs=[...eligible.filter(([,p])=>!p.historical).sort((a,b)=>(a[1].lastLookup||0)-(b[1].lastLookup||0)).slice(0,4),
     ...eligible.filter(([,p])=>p.historical).sort((a,b)=>(a[1].lastLookup||0)-(b[1].lastLookup||0)).slice(0,1)];
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
     if(p.expectedCycle) {
       const current=buildPositions(d.fills).positions[`${p.wallet}:${p.profile}:${p.mint}`];
       const signer=tx.transaction?.message?.accountKeys?.some(k=>String(k.pubkey || k)===p.wallet && k.signer);
       if(!signer || current?.cycle!==p.expectedCycle || current?.raw!==p.expectedRaw ||
           -delta!==BigInt(p.expectedRaw) || t.before!==BigInt(p.expectedRaw) || t.after!==0n || !(usd>0)) {
         d.notices[key]='Recovered receipt does not match the recorded holding; review required';await save();continue;
       }
     }
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
