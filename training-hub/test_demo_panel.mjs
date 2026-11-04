import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const html=fs.readFileSync(new URL('paper_math/demo.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function page(){
 const nodes=new Map();
 const elem=()=>({textContent:'',children:[],disabled:false,append(n){this.children.push(n)},replaceChildren(){this.children=[]}});
 for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],elem());
 const context={document:{getElementById:id=>nodes.get(id),createElement:elem},setInterval(){},fetch:()=>new Promise(()=>{})};
 vm.createContext(context);vm.runInContext(script,context);return {context,nodes};
}
function all(n){return n.textContent+' '+n.children.map(all).join(' ')}
const ledger={equity:'5000',costs:'0',closed_max_drawdown:'0',filled:0,no_trade:0,rejected:0,not_verified:0};
const base={state:'RUNNING',started:1800000000,ends:1800604800,original_ledger:ledger,checked_ledger:ledger,cases:[],next_offset:null};
test('pending has no invented future or completed profit',()=>{
 const {context,nodes}=page();context.render({...base,cases:[{created:1800000000,status:'PENDING',question:'Inputs only',commitment:'abc'}]});
 assert.match(all(nodes.get('history')),/Waiting for a completed decision/);
 assert.doesNotMatch(all(nodes.get('history')),/Original simulated result/);
 assert.equal(nodes.get('start').disabled,true);
});
test('open positions and raw answer visible without realized P/L',()=>{
 const {context,nodes}=page();context.render({...base,cases:[{created:1800000000,status:'OBSERVING',question:'Inputs',positions:{original:{status:'OPEN',pnl:null}},answer:{raw:'raw'},commitment:'a'}]});
 assert.match(all(nodes.get('history')),/OPEN/);assert.match(all(nodes.get('history')),/raw/);
 assert.doesNotMatch(all(nodes.get('history')),/Original simulated result/);
});
test('failed arithmetic remains visible when paper trade wins',()=>{
 const {context,nodes}=page();context.render({...base,cases:[{created:1800000000,status:'COMPLETE',question:'Inputs',answer:{raw:'incorrect totals'},precommit:{source_snapshot:'notes'},observations:[],result:{feedback:'Original arithmetic FAIL',assessment:{status:'FAIL',final_result:{}},original:{status:'TARGET',pnl:'5',costs:'1'},checked:{status:'TARGET',pnl:'6'}}}]});
 const text=all(nodes.get('history'));assert.match(text,/FAIL/);assert.match(text,/net \$5/);assert.match(text,/incorrect totals/);
});
test('unknown equity and feed failure are explicit',()=>{
 const {context,nodes}=page();context.render({...base,state:'PAUSED',original_ledger:{...ledger,equity:null},health:{state:'WAITING_FEED',reason:'No fresh data'}});
 assert.equal(nodes.get('equity').textContent,'Unresolved');assert.match(nodes.get('feed-status').textContent,/No fresh data/);
});
