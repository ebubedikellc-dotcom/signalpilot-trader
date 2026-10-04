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
  if (mode === 'exact' || !(cost>0) || !Number.isFinite(proceeds) || proceeds<0) return null;
  if (proceeds <= cost*0.7 + 1e-9) return '30% loss limit';
  if (mode === 'limits' && proceeds >= cost*1.6 - 1e-9) return '60% profit target';
  return null;
}
export function buildPositions(fills) {
  const positions = {}, closed=[];
  for (const f of [...fills].sort((a,b)=>a.time-b.time || (a.order||0)-(b.order||0))) {
    const key=`${f.wallet}:${f.profile}:${f.mint}`;
    const p=positions[key] ||= {key,wallet:f.wallet,profile:f.profile,mint:f.mint,raw:'0',cost:0,verified:true};
    const amount=BigInt(f.raw); if(amount<=0n || !Number.isFinite(f.usd) || f.usd<0) continue;
    if(f.side==='buy'){p.raw=(BigInt(p.raw)+amount).toString();p.cost+=f.usd;}
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
