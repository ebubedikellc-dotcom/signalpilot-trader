// Read-only view. This component has no Start, order, settings or deposit actions.
(() => {
  const el=id=>document.getElementById(id),card=el('traderSizing');
  if(!card)return;
  let state=window.copyTradeState||{},pending=null,controller=null,session=0;
  const results=new Map(),messages=new Map();
  const active=()=>state.strategy?.activeProfile||'frog';
  const selected=()=>!el('traderPicker').hidden?(el('selectedTrader').value||active()):active();
  const running=()=>Object.values(state.profiles||{}).some(p=>p.running);
  const name=profile=>state.copyDirectory?.traders?.find(t=>t.id===profile)?.name||({safe:'Frog',frog:'Deku',truenest:'Trunoest'}[profile]||'Trader');
  const display=a=>a?`${a.value} ${a.symbol}`:'Unavailable';
  const time=value=>value?new Date(value).toLocaleString():'Not checked';
  const money=value=>Number.isFinite(Number(value))&&Number(value)>0?new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(value)):'Not set';
  function render() {
    const owner=state.auth?.role==='owner';card.hidden=!owner;if(!owner)return;
    const profile=selected(),data=results.get(profile),settings=state.settings||{};
    el('traderSizingTitle').textContent=`${name(profile)} · trade sizes`;
    el('checkTraderSizing').disabled=Boolean(pending)||running();
    el('checkTraderSizing').textContent=pending===profile?'Checking…':'Check trader amounts';
    const checking=profile===active()?'':'Previewing this trader. Use this trader saves your selection. ';
    el('traderSizingStatus').textContent=checking+(pending===profile?'Reading a small sample of confirmed swaps…':messages.get(profile)||
      (data?`Checked ${time(data.checkedAt)}${data.cached?' · Cached':''}. ${data.message||''}`:'Check public wallet activity before comparing amounts.'))+
      (running()?' Copying is running; fresh amount lookups are paused.':'');
    const buy=data?.latestBuy;
    el('traderLatestBuy').textContent=buy?display(buy):data?'No verified buy in this sample':'Not checked';
    el('traderLatestTime').textContent=buy?time(buy.timestamp*1000):'';
    const link=el('traderBuyLink');link.hidden=!buy?.signature;
    if(buy?.signature)link.href='https://solscan.io/tx/'+encodeURIComponent(buy.signature);else link.removeAttribute('href');
    el('traderTypicalBuy').textContent=data?.typical?.length?data.typical.map(a=>`${display(a)} (${a.count} ${a.count===1?'buy':'buys'})`).join(' · '):data?'Not enough verified data':'Not checked';
    el('traderBuySample').textContent=data?`${data.buyCount||0} verified buys in ${data.transactionsScanned||0} recent transactions checked. This is a small sample, not the full history.`:'Up to 8 recent transactions; complex swaps may be unavailable.';
    el('traderQuoteBalance').textContent=data?`${display(data.balances?.sol)} / ${display(data.balances?.usdc)}`:'Not checked';
    const full=settings.frogBuyMode==='exactFull',limit=settings.frogSurviveMax === '' ? '' : Number(settings.frogSurviveMax)>0 ? settings.frogSurviveMax : '5';
    const budget=settings.frogDeposit || settings.truenestDeposit;
    el('traderSizingOwn').textContent=`Your saved budget: ${money(budget)} · Highest buy: ${full?'Trader’s full amount mode':limit&&Number(limit)>0?money(limit):'No separate cap'} · Available funds and locked profit are checked separately. Viewing amounts never changes these settings.`;
  }
  async function check() {
    if(pending||state.auth?.role!=='owner'||running())return;
    const profile=selected(),currentSession=session;
    pending=profile;messages.delete(profile);const aborter=new AbortController();controller=aborter;const timer=setTimeout(()=>aborter.abort(),60000);render();
    try {
      const url=window.appPath?window.appPath('/api/trader-sizing'):'/api/trader-sizing';
      const response=await fetch(url+'?profile='+encodeURIComponent(profile),{credentials:'same-origin',cache:'no-store',signal:aborter.signal});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Amounts are unavailable.');
      if(currentSession!==session)return;
      if(data.checkedAt)results.set(profile,data);
      else messages.set(profile,data.message||'Amounts are unavailable.');
    }catch(error){if(currentSession===session)messages.set(profile,error.name==='AbortError'?'The lookup timed out. Try again later.':error.message);}
    finally {clearTimeout(timer);if(currentSession===session){pending=null;controller=null;render();}}
  }
  window.addEventListener('copytrade-state',event=>{
    state=event.detail;
    if(state.auth?.role!=='owner'){session++;controller?.abort();pending=null;controller=null;results.clear();messages.clear();}
    // The main dashboard updates the selector later in this same event turn.
    queueMicrotask(render);
  });
  el('selectedTrader').addEventListener('change',render);
  el('changeTrader').addEventListener('click',()=>queueMicrotask(render));
  el('checkTraderSizing').addEventListener('click',check);
  render();
})();
