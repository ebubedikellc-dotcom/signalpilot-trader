import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createServer} from 'node:http';
import {createTradeLord,handleTradeLordApi} from '../lib/trade-lord.mjs';
import {createVideoTraining,makeVideoChunks,workerAuthorized} from '../lib/trade-lord-training.mjs';
const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(100)]);
const secret='local-test-worker-credential-123456789';
async function setup(t,opts={}){const directory=await mkdtemp(path.join(os.tmpdir(),'tl-video-'));t.after(()=>rm(directory,{force:true,recursive:true}));const service=await createTradeLord({directory,env:{TRADE_LORD_VIDEO_WORKER_TOKEN:secret},...opts});return {directory,service,training:service.training};}
const input={name:'lesson.mp4',title:'Position sizing lesson',bytes:video.length,rightsConfirmed:true};
const segment={start:12,end:18,text:'The example limits each position to one hundred dollars, because exposure matters.',kind:'speech'};

test('saved uploads wait honestly, processed knowledge survives restart and is cited in chat',async t=>{
  const {service,training,directory}=await setup(t);const job=await training.create(input);
  assert.equal(training.snapshot().ready,0);await training.upload(job.id,Readable.from(video));assert.equal(training.snapshot().jobs[0].status,'queued');assert.equal(training.retrieve('position exposure').length,0);
  const claimed=await training.claim();await training.progress(job.id,{lease:claimed.lease,progress:'Transcribing'});
  await training.finish(job.id,{lease:claimed.lease,segments:[segment],coverage:'Spoken words only.',method:'test transcript'});
  const fresh=await createTradeLord({directory,env:{}});const answer=await fresh.chat({message:'What did the video teach about position sizing and exposure?'});
  assert.match(answer.text,/one hundred dollars/);assert.equal(answer.sources[0].videoId,job.id);assert.equal(answer.sources[0].start,12);
  assert.equal(fresh.snapshot().training.ready,1);assert.equal(fresh.snapshot().training.modelWeightsTrained,false);
  assert.equal(fresh.exportMemory().videos[0].chunks[0].text,segment.text);assert.ok(!('lease' in fresh.snapshot().training.jobs[0]));
  await fresh.training.remove(job.id);assert.equal(fresh.training.retrieve('position').length,0);
  const again=await createTradeLord({directory,env:{}});assert.equal(again.training.snapshot().jobs.length,0);service.stop();
});
test('upload validation rejects invalid bytes, oversized files and interrupted streams; retry preserves one job',async t=>{
  const {training}=await setup(t);await assert.rejects(training.create({...input,rightsConfirmed:false}),/permission/);await assert.rejects(training.create({...input,bytes:101*1024*1024}),/100 MB/);
  const job=await training.create(input);await assert.rejects(training.upload(job.id,Readable.from(video.subarray(0,20))),/interrupted/);assert.equal(training.snapshot().jobs[0].status,'needs_upload');
  await assert.rejects(training.upload(job.id,Readable.from(Buffer.alloc(video.length))),/not a supported video/);
  await training.upload(job.id,Readable.from(video));assert.equal(training.snapshot().jobs.length,1);await assert.rejects(training.upload(job.id,Readable.from(video)),/already uploaded/);
  assert.throws(()=>makeVideoChunks([]),/not marked as learned/);assert.throws(()=>makeVideoChunks([{...segment,text:'a'.repeat(64)}]),/secret/);
});
test('one job at a time, lease expiry recovers; stale workers cannot replace knowledge',async t=>{
  let time=1000000;const {training}=await setup(t,{now:()=>time});const job=await training.create(input);await training.upload(job.id,Readable.from(video));
  const first=await training.claim();assert.equal(await training.claim(),null);time+=300001;
  const second=await training.claim();assert.equal(first.id,second.id);assert.notEqual(first.lease,second.lease);
  await assert.rejects(training.finish(job.id,{lease:first.lease,segments:[segment]}),/expired/);
  await training.finish(job.id,{lease:second.lease,error:'Unreadable video'});assert.equal(training.snapshot().ready,0);assert.equal(training.retrieve('position').length,0);
  await training.retry(job.id);assert.equal(training.snapshot().jobs[0].status,'queued');
});
test('video API protects all owner and worker paths, streams files, and refuses arbitrary origins',async t=>{
  const {service}=await setup(t);const server=createServer(async(req,res)=>handleTradeLordApi({request:req,response:res,url:new URL(req.url,'http://localhost'),isOwner:req.headers['x-test-owner']==='yes',service:async()=>service}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/api/trade-lord/training`;
  const owner={'x-test-owner':'yes','Content-Type':'application/json'},worker={'Authorization':'Bearer '+secret,'Content-Type':'application/json'};
  assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base+'/worker/claim',{method:'POST',headers:owner,body:'{}'})).status,401);
  assert.equal((await fetch(base,{method:'POST',headers:{...owner,Origin:'https://attacker.example'},body:JSON.stringify(input)})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers:{...owner,Origin:'not a URL'},body:JSON.stringify(input)})).status,403);
  const created=await fetch(base,{method:'POST',headers:owner,body:JSON.stringify(input)}),job=await created.json();assert.equal(created.status,201);
  const uploaded=await fetch(base+'/'+job.id+'/file',{method:'POST',headers:{'x-test-owner':'yes','Content-Type':'application/octet-stream'},body:video});assert.equal(uploaded.status,200);
  const claim=await (await fetch(base+'/worker/claim',{method:'POST',headers:worker,body:'{}'})).json();
  const file=base+'/worker/'+job.id+'/file';assert.equal((await fetch(file,{headers:worker})).status,400);assert.equal((await fetch(file)).status,401);
  assert.deepEqual(Buffer.from(await (await fetch(file,{headers:{...worker,'X-Job-Lease':claim.job.lease}})).arrayBuffer()),video);
  const done=await fetch(base+'/worker/'+job.id+'/complete',{method:'POST',headers:worker,body:JSON.stringify({lease:claim.job.lease,segments:[segment]})});assert.equal(done.status,200);
  assert.equal((await fetch(base+'/'+job.id+'/transcript')).status,401);assert.equal((await fetch(base+'/'+job.id+'/transcript',{headers:owner})).status,200);
  assert.equal(workerAuthorized('Bearer '+secret,''),false);assert.equal(workerAuthorized('Bearer wrong',secret),false);
});
test('explicit conversation actions persist while ambiguous requests do not change state',async t=>{
  const {service,directory}=await setup(t);await service.chat({message:'Remember that compare every claimed profit with its fees.'});
  assert.ok(service.snapshot().notes.some(n=>n.body==='compare every claimed profit with its fees.'));
  await service.chat({message:'Explain whether I should pause observation.'});assert.equal(service.snapshot().enabled,true);
  const pause=await service.chat({message:'Pause observation'});assert.equal(pause.engine,'action');assert.equal(service.snapshot().enabled,false);
  const fresh=await createTradeLord({directory,env:{}});assert.equal(fresh.snapshot().enabled,false);await fresh.chat({message:'Resume observation'});assert.equal(fresh.snapshot().enabled,true);
});
