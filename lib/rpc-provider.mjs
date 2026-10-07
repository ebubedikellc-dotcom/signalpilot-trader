export function rpcProvider(settings={},env={}, {publicOnly=false,direct=false,publicNode=false}={}) {
  if(publicNode)return {http:'https://solana-rpc.publicnode.com',name:'PublicNode',secret:'',public:true,readIntervalMs:250,readConcurrency:2};
  const publicProvider={http:'https://api.mainnet-beta.solana.com',ws:'wss://api.mainnet-beta.solana.com',name:'Public Solana',secret:'',public:true};
  if(publicOnly)return publicProvider;
  const alchemy=String(settings.alchemyKey || env.ALCHEMY_API_KEY || '').trim();
  if(alchemy)return {http:`https://solana-mainnet.g.alchemy.com/v2/${encodeURIComponent(alchemy)}`,ws:`wss://solana-mainnet.streaming.alchemy.com/v2/${encodeURIComponent(alchemy)}`,name:'Alchemy',secret:alchemy,public:false};
  // Keep alerts independent of an exhausted Helius account.
  if(direct)return publicProvider;
  const helius=String(settings.heliusKey || env.HELIUS_API_KEY || '').trim();
  return helius ? {http:`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(helius)}`,name:'Helius',secret:helius,public:false} : publicProvider;
}

export function monitoredProfiles(state,report,supported) {
  const selected=supported.includes(state.strategy?.activeProfile) ? state.strategy.activeProfile : supported[0];
  const wanted=new Set([selected]);
  // Retain existing traders until the journal has loaded and identifies holdings.
  if(!report)return [...new Set([selected,...supported])];
  for(const position of Object.values(report.positions || {})) {
    if(supported.includes(position.profile) && BigInt(position.raw || '0')>0n)wanted.add(position.profile);
  }
  for(const pending of Object.values(report.pending || {})) {
    if(supported.includes(pending.profile))wanted.add(pending.profile);
  }
  return [...wanted];
}
