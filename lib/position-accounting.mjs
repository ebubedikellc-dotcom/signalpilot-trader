// Integer token units; dollar cost is allocated by the fraction actually sold.
export function tokenAmounts(tx, wallet, mint) {
  const sum = list => (list || []).filter(b => b.owner === wallet && b.mint === mint)
    .reduce((n,b) => n + BigInt(b.uiTokenAmount.amount), 0n);
  return {before:sum(tx?.meta?.preTokenBalances), after:sum(tx?.meta?.postTokenBalances)};
}
export function sellFraction(tx, wallet, mint) {
  if (!tx?.meta || tx.meta.err) return null;
  const {before,after}=tokenAmounts(tx,wallet,mint);
  if (before <= 0n || after >= before) return null;
  return {sold:(before-after).toString(), before:before.toString()};
}
export function proportionalAmount(held, fraction) {
  const n=BigInt(held), sold=BigInt(fraction.sold), before=BigInt(fraction.before);
  if (n<0n || sold<=0n || before<=0n || sold>before) throw new Error('Invalid sell fraction');
  return (n*sold/before).toString();
}
export function exitReason(mode,cost,proceeds) {
  if (!['limits','loss'].includes(mode) || !(cost>0) || !Number.isFinite(proceeds) || proceeds<0) return null;
  if (proceeds <= cost*0.7 + 1e-9) return '30% loss limit';
  if (mode === 'limits' && proceeds >= cost*1.6 - 1e-9) return '60% profit target';
  return null;
}
// Track unit value so a partial sale cannot look like a price crash.
// Persist a triggered exit until confirmation, even if a later quote recovers.
export function trailingExit(position, proceeds, percent, previous) {
  const raw=Number(position.raw);
  if (!position.verified || !(raw>0) || !Number.isFinite(raw) || !(position.cost>0) ||
      !Number.isFinite(proceeds) || proceeds<=0 || !Number.isFinite(percent) || percent<=0 || percent>=100) return null;
  const same=previous?.cycle===position.cycle;
  const sameRaw=same && String(previous.positionRaw || '')===raw.toString();
  const peak=Math.max(position.cost/raw, proceeds/raw, same ? Number(previous.peak)||0 : 0);
  const trigger=peak*raw*(1-percent/100);
  const triggered=Boolean(same && previous.triggered) || proceeds<=trigger+1e-9;
  const reason=triggered ? (same && previous.reason || `${percent}% trailing stop`) : null;
  return {cycle:position.cycle,peak,trigger,percent,triggered,reason};
}
export function takeBackExit(position, proceeds, previous) {
  const raw=BigInt(position.raw || '0');
  if (!position.verified || raw<=0n || !(position.cost>0) || !Number.isFinite(proceeds) || proceeds<=0) return null;
  const rawNumber=Number(raw);
  if (!Number.isFinite(rawNumber) || rawNumber<=0) return null;
  const same=previous?.cycle===position.cycle;
  const peak=Math.max(position.cost/rawNumber, proceeds/rawNumber, same ? Number(previous.peak)||0 : 0);
  if (proceeds <= position.cost*0.7 + 1e-9) {
    return {cycle:position.cycle,peak,raw:raw.toString(),reason:'30% loss limit',partial:false,recovered:Boolean(same && previous.recovered)};
  }
  if (same && previous.recovered) {
    const trigger=peak*rawNumber*0.7;
    const triggered=proceeds<=trigger+1e-9;
    return {cycle:position.cycle,peak,trigger,raw:raw.toString(),reason:triggered ? 'Take My Money Back protection' : null,partial:false,recovered:true};
  }
  if (proceeds < position.cost*1.6 - 1e-9) return {cycle:position.cycle,peak,raw:null,reason:null,partial:false,recovered:false};
  const scale=1_000_000;
  const numerator=BigInt(Math.ceil(position.cost*scale));
  const denominator=BigInt(Math.max(1,Math.floor(proceeds*scale)));
  let sellRaw=raw*numerator/denominator;
  if (sellRaw<=0n) sellRaw=1n;
  if (sellRaw>=raw) sellRaw=raw-1n;
  if (sellRaw<=0n) return {cycle:position.cycle,peak,raw:raw.toString(),reason:'60% profit target',partial:false,recovered:true};
  return {cycle:position.cycle,peak,raw:sellRaw.toString(),reason:'Take my money back',partial:true,recovered:true};
}
export function profitLadderExit(position, proceeds, previous, stepPercent = 20, guardPercent = 10) {
  const raw=BigInt(position.raw || '0');
  if (!position.verified || raw<=0n || !(position.cost>0) || !Number.isFinite(proceeds) || proceeds<=0 ||
      !Number.isFinite(stepPercent) || stepPercent<=0 || !Number.isFinite(guardPercent) || guardPercent<=0 || guardPercent>=100) return null;
  const rawNumber=Number(raw);
  if (!Number.isFinite(rawNumber) || rawNumber<=0) return null;
  const same=previous?.cycle===position.cycle;
  const sameRaw=same && String(previous.positionRaw || '')===raw.toString();
  const unit=proceeds/rawNumber;
  const startUnit=position.cost/rawNumber;
  const baselineUnit=same && Number(previous.baselineUnit)>0 ? Number(previous.baselineUnit) : startUnit;
  const peakUnit=Math.max(unit, same ? Number(previous.peakUnit)||0 : 0, baselineUnit);
  const lossTrigger=position.cost*(1-guardPercent/100);
  const dropTrigger=baselineUnit*rawNumber*(1-guardPercent/100);
  if (sameRaw && previous.triggered) {
    return {
      cycle:position.cycle,baselineUnit,peakUnit,raw:previous.raw || raw.toString(),
      reason:previous.reason || `${stepPercent}% profit ladder`,partial:Boolean(previous.partial),triggered:true,positionRaw:raw.toString(),
      tookProfit:Boolean(previous.tookProfit)
    };
  }
  if (proceeds <= lossTrigger + 1e-9) {
    return {cycle:position.cycle,baselineUnit,peakUnit,raw:raw.toString(),reason:`${guardPercent}% loss guard`,partial:false,triggered:true,positionRaw:raw.toString()};
  }
  if (same && previous.tookProfit && proceeds <= dropTrigger + 1e-9) {
    return {cycle:position.cycle,baselineUnit,peakUnit,raw:raw.toString(),reason:`${guardPercent}% profit guard`,partial:false,triggered:true,tookProfit:true,positionRaw:raw.toString()};
  }
  const ladderTrigger=baselineUnit*rawNumber*(1+stepPercent/100);
  if (proceeds < ladderTrigger - 1e-9) {
    return {cycle:position.cycle,baselineUnit,peakUnit,raw:null,reason:null,partial:false,triggered:false,tookProfit:Boolean(same && previous.tookProfit),positionRaw:raw.toString()};
  }
  const profit=Math.max(0,proceeds-position.cost);
  const scale=1_000_000;
  const numerator=BigInt(Math.ceil(profit*scale));
  const denominator=BigInt(Math.max(1,Math.floor(proceeds*scale)));
  let sellRaw=raw*numerator/denominator;
  if (sellRaw<=0n) sellRaw=1n;
  if (sellRaw>=raw) sellRaw=raw-1n;
  if (sellRaw<=0n) return {cycle:position.cycle,baselineUnit:unit,peakUnit,raw:raw.toString(),reason:`${stepPercent}% profit ladder`,partial:false,triggered:true,tookProfit:true,positionRaw:raw.toString()};
  return {cycle:position.cycle,baselineUnit:unit,peakUnit,raw:sellRaw.toString(),reason:`${stepPercent}% profit ladder`,partial:true,triggered:true,tookProfit:true,positionRaw:raw.toString()};
}
export function buildPositions(fills) {
  const positions = {}, closed=[];
  for (const f of [...fills].sort((a,b)=>a.time-b.time || (a.order||0)-(b.order||0))) {
    const key=`${f.wallet}:${f.profile}:${f.mint}`;
    const p=positions[key] ||= {key,wallet:f.wallet,profile:f.profile,mint:f.mint,raw:'0',cost:0,verified:true};
    const amount=BigInt(f.raw); if(amount<=0n || !Number.isFinite(f.usd) || f.usd<0) continue;
    if(f.side==='buy'){
      if(BigInt(p.raw)===0n)p.cycle=String(f.txid || `${f.time}:${f.order||0}`);
      p.raw=(BigInt(p.raw)+amount).toString();p.cost+=f.usd;
    }
    else {
      const held=BigInt(p.raw);
      if(held<amount || held===0n){p.verified=false; p.raw='0';p.cost=0;continue;}
      const cost=p.cost*Number(amount)/Number(held);
      p.raw=(held-amount).toString();p.cost=Math.max(0,p.cost-cost);
      if(p.verified) closed.push({...f,cost,pnl:f.usd-cost});
    }
  }
  return {positions,closed};
}
export function lagosDay(ms) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));}
export function dailyResults(closed,now=Date.now()) {
 const rows=closed.filter(f=>lagosDay(f.time)===lagosDay(now));
 return {gains:rows.reduce((n,f)=>n+Math.max(0,f.pnl),0),losses:rows.reduce((n,f)=>n+Math.max(0,-f.pnl),0),net:rows.reduce((n,f)=>n+f.pnl,0),sales:rows.length};
}
