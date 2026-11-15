import {randomUUID} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';

export const copyMarkets = ['solana','gold','forex'];
export const builtInTraderNames = {safe:'Frog',frog:'Deku',truenest:'Trunoest'};
const text=(v,max=80)=>String(v ?? '').trim().slice(0,max);
const required=(v,label,max=80)=>{const s=text(v,max);if(!s)throw Error(`Enter ${label}.`);return s;};
function httpsUrl(value) {
  if(!value)return '';
  const u=new URL(String(value));
  if(u.protocol!=='https:' || u.username || u.password)throw Error('Use an HTTPS public profile link without login details.');
  if(u.href.length>500)throw Error('The profile link is too long.');
  return u.href;
}
export function normalizeCopyDirectory(value={}) {
  value=value && typeof value==='object'?value:{};
  return {accounts:Array.isArray(value.accounts)?value.accounts.slice(0,30):[],
    traders:Array.isArray(value.traders)?value.traders.slice(0,60):[]};
}
export function addCopyAccount(directory,input) {
  const d=normalizeCopyDirectory(directory);
  if(d.accounts.length>=30)throw Error('The account directory is full.');
  if(!copyMarkets.includes(input.market))throw Error('Choose Solana, Gold or Forex.');
  if(!['solana','mt5','ctrader','other'].includes(input.platform))throw Error('Choose the account platform.');
  if(!['demo','live'].includes(input.mode))throw Error('Choose demo or live.');
  if((input.market==='solana')!==(input.platform==='solana'))throw Error('Choose a platform that matches this market.');
  const account={id:'account_'+randomUUID(),name:required(input.name,'an account name'),market:input.market,
    platform:input.platform,mode:input.mode,broker:required(input.broker,'the broker or wallet service name'),
    status:'connection_required',createdAt:new Date().toISOString()};
  // This is a connection directory, never a request to create/fund a brokerage account.
  d.accounts.push(account);return {directory:d,account};
}
export function addCopyTrader(directory,input,existingWallets=[]) {
  const d=normalizeCopyDirectory(directory);
  if(d.traders.length>=60)throw Error('The trader directory is full.');
  if(!copyMarkets.includes(input.market))throw Error('Choose a market.');
  const name=required(input.name,'the trader name',60);
  if([...Object.values(builtInTraderNames),...d.traders.map(t=>t.name)].some(n=>n.toLowerCase()===name.toLowerCase()))throw Error('This trader name is already in your directory.');
  const trader={id:'copy_'+randomUUID(),name,market:input.market,createdAt:new Date().toISOString(),
    status:input.market==='solana'?'source_added':'connection_required',profileUrl:httpsUrl(input.profileUrl)};
  if(input.market==='solana') {
    try {trader.wallet=new PublicKey(String(input.wallet||'').trim()).toBase58();}catch{throw Error('Enter the trader’s valid public Solana wallet address.');}
    if([...existingWallets,...d.traders.map(t=>t.wallet)].includes(trader.wallet))throw Error('That wallet is already in your trader list.');
    trader.accountId='existing-solana';
  } else {
    if(!trader.profileUrl)throw Error('Enter the provider’s public strategy link.');
    trader.accountId=text(input.accountId);
    if(trader.accountId && !d.accounts.some(a=>a.id===trader.accountId && a.market===input.market))throw Error('Choose a saved account for this market, or leave it unassigned.');
    trader.instrument=input.market==='gold'?'XAU/USD':'EUR/USD';
    trader.feeStatus='unverified';
  }
  d.traders.push(trader);return {directory:d,trader};
}
export function registeredSolanaTraders(directory) {
  return normalizeCopyDirectory(directory).traders.filter(t=>t.market==='solana' && /^copy_[a-f0-9-]{36}$/.test(t.id) && typeof t.name==='string' && typeof t.wallet==='string');
}
export function prepareOwnerStart(state,now=Date.now()) {
  for(const p of Object.values(state.profiles||{}))p.running=false;
  state.strategy={...(state.strategy||{}),paused:false,pauseReason:'',controlRevision:Math.max(now,Number(state.strategy?.controlRevision||0)+1)};
  return state;
}

export function startReadiness(state,env={},ready=false,allowed=false) {
  if(state.settings?.providerRepairHold && state.settings?.copyConnection!=='public')return {canStart:false,code:'provider',message:'The GMGN provider is unavailable. Check your connection.'};

  if(Object.values(state.profiles||{}).some(p=>p.running))return {canStart:false,code:'running',message:'Copying is running. Stop before changing trader or account.'};
  if(env.ENABLE_LIVE_TRADING!=='true'||env.EXECUTE_REAL_SWAPS!=='true')return {canStart:false,code:'observation',message:'Observation mode. Install the Start & Markets update to make live Start available.'};
  if(!ready)return {canStart:false,code:'account',message:'Connect your existing trading wallet and signer in Settings before starting.'};
  if(state.settings?.modesConfirmed!=='yes')return {canStart:false,code:'mode',message:'Open Trading options and click Save trading mode before starting.'};
  if(!allowed)return {canStart:false,code:'permission',message:'Enable live trading for the selected trader in Settings.'};
  return {canStart:true,code:'ready',message:'Ready for Start checks. Start verifies the trader feed and wallet budget before enabling copying.'};
}
