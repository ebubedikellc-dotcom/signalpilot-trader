// Keep the journal intact. Only unresolved orders and open holdings belong in
// current diagnostics; closed-coin notices remain separately available as history.
export function currentExitNotices(report,sourceSells={}) {
  const active=new Set(Object.entries(report.positions || {}).filter(([,p])=>BigInt(p.raw||'0')>0n).map(([key])=>key));
  for(const key of Object.keys(report.pending || {}))active.add(key);
  for(const key of Object.keys(sourceSells))active.add(key);
  const current={},previous={};
  for(const [key,message] of Object.entries(report.notices || {})) {
    const p=report.positions?.[key] || report.pending?.[key];
    const label=p?.mint ? `${p.mint.slice(0,6)}…: ` : '';
    (active.has(key)?current:previous)[key]=label+message;
  }
  return {current,previous};
}
