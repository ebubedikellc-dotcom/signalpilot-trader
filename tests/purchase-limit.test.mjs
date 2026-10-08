import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const script=readFileSync(new URL('../script.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));

function harness() {
 const state={settings:{frogBuyMode:'trailing',frogSurviveMax:'20',safeSurviveMax:'5',truenestSurviveMax:'5',frogDeposit:'50',profitMode:'save',trailingStopPercent:'10'},strategy:{activeProfile:'safe',controlRevision:1},profiles:{safe:{running:true},frog:{running:true},truenest:{running:true}},activity:[]};
 let saves=0;
 const c=vm.createContext({Date,Number,Math,Object,String,defaultBuyMode:'limits',surviveBuyUsd:5,
   profileBuyMode:s=>s.settings.frogBuyMode,clean:x=>x,executionJournal:{load:async()=>({})},
   readState:async()=>state,requireOwner:()=>false,sessionFromRequest:()=>({role:'owner'}),readBody:async r=>r.body,
   saveState:async()=>{saves++;},statusPayload:s=>s,line:x=>x,send:(_,code,body)=>{c.output={code,body}}});
 vm.runInContext(section(server,'function syncQueueSurviveSettings(', 'function isLegacyUnsupportedSwapSkip('),c);
 vm.runInContext(section(server,'function profileSurviveMaxUsd(', '// An owner-confirmed token sale'),c);
 vm.runInContext(section(server,'function buyUsdAmount(', 'function sourceUsdFromSignal('),c);
 vm.runInContext(section(server,'async function handleApi(', 'function serveFile('),c);
 return {c,state,saves:()=>saves,save:async amountUsd=>{await c.handleApi({method:'POST',body:{amountUsd}},{},{pathname:'/api/purchase-limit'});return c.output;}};
}

test('old divergent limits normalize to the owner-facing saved limit and survive reload',()=>{
 const h=harness();h.c.syncQueueSurviveSettings(h.state.settings);
 assert.equal(h.state.settings.safeSurviveMax,'20');assert.equal(h.state.settings.truenestSurviveMax,'20');
 const reloaded=JSON.parse(JSON.stringify(h.state));h.c.syncQueueSurviveSettings(reloaded.settings);
 assert.equal(reloaded.settings.safeSurviveMax,'20');
});
test('capped modes and all three traders obey the shared ceiling and still copy smaller buys',()=>{
 const h=harness();
 for(const mode of ['limits','exact','loss','trailing','takeback']) {
  h.state.settings.frogBuyMode=mode;h.c.syncQueueSurviveSettings(h.state.settings);
  for(const profile of ['safe','frog','truenest']) {
   assert.equal(h.c.buyUsdAmount(h.state,profile,50),20);
   assert.equal(h.c.buyUsdAmount(h.state,profile,3),3);
   assert.equal(h.c.buyUsdAmount(h.state,profile,NaN),0);
  }
 }
});
test('profit ladder uses the shared ceiling without increasing smaller buys',async()=>{
 const h=harness();
 await h.c.handleApi({method:'POST',body:{frogBuyMode:'ladder'}},{},{pathname:'/api/settings'});
 assert.equal(h.c.output.code,200);
 for(const profile of ['safe','frog','truenest']) {
  assert.equal(h.state.settings[profile+'BuyMode'],'ladder');
  assert.equal(h.c.buyUsdAmount(h.state,profile,50),20);
  assert.equal(h.c.buyUsdAmount(h.state,profile,3),3);
  assert.equal(h.c.buyUsdAmount(h.state,profile,NaN),0);
 }
 const settings=JSON.parse(JSON.stringify(h.state.settings));h.c.syncQueueSurviveSettings(settings);
 assert.equal(settings.frogBuyMode,'ladder');assert.equal(settings.frogSurviveMax,'20');
});
test('full-amount mode bypasses only the purchase ceiling and survives settings reload for all traders',async()=>{
 const h=harness();
 await h.c.handleApi({method:'POST',body:{frogBuyMode:'exactFull'}},{},{pathname:'/api/settings'});
 assert.equal(h.c.output.code,200);
 for(const profile of ['safe','frog','truenest']) {
  assert.equal(h.state.settings[profile+'BuyMode'],'exactFull');
  assert.equal(h.c.buyUsdAmount(h.state,profile,50),50);
  assert.equal(h.c.buyUsdAmount(h.state,profile,3),3);
  assert.equal(h.c.buyUsdAmount(h.state,profile,NaN),0);
 }
 const settings=JSON.parse(JSON.stringify(h.state.settings));h.c.syncQueueSurviveSettings(settings);
 assert.equal(settings.frogBuyMode,'exactFull');assert.equal(settings.frogSurviveMax,'20');
 assert.equal(settings.frogDeposit,'50');assert.equal(settings.profitMode,'save');
 assert.equal(h.state.strategy.activeProfile,'safe');
 await h.c.handleApi({method:'POST',body:{frogBuyMode:'exact'}},{},{pathname:'/api/settings'});
 assert.equal(h.c.buyUsdAmount(h.state,'safe',50),20);
});
test('saving a limit changes only the cap and revision, not running state, trader, mode, budget or exits',async()=>{
 const h=harness();const result=await h.save('12.50');assert.equal(result.code,200);
 for(const profile of ['safe','frog','truenest'])assert.equal(h.state.settings[profile+'SurviveMax'],'12.5');
 assert.equal(h.state.settings.frogBuyMode,'trailing');assert.equal(h.state.settings.frogDeposit,'50');
 assert.equal(h.state.settings.profitMode,'save');assert.equal(h.state.settings.trailingStopPercent,'10');
 assert.equal(h.state.strategy.activeProfile,'safe');assert(h.state.strategy.controlRevision>1);
 assert(Object.values(h.state.profiles).every(p=>p.running));assert.equal(h.saves(),1);
});
test('saving while stopped does not start trading and accepts cents',async()=>{
 const h=harness();Object.values(h.state.profiles).forEach(p=>p.running=false);
 assert.equal((await h.save('0.01')).code,200);
 assert(Object.values(h.state.profiles).every(p=>!p.running));
 assert.equal(h.c.buyUsdAmount(h.state,'safe',20),0.01);
});
test('invalid limits never persist or change the saved ceiling',async()=>{
 for(const input of [0,-1,'abc','Infinity',null,true,{},'0.001','5.001',1000000001]) {
  const h=harness();assert.equal((await h.save(input)).code,400,String(input));
  assert.equal(h.saves(),0);assert.equal(h.state.settings.frogSurviveMax,'20');
 }
});
test('purchase-limit endpoint requires owner authorization',async()=>{
 const h=harness();h.c.requireOwner=()=>true;
 await h.save('99');assert.equal(h.saves(),0);assert.equal(h.state.settings.frogSurviveMax,'20');
});

test('visible Save limit submits only the chosen cap and clears its draft only after success',async()=>{
 const requests=[],messages=[];const button={disabled:false};let render;
 const c=vm.createContext({Number,Math,JSON,String,purchaseLimitDirty:true,value:()=> '25',
   $:()=>button,setText:(_,v)=>messages.push(v),api:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {settings:{frogSurviveMax:'25'}};},renderState:s=>render=s});
 vm.runInContext(section(script,'async function savePurchaseLimit(', 'async function ownerWithdraw('),c);
 await c.savePurchaseLimit();assert.equal(requests[0].url,'/api/purchase-limit');
 assert.deepEqual(requests[0].body,{amountUsd:'25'});assert.equal(render.settings.frogSurviveMax,'25');
 assert.equal(c.purchaseLimitDirty,false);assert.equal(button.disabled,false);
 c.purchaseLimitDirty=true;c.api=async()=>{throw new Error('Offline')};await c.savePurchaseLimit();
 assert.equal(c.purchaseLimitDirty,true);assert.match(messages.at(-1),/Not saved: Offline/);assert.equal(button.disabled,false);
});

test('blank highest buy persists through reload and copies full source amount without changing mode',async()=>{
 const h=harness();const result=await h.save('');assert.equal(result.code,200);
 for(const profile of ['safe','frog','truenest']) {
  assert.equal(h.state.settings[profile+'SurviveMax'],'');
  assert.equal(h.c.buyUsdAmount(h.state,profile,2),2);
  assert.equal(h.c.buyUsdAmount(h.state,profile,20),20);
 }
 const reloaded=JSON.parse(JSON.stringify(h.state));h.c.syncQueueSurviveSettings(reloaded.settings);
 assert.equal(reloaded.settings.frogSurviveMax,'');assert.equal(h.state.settings.frogBuyMode,'trailing');
 await h.save('10');
 for(const amount of [2,7,20])assert.equal(h.c.buyUsdAmount(h.state,'safe',amount),Math.min(amount,10));
});
test('blank visible highest buy submits an explicit empty string rather than zero',async()=>{
 const requests=[];const c=vm.createContext({Number,Math,JSON,String,purchaseLimitDirty:true,value:()=> '',
 $:()=>({disabled:false}),setText:()=>{},api:async(url,options)=>{requests.push(JSON.parse(options.body));return {};},renderState:()=>{}});
 vm.runInContext(section(script,'async function savePurchaseLimit(', 'async function ownerWithdraw('),c);
 await c.savePurchaseLimit();assert.deepEqual(requests[0],{amountUsd:''});
});
