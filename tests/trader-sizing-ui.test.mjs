import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../trader-sizing.js',import.meta.url),'utf8');
function harness(fetch) {
 const nodes=new Map(),events={};const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,value:'safe',textContent:'',events:{},addEventListener(t,fn){this.events[t]=fn;},removeAttribute(key){delete this[key];}});return nodes.get(id);};
 node('traderPicker').hidden=true;
 const state={auth:{role:'owner'},settings:{frogDeposit:'100',frogSurviveMax:'10',frogBuyMode:'exact'},strategy:{activeProfile:'safe'},profiles:{safe:{running:false}},copyDirectory:{traders:[]}};
 const window={copyTradeState:state,appPath:p=>'/copytrade'+p,addEventListener:(type,fn)=>events[type]=fn};
 vm.runInNewContext(code,{window,document:{getElementById:node},fetch,AbortController,setTimeout,clearTimeout,Intl,Date,Map,encodeURIComponent,queueMicrotask:fn=>fn()});
 return {node,state,send:()=>events['copytrade-state']({detail:state})};
}
const snapshot={checkedAt:'2026-11-15T12:00:00Z',latestBuy:{value:'0.25',symbol:'SOL',timestamp:100,signature:'test'},typical:[{value:'0.2',symbol:'SOL',count:3}],buyCount:3,transactionsScanned:8,balances:{sol:{value:'2',symbol:'SOL'},usdc:{value:'10',symbol:'USDC'}}};
test('the amounts view reads the draft trader without switching, starting or changing the account',async()=>{
 const calls=[],h=harness(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>snapshot};});
 const original=JSON.stringify(h.state);h.node('traderPicker').hidden=false;h.node('selectedTrader').value='frog';h.node('selectedTrader').events.change();
 await h.node('checkTraderSizing').events.click();
 assert.match(h.node('traderSizingTitle').textContent,/Deku/);assert.equal(h.node('traderLatestBuy').textContent,'0.25 SOL');assert.match(h.node('traderSizingOwn').textContent,/\$100.00/);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/copytrade/api/trader-sizing?profile=frog');assert.equal(calls[0].options.method,undefined);assert.equal(JSON.stringify(h.state),original);
 h.state.profiles.safe.running=true;h.send();await h.node('checkTraderSizing').events.click();assert.equal(calls.length,1);assert.equal(h.node('checkTraderSizing').disabled,true);
});
test('late replies stay with their original trader and are discarded after logout',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));
 const request=h.node('checkTraderSizing').events.click();h.node('traderPicker').hidden=false;h.node('selectedTrader').value='frog';h.node('selectedTrader').events.change();
 resolve({ok:true,json:async()=>snapshot});await request;
 assert.match(h.node('traderSizingTitle').textContent,/Deku/);assert.equal(h.node('traderLatestBuy').textContent,'Not checked');
 const next=h.node('checkTraderSizing').events.click();h.state.auth=null;h.send();resolve({ok:true,json:async()=>snapshot});await next;assert.equal(h.node('traderSizing').hidden,true);
 h.state.auth={role:'owner'};h.send();assert.equal(h.node('traderLatestBuy').textContent,'Not checked');
});
