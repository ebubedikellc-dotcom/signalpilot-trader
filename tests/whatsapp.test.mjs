import test from 'node:test';import assert from 'node:assert/strict';import{createServer}from'node:http';
import{createWhatsappGateway}from'../lib/whatsapp-gateway.mjs';import{createWorkspace,handleWorkspaceApi}from'../lib/workspace.mjs';
const token='test-fixture-token-at-least-32-characters';
test('private connector credentials never appear in public status',async()=>{
 const calls=[];const w=createWhatsappGateway({env:{WHATSAPP_BRIDGE_URL:'http://whatsapp.test',WHATSAPP_BRIDGE_TOKEN:token},fetcher:async(url,o)=>{calls.push({url,o});return new Response('{"state":"qr_ready","qrDataUrl":"test"}');}});
 assert.equal(JSON.stringify(w.status()).includes(token),false);await w.request('connect',{});
 assert.equal(calls[0].o.headers.Authorization,'Bearer '+token);assert.equal(calls[0].o.redirect,'error');
 assert.equal(calls[0].url.pathname,'/connect');assert.equal(calls[0].o.method,'POST');
 await assert.rejects(createWhatsappGateway({env:{}}).request('connect',{}),e=>e.status===503);
});
test('network failures do not leak service details or retry replies',async()=>{
 let calls=0;const w=createWhatsappGateway({env:{WHATSAPP_BRIDGE_URL:'http://whatsapp.test',WHATSAPP_BRIDGE_TOKEN:token},fetcher:async()=>{calls++;throw Error(token);}});
 await assert.rejects(w.request('send',{}),e=>e.status===502&&!e.message.includes(token)&&e.message.includes('uncertain'));assert.equal(calls,1);
});
test('QR, inbox and reply actions require owner access; drafts never call send',async t=>{
 const calls=[];const workspace=createWorkspace({env:{WORKSPACE_OLLAMA_URL:'http://ollama.test',WHATSAPP_BRIDGE_URL:'http://whatsapp.test',WHATSAPP_BRIDGE_TOKEN:token},fetcher:async(url,o)=>{calls.push({url,body:o.body});return new Response(url.hostname==='ollama.test'?'{"done":true,"message":{"content":"Suggested reply"}}':'{"state":"idle","messages":[]}');}});
 const server=createServer((request,response)=>handleWorkspaceApi({request,response,url:new URL(request.url,'http://localhost'),isOwner:request.headers['x-test-owner']==='yes',workspace}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/api/workspace/whatsapp`;
 for(const route of ['status','messages'])assert.equal((await fetch(base+'/'+route)).status,401);
 const headers={'Content-Type':'application/json','x-test-owner':'yes'};
 for(const route of ['connect','disconnect','send','draft']){
  assert.equal((await fetch(base+'/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/'+route,{method:'POST',headers:{...headers,Origin:'https://elsewhere.test'},body:'{}'})).status,403);
 }
 assert.equal(calls.length,0);assert.equal((await fetch(base+'/status',{headers})).status,200);
 const draft=await fetch(base+'/draft',{method:'POST',headers,body:JSON.stringify({message:'Hi there',tone:'warm'})});assert.equal(draft.status,200);
 assert.equal(calls.length,2);assert.equal(calls[1].url.pathname,'/api/chat');assert.equal(JSON.parse(calls[1].body).tools,undefined);
 assert.equal((await draft.json()).sentToAnyone,false);
});
