const el=id=>document.getElementById(id);
const names={solana:'Solana copying',gold:'Gold · XAU/USD',forex:'Forex · EUR/USD'};
let market='solana',state=window.copyTradeState||{},directory={accounts:[],traders:[]};
const request=async(path,body)=>{const r=await fetch(window.appPath?window.appPath(path):path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not save.');return data;};
function element(tag,text,cls){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
function record(title,description,link){const card=element('article','','desk-record');card.append(element('h3',title),element('p',description));if(link){try{const u=new URL(link);if(u.protocol==='https:'){const a=element('a','View public profile ↗');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}}catch{}}return card;}
function render(){
 directory=state.copyDirectory||directory;
 const owner=state.auth?.role==='owner',running=Object.values(state.profiles||{}).some(p=>p.running);
 el('deskBadge').textContent=owner?(running?'Solana copying active':'Copying stopped'):'Sign in to view status';
 for(const id of ['deskAddTrader','deskAddAccount','saveGoldCandidate'])el(id).disabled=!owner||running;
 el('marketTitle').textContent=names[market];
 el('marketDescription').textContent=market==='solana'?'Use your existing wallet. Select one trader at a time below; new traders join the same list.':`Save ${market==='gold'?'gold':'EUR/USD'} accounts and providers here. A compatible broker connection is still required.`;
 el('brokerConnection').hidden=market==='solana';el('goldCandidate').hidden=market!=='gold';el('forexCandidates').hidden=market!=='forex';
 el('deskRecords').replaceChildren();
 if(owner){
   if(market==='solana')el('deskRecords').append(record('Existing Solana account',state.settings?.frogTradeWallet?`Wallet retained · ${state.settings.frogTradeWallet.slice(0,7)}…${state.settings.frogTradeWallet.slice(-5)} · Shared budget and locked profit apply.`:'Connect the trading wallet in Settings.'));
   for(const a of directory.accounts.filter(a=>a.market===market))el('deskRecords').append(record(a.name,`${a.broker} · ${a.platform} · ${a.mode} · Connection required`));
   for(const t of directory.traders.filter(t=>t.market===market))el('deskRecords').append(record(t.name,market==='solana'?'Source saved. Choose it under Change trader, then press Start when ready.':'Saved for review · Provider fees and broker connection require verification.',t.profileUrl));
 }
 const accounts=el('traderSetup').elements.accountId;const selected=accounts.value;accounts.replaceChildren(new Option('Choose later',''));
 for(const a of directory.accounts.filter(a=>a.market===market))accounts.add(new Option(a.name,a.id));accounts.value=selected;
 el('traderWalletField').hidden=market!=='solana';el('traderAccountField').hidden=market==='solana';
 el('traderSetup').elements.wallet.required=market==='solana';el('traderSetup').elements.profileUrl.required=market!=='solana';
 el('traderSetupHelp').textContent=market==='solana'?"Use the trader's public wallet address. Adding a trader does not start copying.":'Save the public strategy link for review. This does not subscribe to a provider or connect a broker.';
 document.body.dataset.copyMarket=market;
 document.querySelectorAll('[data-market]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.market===market)));
 for(const node of el('copyDesk').parentElement.children){if(node===el('copyDesk')||node.querySelector('#authPanel'))continue;node.toggleAttribute('data-market-hidden',market!=='solana'||!owner);}
}
function notice(message){el('deskNotice').textContent=message;}
window.addEventListener('copytrade-state',e=>{state=e.detail;render();notice(state.auth?.role==='owner'?(Object.values(state.profiles||{}).some(p=>p.running)?'Stop copying before adding or changing a trader.':'Choose a market above. Saving an account or trader does not start trading.'):'Sign in below to view your saved accounts and traders.');});
for(const b of document.querySelectorAll('[data-market]'))b.addEventListener('click',()=>{market=b.dataset.market;el('traderSetup').hidden=true;el('accountSetup').hidden=true;render();});
function openForm(id){el('traderSetup').hidden=id!=='traderSetup';el('accountSetup').hidden=id!=='accountSetup';const platform=el('accountSetup').elements.platform;for(const option of platform.options)option.hidden=(option.value==='solana')!==(market==='solana');platform.value=market==='solana'?'solana':'ctrader';el(id).querySelector('input').focus();}
el('deskAddTrader').onclick=()=>openForm('traderSetup');el('deskAddAccount').onclick=()=>openForm('accountSetup');
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>el(b.dataset.close).hidden=true;
el('saveGoldCandidate').onclick=()=>{openForm('traderSetup');el('traderSetup').elements.name.value='GOLD ORBIT';el('traderSetup').elements.profileUrl.value='https://app.ctrader.com/copy/strategy/115140';};
for(const [id,path] of [['traderSetup','traders'],['accountSetup','accounts']])el(id).addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;
 try{const result=await request('/api/copy-directory/'+path,{...Object.fromEntries(new FormData(form)),market});state=result.status;directory=result.directory;window.copyTradeState=state;if(typeof window.renderState==='function')window.renderState(state);render();form.reset();form.hidden=true;notice(path==='accounts'?'Account entry saved. A connection still needs to be configured.':market==='solana'?'Trader saved. Choose it under Change trader below. Copying remains stopped.':'Trader saved for review. Broker copying is not connected.');}
 catch(error){notice(error.message);}finally{button.disabled=false;}
});
render();
