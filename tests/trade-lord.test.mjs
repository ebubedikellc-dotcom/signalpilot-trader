import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createTradeLord,handleTradeLordApi} from '../lib/trade-lord.mjs';
import {analyzeTrader,observationFromSwap,replayTrader,evidenceAnswer,CURRICULUM} from '../lib/trade-lord-analysis.mjs';
import {decodeDirectSwap} from '../lib/direct-signals.mjs';

const wallet='4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh';
const SOL='So11111111111111111111111111111111111111112';
const seedTeachers=[{name:'Frog',wallet}];
function swap(signature='receipt-1',side='buy',timestamp=1700000000){return {signature,timestamp,events:{swap:{tokenInputs:[{mint:side==='buy'?SOL:'token',tokenAmount:side==='buy'?2:10}],tokenOutputs:[{mint:side==='buy'?'token':SOL,tokenAmount:side==='buy'?10:3}]}}};}
async function setup(t,options={}){const directory=await mkdtemp(path.join(os.tmpdir(),'trade-lord-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const service=await createTradeLord({directory,seedTeachers,readers:async()=>({signatures:async()=>[],transaction:async()=>null}),decode:decodeDirectSwap,env:{},...options});t.after(()=>service.stop());return {service,directory};}

test('public source swaps normalize; ambiguous movements are not invented',()=>{
  const row=observationFromSwap(wallet,swap());assert.equal(row.side,'buy');assert.equal(row.quote,'SOL');assert.equal(row.marketContext,null);
  assert.equal(observationFromSwap(wallet,{...swap(),events:{swap:{tokenInputs:[{mint:SOL,tokenAmount:2}],tokenOutputs:[{mint:SOL,tokenAmount:2}]}}}),null);
  const wrong=swap();wrong.events.swap.tokenOutputs[0].tokenAmount=NaN;assert.equal(observationFromSwap(wallet,wrong),null);
});
test('records survive restart and duplicate live/recovery receipts are counted once',async t=>{
  const {service,directory}=await setup(t);
  await Promise.all([service.record(wallet,swap()),service.record(wallet,swap(),'recovery')]);
  assert.equal(service.snapshot().totalSaved,1);
  await service.addNote({title:'My lesson',body:'Study exits before increasing size.',rightsConfirmed:true});
  const fresh=await createTradeLord({directory,seedTeachers,env:{}});
  assert.equal(fresh.snapshot().totalSaved,1);assert.equal(fresh.snapshot().notes.at(-1).title,'My lesson');
  await assert.rejects(service.addNote({title:'Bad',body:'x',rightsConfirmed:false}),/permission/);
  const stored=JSON.parse(await readFile(path.join(directory,'memory.json'),'utf8'));assert.equal(stored.observations.length,1);
});
test('study scope is bounded to watched public wallets, pause does not record',async t=>{
  const {service}=await setup(t);assert.equal(await service.record('other-wallet',swap()),false);
  await service.settings({enabled:false});assert.equal(await service.record(wallet,swap()),false);
  await assert.rejects(service.settings({enabled:'true'}),/true or false/);
  await assert.rejects(service.addTeacher({name:'duplicate',wallet}),/already/);
  await assert.rejects(service.addNote({title:'Key',body:'a'.repeat(64),rightsConfirmed:true}),/private keys/);
});
test('matched portions respect partial sells, quote currencies and unseen inventory',()=>{
  const buy=observationFromSwap(wallet,swap()),sell=observationFromSwap(wallet,swap('sell','sell',1700000060));
  let a=analyzeTrader([sell,buy],wallet);assert.equal(a.matchedExits,1);assert.equal(a.matches[0].grossReturnPct,50);assert.equal(a.medianHoldMinutes,1);
  a=analyzeTrader([{...sell,tokenAmount:20},buy],wallet);assert.equal(a.matchedExits,0);assert.equal(a.unmatchedSells,1);
  a=analyzeTrader([{...sell,quote:'USDC'},buy],wallet);assert.equal(a.matchedExits,0);
  a=analyzeTrader([buy,{...sell,id:'part',tokenAmount:5,quoteAmount:1.5},{...sell,id:'rest',time:sell.time+1000,tokenAmount:5,quoteAmount:1.5}],wallet);assert.equal(a.matches.length,2);assert.equal(a.matches.reduce((sum,m)=>sum+m.cost,0),2);
});
test('replay uses later matched exits and costs, never invented profits',()=>{
  assert.equal(replayTrader([],wallet).available,false);const rows=[];
  for(let i=0;i<10;i++){rows.push(observationFromSwap(wallet,swap('b'+i,'buy',1700000000+i*100)),observationFromSwap(wallet,swap('s'+i,'sell',1700000050+i*100)));}
  const replay=replayTrader(rows,wallet,100);assert.equal(replay.trainingExits,7);assert.equal(replay.testExits,3);assert.ok(replay.medianReturnPct<50);assert.match(replay.caveat,/not executable fills/);
});
test('background recovery drains a persistent queue, decoding only confirmed source data',async t=>{
  const fixtures=JSON.parse(await readFile(new URL('./fixtures/source-swaps.json',import.meta.url),'utf8'));const f=fixtures.find(f=>f.wallet===wallet);
  let calls=0;
  const {service}=await setup(t,{readers:async()=>({signatures:async()=>calls++?[]:[{signature:f.signature}],transaction:async()=>f.transaction})});
  await service.tick();assert.equal(service.snapshot().totalSaved,0);
  await service.tick();assert.equal(service.snapshot().totalSaved,1);assert.equal(service.snapshot().observations[0].signature,f.signature);
});
test('offline chat is labeled evidence, persisted and never claims an LLM',async t=>{
  const {service}=await setup(t);await service.record(wallet,swap());
  const answer=await service.chat({message:'What have you learned about Frog?'});assert.equal(answer.engine,'evidence');assert.match(answer.text,/1 buys/);assert.equal(service.snapshot().conversations.length,2);assert.equal(service.snapshot().model.connected,false);
  const refusal=evidenceAnswer('buy now',{teachers:[]},CURRICULUM);assert.match(refusal.text,/cannot sign/);
});
test('owner API enforces auth, origin, limits and no trade execution routes',async t=>{
  const {service}=await setup(t);
  const server=createServer(async(req,res)=>{await handleTradeLordApi({request:req,response:res,url:new URL(req.url,'http://localhost'),isOwner:req.headers['x-test-owner']==='yes',service:async()=>service});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/trade-lord`;
  assert.equal((await fetch(base)).status,401);
  const headers={'x-test-owner':'yes','Content-Type':'application/json'};
  assert.equal((await fetch(base+'/settings',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:'{"enabled":false}'})).status,403);
  assert.equal((await fetch(base+'/trade',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await fetch(base+'/knowledge',{method:'POST',headers,body:JSON.stringify({body:'x'.repeat(21000)})})).status,413);
  const saved=await fetch(base+'/knowledge',{method:'POST',headers,body:JSON.stringify({title:'Keep evidence',body:'Look at losses too.',rightsConfirmed:true})});assert.equal(saved.status,200);
  const exported=await fetch(base+'/export',{headers});assert.equal(exported.headers.get('cache-control'),'no-store');assert.equal((await exported.json()).modelWeightsTrained,false);
});
test('speech preferences survive restart, reject invalid settings atomically and do not start training',async t=>{
  const {service,directory}=await setup(t);
  await service.settings({speech:{listenLocale:'en-NG',replyLocale:'en-GB',rate:0.8,readAloud:true}});
  await assert.rejects(service.settings({enabled:false,speech:{listenLocale:'made-up'}}),/Nigerian English/);
  assert.equal(service.snapshot().enabled,true);
  const fresh=await createTradeLord({directory,env:{}});
  assert.equal(fresh.snapshot().speech.rate,0.8);assert.equal(fresh.snapshot().speech.readAloud,true);
  assert.equal(fresh.snapshot().speechTraining.audioImported,0);assert.equal(fresh.snapshot().speechTraining.weightsTrained,false);
  assert.equal(fresh.snapshot().speechSources.filter(s=>s.kind==='YouTube reference').length,10);
  await fresh.addNote({title:'My expression: my own side',body:'When I say my own side, I mean the owner control panel.',category:'Speech',rightsConfirmed:true});
  const reply=await fresh.chat({message:'Do you understand my Nigerian English speech?'});
  assert.match(reply.text,/No videos or audio have been imported/);assert.match(reply.text,/owner control panel/);assert.equal(reply.engine,'evidence');
  await assert.rejects(fresh.settings({speech:{rate:0}}),/Speech speed/);
  await assert.rejects(fresh.settings({speech:{readAloud:'yes'}}),/true or false/);
});
