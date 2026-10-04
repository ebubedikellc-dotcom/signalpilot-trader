import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const requestCode=code.slice(code.indexOf('async function fetchOfficialGmgnTransactionsForAddress'),code.indexOf('async function fetchGmgnTransactionsForAddress'));
function client(response) {
 let request;
 const c=vm.createContext({URL,Date,String,Array,JSON,AbortSignal,randomUUID:()=> 'test-uuid',gmgnActivityToTransaction:a=>a,fetch:async(url,options)=>{request={url,options};return response;}});
 vm.runInContext(requestCode,c);
 return {c,request:()=>request};
}
test('official read-only request uses API key, timestamp and repeated buy/sell filters',async()=>{
 const h=client({ok:true,headers:new Headers(),text:async()=>JSON.stringify({code:0,data:{activities:[{event_type:'buy'}]}})});
 assert.equal((await h.c.fetchOfficialGmgnTransactionsForAddress('secret','wallet')).length,1);
 assert.deepEqual(h.request().url.searchParams.getAll('type'),['buy','sell']);
 assert.equal(h.request().options.headers['X-APIKEY'],'secret');
 assert.equal(h.request().url.origin,'https://openapi.gmgn.ai');
});
test('security block reports the reason and request ID without raw response or credentials',async()=>{
 const h=client({ok:false,status:403,headers:new Headers({'cf-ray':'abc-123'}),text:async()=>'<html>browser_signature_banned Error 1010 secret-value</html>'});
 await assert.rejects(h.c.fetchOfficialGmgnTransactionsForAddress('secret','wallet'),e=>/1010/.test(e.message)&&/abc-123/.test(e.message)&&!e.message.includes('secret-value'));
});
test('unexpected successful payload cannot falsely report a connected empty feed',async()=>{
 const h=client({ok:true,headers:new Headers(),text:async()=>JSON.stringify({code:0,data:{wrong:[]}})});
 await assert.rejects(h.c.fetchOfficialGmgnTransactionsForAddress('secret','wallet'),/unexpected/);
});
test('read-only check leaves profiles stopped and does not save or run workers',async()=>{
 const state={settings:{gmgnApiKey:'secret'},profiles:{frog:{running:false}},strategy:{activeProfile:'frog'}};
 let output;
 const c=vm.createContext({Date,String,process:{env:{}},supportedProfiles:['frog'],readState:async()=>state,requireOwner:()=>false,sessionFromRequest:()=>({role:'owner'}),targetWallet:()=> 'wallet',fetchOfficialGmgnTransactionsForAddress:async()=>[],send:(_r,status,result)=>{output={status,result}},gmgnConnectionCheck:null,gmgnCheckRunning:false,gmgnLastCheckAt:0});
 const start=code.indexOf('async function handleApi');const end=code.indexOf('  if (request.method === "POST" && url.pathname === "/api/monitor/observe")',start);
 vm.runInContext(code.slice(start,end)+'}',c);
 await c.handleApi({method:'POST'},{},{pathname:'/api/gmgn/check'});
 assert.equal(output.result.ok,true);assert.equal(output.result.tradingStarted,false);assert.equal(state.profiles.frog.running,false);
});

test('repair release stops old sessions and preserves settings; explicit later starts survive reads',()=>{
 const c=vm.createContext({supportedProfiles:['safe','frog','truenest']});
 vm.runInContext(code.slice(code.indexOf('function releaseGmgnRepairHold'),code.indexOf('function normalizeState')),c);
 const state={settings:{providerRepairHold:true,frogSurviveMax:'30',trailingStopPercent:'10'},profiles:{safe:{running:true},frog:{running:true},truenest:{running:true}}};
 c.releaseGmgnRepairHold(state);
 assert.equal(state.settings.providerRepairHold,false);
 assert.ok(Object.values(state.profiles).every(p=>!p.running));
 assert.equal(state.settings.frogSurviveMax,'30');
 assert.equal(state.settings.trailingStopPercent,'10');
 state.profiles.safe.running=true;
 c.releaseGmgnRepairHold(state);
 assert.equal(state.profiles.safe.running,true);
 state.settings.providerRepairHold=true;
 c.releaseGmgnRepairHold(state);
 assert.equal(state.settings.providerRepairHold,true);
});
