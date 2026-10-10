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
export function profitLadderExit(position, proceeds, previous, stepPercent = 20, guardPercent = 5) {
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
  let sellRaw=raw*30n/100n;
  if (sellRaw<=0n) sellRaw=1n;
  if (sellRaw>=raw) sellRaw=raw-1n;
  if (sellRaw<=0n) return {cycle:position.cycle,baselineUnit:unit,peakUnit,raw:raw.toString(),reason:`${stepPercent}% profit ladder`,partial:false,triggered:true,tookProfit:true,positionRaw:raw.toString()};
  return {cycle:position.cycle,baselineUnit:unit,peakUnit,raw:sellRaw.toString(),reason:`${stepPercent}% profit ladder`,partial:true,triggered:true,tookProfit:true,positionRaw:raw.toString()};
}
// Receipt-driven steps: a quote, submission, or unrelated trader sale must not
// advance the price target. Confirmed fills retain this metadata across restarts.
export function riseStepExit(position, proceeds, fills = []) {
  const raw=BigInt(position.raw || '0'), rawNumber=Number(raw);
  if (!position.verified || !position.cycle || raw<=0n || !Number.isFinite(rawNumber) ||
      !Number.isFinite(position.cost) || !(position.cost>0) || !Number.isFinite(proceeds) || proceeds<=0) return null;
  const completed=fills.filter(f=>f.side==='sell' && f.wallet===position.wallet &&
    f.profile===position.profile && f.mint===position.mint && f.riseStep?.cycle===position.cycle &&
    Number.isSafeInteger(f.riseStep.step) && f.riseStep.step>0 &&
    Number.isFinite(f.riseStep.triggerUnit) && f.riseStep.triggerUnit>0)
    .reduce((latest,f)=>!latest || f.riseStep.step>latest.step ? f.riseStep : latest,null);
  const step=(completed?.step || 0)+1;
  const triggerUnit=(completed?.triggerUnit || position.cost/rawNumber)*1.2;
  const triggerValue=triggerUnit*rawNumber;
  if (!Number.isFinite(triggerValue)) return null;
  const sellRaw=raw*30n/100n;
  const triggered=sellRaw>0n && proceeds>=triggerValue-1e-9;
  return {cycle:position.cycle,step,triggerUnit,triggerValue,positionRaw:raw.toString(),
    raw:triggered?sellRaw.toString():null,partial:triggered,triggered,
    reason:triggered?'20% Rise — Sell 30%':null,dust:sellRaw===0n};
}
export function buildPositions(fills) {
  const positions = {}, closed=[];
  for (let f of [...fills].sort((a,b)=>a.time-b.time || (a.order||0)-(b.order||0))) {
    // Manual wallet sales can be submitted from a different profile's panel.
    // Attribute only when one existing position in this wallet owns the coin;
    // ambiguous ownership or an unexplained excess remains unverified.
    if (f.side === 'sell' && String(f.source || '').startsWith('manual:')) {
      const owners=Object.values(positions).filter(p=>p.wallet===f.wallet && p.mint===f.mint && BigInt(p.raw)>0n);
      if (owners.length===1 && owners[0].verified && BigInt(f.raw)<=BigInt(owners[0].raw)) {
        f={...f,profile:owners[0].profile};
      }
    }
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
