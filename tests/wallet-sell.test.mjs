import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function executeManualTokenSellLocked'),source.indexOf('function roomMatchesProfile'));
function harness(overrides={}) {
 const previews=new Map();let signed=0,submitted=0;
 const c=vm.createContext({ growthSnapshot:()=>null,executionJournal:{load:async()=>({})}, Date, Number, sellPreviews:previews, tradeWallet:()=> 'wallet',signerId:()=> 'signer',solanaAddress:mint=>({toBase58:()=>mint}),isQuoteMint:m=>m==='USDC',liveTradingAllowed:()=>true,manualSellingAllowed:()=>true,solanaConnection:()=>({}),tokenBalanceRaw:async()=> '2655117',hasPendingMint:async()=>false,profileLabel:p=>p,usdcMint:'USDC',jupiterApiKey:()=>'',recordPendingSwap:async()=> 'tx',recordExecutionResponse:async()=>{}, signSolanaTransaction:async()=>{signed++;return {signedTransactionBase64:'signed'};},jupiterJson:async()=>{submitted++;return {signature:'tx'};},...overrides});
 vm.runInContext(code,c);
 const good={wallet:'wallet',mint:'DKNG',profile:'frog',raw:'2655117',expiresAt:Date.now()+30000,order:{transaction:'prepared',outAmount:'49000000'}};
 return {previews,good,run:()=>c.executeManualTokenSellLocked({settings:{}},{profile:'frog',mint:'DKNG',previewId:'p'}),counts:()=>({signed,submitted})};
}
test('no confirmation preview or expired preview never signs or submits',async()=>{
 const h=harness();await assert.rejects(h.run(),/expired/);h.previews.set('p',{...h.good,expiresAt:0});await assert.rejects(h.run(),/expired/);assert.deepEqual(h.counts(),{signed:0,submitted:0});
});
test('changed quantity, wallet or token blocks the sale before signing',async()=>{
 for(const change of [{raw:'123'},{wallet:'other'},{mint:'OTHER'}]) {const h=harness();h.previews.set('p',{...h.good,...change});await assert.rejects(h.run(),/changed/);assert.deepEqual(h.counts(),{signed:0,submitted:0});}
});
test('a preview is single use and submits the prepared transaction only once',async()=>{
 const h=harness();h.previews.set('p',h.good);await h.run();await assert.rejects(h.run(),/expired/);assert.deepEqual(h.counts(),{signed:1,submitted:1});
});
test('pending transaction blocks a second sale before signing',async()=>{
 const h=harness({hasPendingMint:async()=>true});h.previews.set('p',h.good);await assert.rejects(h.run(),/pending/);assert.deepEqual(h.counts(),{signed:0,submitted:0});
});

test('manual sale permission is independent of the repair hold and stopped profiles',()=>{
 const c=vm.createContext({process:{env:{ENABLE_LIVE_TRADING:'true',EXECUTE_REAL_SWAPS:'true'}},jupiterApiKey:s=>s.routeApi,tradeWallet:()=> 'wallet',signerId:()=> 'signer',profileLiveTradingSwitch:()=> 'on',profileWalletSync:()=> 'Turnkey server wallet',ready:()=>true,supportedProfiles:['frog']});
 vm.runInContext(source.slice(source.indexOf('function manualSellingAllowed'),source.indexOf('function profileLabel')),c);
 const state={settings:{providerRepairHold:true,routeApi:'route',turnkeyOrgId:'org',turnkeyApiPublicKey:'public',turnkeyApiPrivateKey:'private'},profiles:{frog:{running:false}}};
 assert.equal(c.manualSellingAllowed(state,'frog'),true);
 assert.equal(c.liveTradingAllowed(state,'frog'),false);
 assert.equal(state.profiles.frog.running,false);
 c.process.env.EXECUTE_REAL_SWAPS='false';
 assert.equal(c.manualSellingAllowed(state,'frog'),false);
});
test('manual execution still requires its own sale permission',async()=>{
 const h=harness({manualSellingAllowed:()=>false});h.previews.set('p',h.good);await assert.rejects(h.run(),/not enabled/);assert.deepEqual(h.counts(),{signed:0,submitted:0});
});
