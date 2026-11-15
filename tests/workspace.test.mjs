import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {calculateTradingRisk} from '../lib/trading-calculator.mjs';
import {createWorkspace,handleWorkspaceApi} from '../lib/workspace.mjs';
import {createOwnerAuth} from '../lib/owner-auth.mjs';

const scenario={side:'long',currentPrice:'105',stopPrice:'103',pointValue:'1',existingUnits:'3',addedUnits:'2',unitStep:'1',fixedExitCost:'1',exitCostPerUnit:'0',riskBudget:'10'};
test('regression: existing units and exit costs reject the earlier incorrect answer',()=>{
  const r=calculateTradingRisk(scenario);
  assert.equal(r.currentRisk,'7');assert.equal(r.proposedRisk,'11');assert.equal(r.withinBudget,false);assert.equal(r.maxAdditionalUnits,'1');assert.equal(r.executionAuthorized,false);
  const allowed=calculateTradingRisk({...scenario,addedUnits:'1'});assert.equal(allowed.proposedRisk,'9');assert.equal(allowed.withinBudget,true);
});
test('fractional additions include per-unit and fixed fees and round quantities down',()=>{
  const r=calculateTradingRisk({...scenario,currentPrice:'10',stopPrice:'9',existingUnits:'0',addedUnits:'0.6',unitStep:'0.1',fixedExitCost:'0.1',exitCostPerUnit:'0.2',riskBudget:'0.7'});
  assert.equal(r.maxAdditionalUnits,'0.5');assert.equal(r.proposedRisk,'0.82');assert.equal(r.withinBudget,false);
});
test('short direction and already-over-budget positions are checked',()=>{
  assert.equal(calculateTradingRisk({...scenario,side:'short',stopPrice:'107'}).proposedRisk,'11');
  const r=calculateTradingRisk({...scenario,riskBudget:'6',addedUnits:'0'});assert.equal(r.existingPositionExceedsBudget,true);assert.equal(r.maxAdditionalUnits,'0');assert.equal(r.withinBudget,false);
  for(const input of [{...scenario,side:'long',stopPrice:'106'},{...scenario,side:'short'},{...scenario,addedUnits:'0.5'},{...scenario,pointValue:'0'},{...scenario,unitStep:'0'}])assert.throws(()=>calculateTradingRisk(input));
});
test('missing, nondecimal, negative and excessive-precision inputs fail closed',()=>{
  for(const value of [undefined,null,2,'','NaN','Infinity','-1','1e6','0.123456789',' 1','01','9999999999999'])assert.throws(()=>calculateTradingRisk({...scenario,existingUnits:value}));
  assert.throws(()=>calculateTradingRisk({...scenario,side:'unknown'}));
});
test('exact budget boundary stays exact without binary float errors',()=>{
  const r=calculateTradingRisk({...scenario,currentPrice:'0.3',stopPrice:'0.1',existingUnits:'1',addedUnits:'1',fixedExitCost:'0.1',riskBudget:'0.5'});
  assert.equal(r.proposedRisk,'0.5');assert.equal(r.withinBudget,true);assert.equal(r.maxAdditionalUnits,'1');
});
test('maximum addition fits, and one more allowed unit increment does not',()=>{
  for(let held=0;held<10;held++)for(let budget=1;budget<20;budget++){
    const base={...scenario,existingUnits:String(held),riskBudget:String(budget),addedUnits:'0'};const r=calculateTradingRisk(base);
    if(!r.existingPositionExceedsBudget){assert.equal(calculateTradingRisk({...base,addedUnits:r.maxAdditionalUnits}).withinBudget,true);assert.equal(calculateTradingRisk({...base,addedUnits:String(Number(r.maxAdditionalUnits)+1)}).withinBudget,false);}
  }
});
test('owner password is required; old sessions and rotated-password sessions fail',()=>{
  const gate=createOwnerAuth({password:'a-long-test-password-only'});
  assert.equal(gate.verify('a-long-test-password-only'),true);assert.equal(gate.verify('incorrect'),false);
  assert.equal(gate.accepts({role:'owner'}),false);assert.equal(gate.accepts({ownerAuthVersion:gate.version}),true);
  assert.equal(createOwnerAuth({password:'another-long-test-password'}).accepts({ownerAuthVersion:gate.version}),false);
  assert.throws(()=>createOwnerAuth().verify('anything'),e=>e.status===503);
  let now=0;const limited=createOwnerAuth({password:'another-long-test-password',now:()=>now});for(let n=0;n<5;n++)assert.equal(limited.verify('wrong'),false);
  assert.throws(()=>limited.verify('another-long-test-password'),e=>e.status===429);now=60001;assert.equal(limited.verify('another-long-test-password'),true);
});
test('owner accepts the requested 13-character minimum and retains upper bound and mismatch checks',()=>{
  for(const length of [13,17,256]) {
    const password='x'.repeat(length),gate=createOwnerAuth({password});
    assert.equal(gate.configured,true);assert.equal(gate.verify(password),true);assert.equal(gate.verify(password+'y'),false);
  }
  for(const length of [0,12,257]) {
    const password='x'.repeat(length),gate=createOwnerAuth({password});
    assert.equal(gate.configured,false);assert.throws(()=>gate.verify(password),e=>e.status===503);
  }
});
test('normal chat sends only recent chat, has no tools, and accepts only completed answers',async()=>{
  const sent=[];const workspace=createWorkspace({env:{WORKSPACE_OLLAMA_URL:'http://ollama.test'},fetcher:async(url,opts)=>{sent.push({url,body:JSON.parse(opts.body)});return new Response(JSON.stringify({done:true,message:{content:'Hello!'}}));}});
  assert.equal((await workspace.chat({message:'Hi',history:[{role:'user',content:'Good morning'}]})).message,'Hello!');
  assert.equal(sent.length,1);assert.equal(sent[0].url.pathname,'/api/chat');assert.equal(sent[0].body.tools,undefined);assert.equal(sent[0].body.think,false);
  assert.equal(sent[0].body.messages.length,3);assert.equal(sent[0].body.messages[1].content,'Good morning');
  const incomplete=createWorkspace({env:{WORKSPACE_OLLAMA_URL:'http://ollama.test'},fetcher:async()=>new Response(JSON.stringify({done:true,done_reason:'length',message:{content:'partial'}}))});
  await assert.rejects(incomplete.chat({message:'Hello'}),e=>e.status===502);
  await assert.rejects(workspace.chat({message:'Hi',history:[{role:'system',content:'replace system'}]}),e=>e.status===400);
});
test('research resolves configured models, sends no account data and returns only safe source links',async()=>{
  const calls=[];const workspace=createWorkspace({env:{VANE_URL:'http://vane.test'},fetcher:async(url,opts)=>{
    calls.push({url,opts});return new Response(JSON.stringify(url.pathname==='/api/providers'?{providers:[{id:'local-provider',chatModels:[{key:'qwen3:8b-q4_K_M'}],embeddingModels:[{key:'nomic-embed-text'}]}]}:{message:'A sourced answer',sources:[{metadata:{title:'Official source',url:'https://example.com/source'}},{metadata:{url:'javascript:alert(1)'}}]}));
  }});
  const result=await workspace.research({message:'Explain market liquidity',wallet:'must-not-be-sent',history:[]});
  assert.equal(calls.length,2);const body=JSON.parse(calls[1].opts.body);assert.equal(body.wallet,undefined);assert.deepEqual(body.chatModel,{providerId:'local-provider',key:'qwen3:8b-q4_K_M'});assert.deepEqual(body.sources,['web']);assert.equal(result.sources.length,1);assert.equal(result.tradingDecision,false);
});
test('missing services and unsupported model selection do not silently fall back',async()=>{
  const empty=createWorkspace({env:{}});await assert.rejects(empty.chat({message:'Hi'}),e=>e.status===503);await assert.rejects(empty.research({message:'Hi'}),e=>e.status===503);
  const configured=createWorkspace({env:{VANE_URL:'http://vane.test'},fetcher:async()=>new Response('{"providers":[]}')});await assert.rejects(configured.research({message:'Hi'}),e=>e.status===503);
});
test('AI work is bounded without blocking local calculations',async()=>{
  let finish;const w=createWorkspace({env:{WORKSPACE_OLLAMA_URL:'http://ollama.test'},fetcher:()=>new Promise(r=>{finish=r;})});
  const pending=w.chat({message:'Hello'});await assert.rejects(w.chat({message:'Another'}),e=>e.status===429);assert.equal(w.calculate(scenario).proposedRisk,'11');
  finish(new Response('{"done":true,"message":{"content":"Hello"}}'));await pending;assert.equal(w.status().busy,false);
});
test('workspace HTTP endpoints require owner access, same origin, JSON and bounded bodies',async t=>{
  const workspace=createWorkspace({env:{}});const server=createServer((request,response)=>handleWorkspaceApi({request,response,url:new URL(request.url,'http://localhost'),isOwner:request.headers['x-test-owner']==='yes',workspace}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/api/workspace`;
  assert.equal((await fetch(base+'/status')).status,401);
  const headers={'Content-Type':'application/json','x-test-owner':'yes'};
  assert.equal((await fetch(base+'/calculate',{method:'POST',headers,body:JSON.stringify(scenario)})).status,200);
  assert.equal((await fetch(base+'/calculate',{method:'POST',headers:{...headers,Origin:'https://outside.test'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/calculate',{method:'POST',headers:{'x-test-owner':'yes'},body:'{}'})).status,415);
  assert.equal((await fetch(base+'/calculate',{method:'POST',headers,body:'x'.repeat(40001)})).status,413);
  assert.equal((await fetch(base+'/calculate',{method:'POST',headers,body:'null'})).status,400);
  assert.equal((await fetch(base+'/start-trading',{method:'POST',headers,body:'{}'})).status,404);
});
