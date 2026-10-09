// Keep push subscriptions alive; only background work sleeps. Trading controls
// and the freshness required before signing are deliberately independent.
export function createMonitorSleep({now=Date.now,idleAfterMs=120000,idleRefreshMs=60000,recoveryPollMs=30000}={}) {
  let lastTradeAt=now();
  const observeTrade=(at=now()) => {
    const value=Number(at);
    if(Number.isFinite(value) && value<=now()) lastTradeAt=Math.max(lastTradeAt,value);
  };
  function status({report,listenerReady=false,queuedReads=false}={}) {
    const exposed=!report || Object.values(report.positions || {}).some(p=>String(p.raw || '0')!=='0') ||
      Object.keys(report.pending || {}).length>0 || (report.pendingSells || []).some(j=>j.requiresActiveChecks!==false) || report.growth?.status==='closing';
    const sleeping=listenerReady && !exposed && !queuedReads && now()-lastTradeAt>=idleAfterMs;
    return {enabled:true,sleeping,mode:sleeping?'Saving credits — listening for trader activity':'Active checks',
      listenerReady,lastTradeAt:new Date(lastTradeAt).toISOString(),idleAfterMs,
      walletRefreshMs:sleeping?idleRefreshMs:null,recoveryPollMs:sleeping?recoveryPollMs:1000};
  }
  return {observeTrade,status};
}
