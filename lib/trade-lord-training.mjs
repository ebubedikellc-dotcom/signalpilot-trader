import {mkdir, readFile, writeFile, rename, rm, open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import path from 'node:path';

const MB=1024*1024, MAX_FILE=100*MB, MAX_STORAGE=500*MB, MAX_FILES=30, LEASE_MS=5*60*1000;
const safeText=(value,max)=>String(value??'').trim().slice(0,max);
const labels={needs_upload:'Choose the video again',uploading:'Uploading',queued:'Waiting to process',processing:'Processing',ready:'Ready to use in answers',failed:'Needs attention'};
export function workerAuthorized(header,token){
  if(!token||token.length<32||!String(header||'').startsWith('Bearer '))return false;
  const supplied=Buffer.from(String(header||'').replace(/^Bearer /,'')),expected=Buffer.from(token);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
export function makeVideoChunks(segments){
  if(!Array.isArray(segments)||segments.length>12000)throw new Error('Invalid transcript.');
  const chunks=[];let current=null,total=0;
  for(const s of segments){
    if(typeof s.text!=='string'||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<s.start||s.end>3610)throw new Error('Invalid transcript timestamps.');
    const text=s.text.trim();if(!text)continue;total+=text.length;
    if(total>300000)throw new Error('The transcript is too large.');
    if(/\bsk-[A-Za-z0-9_-]{12,}|-----BEGIN.*PRIVATE KEY|\b[0-9a-f]{64}\b/i.test(text))throw new Error('This transcript appears to contain a secret. Remove it before saving.');
    const kind=s.kind==='screen-text'?'screen-text':'speech';
    for(let offset=0;offset<text.length;offset+=1200){
      const part=text.slice(offset,offset+1200);
      if(current&&current.kind===kind&&current.text.length+part.length<1200&&s.start-current.end<20){current.text+=' '+part;current.end=Math.max(current.end,s.end);}
      else {current={start:s.start,end:s.end,text:part,kind};chunks.push(current);}
    }
  }
  if(!chunks.length)throw new Error('No understandable speech or screen text was found. This video is not marked as learned.');
  return chunks;
}
export async function createVideoTraining({directory,now=Date.now,env=process.env}){
  const folder=path.join(directory,'videos'),indexFile=path.join(folder,'index.json');
  await mkdir(folder,{recursive:true,mode:0o700});
  let data;try{data=JSON.parse(await readFile(indexFile,'utf8'));if(!Array.isArray(data.jobs))throw new Error('Invalid video memory.');}
  catch(e){if(e.code!=='ENOENT')throw e;data={version:1,jobs:[],workerSeen:0};}
  let queue=Promise.resolve();const activeUploads=new Set();
  async function change(fn){const pending=queue.then(async()=>{const next=structuredClone(data),result=await fn(next);await writeFile(indexFile+'.tmp',JSON.stringify(next),{mode:0o600});await rename(indexFile+'.tmp',indexFile);data=next;return result;});queue=pending.catch(()=>{});return pending;}
  await change(d=>{for(const j of d.jobs){if(j.status==='uploading')j.status='needs_upload';}});
  // Interrupted uploads are never counted as usable videos.
  for(const j of data.jobs)if(j.status==='needs_upload')await rm(path.join(folder,j.id+'.part'),{force:true});
  const filePath=id=>path.join(folder,id+'.video');
  function get(id){const j=data.jobs.find(j=>j.id===id);if(!j)throw new Error('Video not found.');return j;}
  function publicJob(j){const {chunks,lease,...metadata}=j;return {...metadata,passages:chunks?.length||0,statusLabel:labels[j.status]||j.status};}
  function snapshot(){const configured=Boolean(env.TRADE_LORD_VIDEO_WORKER_TOKEN?.length>=32),online=configured&&data.workerSeen>0&&now()-data.workerSeen<90000;return {jobs:data.jobs.map(publicJob),processor:{configured,online,lastSeen:data.workerSeen||null,message:online?'Video processor connected.':configured?'Video processor is offline. Saved uploads will wait.':'Video processor is not connected. Uploads can be saved, but cannot be processed yet.'},limits:{maxFileBytes:MAX_FILE,maxStorageBytes:MAX_STORAGE,maxFiles:MAX_FILES,maxDurationMinutes:60},bytesUsed:data.jobs.reduce((sum,j)=>sum+j.bytes,0),ready:data.jobs.filter(j=>j.status==='ready').length,modelWeightsTrained:false};}
  async function create(input){
    if(input.rightsConfirmed!==true)throw new Error('Confirm you own the video or have permission to use it.');
    const title=safeText(input.title||input.name,120),name=safeText(input.name,160);
    if(!title||!name||!Number.isSafeInteger(input.bytes)||input.bytes<12||input.bytes>MAX_FILE)throw new Error('Choose a video up to 100 MB.');
    if(!/\.(mp4|mov|m4v|webm)$/i.test(name))throw new Error('Use an MP4, MOV, M4V or WebM video.');
    return change(d=>{if(d.jobs.length>=MAX_FILES||d.jobs.reduce((sum,j)=>sum+j.bytes,0)+input.bytes>MAX_STORAGE)throw new Error('Video storage is full. Remove an old upload first.');
      const j={id:randomUUID(),title,name,bytes:input.bytes,status:'needs_upload',createdAt:new Date(now()).toISOString(),rightsConfirmed:true,chunks:[],progress:'Waiting for the video file.'};d.jobs.push(j);return publicJob(j);});
  }
  async function upload(id,stream){
    const job=get(id);if(job.status!=='needs_upload'||activeUploads.has(id))throw new Error('This video is already uploaded or busy.');
    activeUploads.add(id);const temp=path.join(folder,id+'.part');let file;
    try{
      await change(d=>{d.jobs.find(j=>j.id===id).status='uploading';});
      file=await open(temp,'w',0o600);let size=0,head=Buffer.alloc(0);
      for await(const chunk of stream){const b=Buffer.from(chunk);size+=b.length;if(size>job.bytes||size>MAX_FILE)throw new Error('Video exceeds the declared size.');if(head.length<12)head=Buffer.concat([head,b.subarray(0,12-head.length)]);await file.writeFile(b);}
      await file.close();file=null;
      if(size!==job.bytes)throw new Error('Upload was interrupted. Choose the video again.');
      if(!(head.subarray(4,8).toString()==='ftyp'||head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))))throw new Error('This file is not a supported video.');
      await rename(temp,filePath(id));
      await change(d=>{Object.assign(d.jobs.find(j=>j.id===id),{status:'queued',uploadedAt:new Date(now()).toISOString(),progress:'Saved. Waiting for processing.',error:null});});
    }catch(e){await file?.close().catch(()=>{});await rm(temp,{force:true});await change(d=>{const j=d.jobs.find(j=>j.id===id);if(j)Object.assign(j,{status:'needs_upload',error:safeText(e.message,200),progress:'The full video has not been saved.'});});throw e;}
    finally{activeUploads.delete(id);}
    return snapshot();
  }
  async function claim(){return change(d=>{
    d.workerSeen=now();for(const j of d.jobs)if(j.status==='processing'&&j.lease?.until<now()){j.status='queued';j.lease=null;}
    if(d.jobs.some(j=>j.status==='processing'))return null;
    const j=d.jobs.find(j=>j.status==='queued');if(!j)return null;
    j.status='processing';j.error=null;j.progress='Reading the video…';j.lease={token:randomUUID(),until:now()+LEASE_MS};
    return {id:j.id,title:j.title,bytes:j.bytes,lease:j.lease.token};
  });}
  function checkLease(j,lease){if(j.status!=='processing'||j.lease?.token!==lease||j.lease.until<now())throw new Error('This processing job has expired.');}
  async function progress(id,input){return change(d=>{const j=d.jobs.find(j=>j.id===id);if(!j)throw new Error('Video not found.');checkLease(j,input.lease);d.workerSeen=now();j.lease.until=now()+LEASE_MS;j.progress=safeText(input.progress||'Processing…',160);});}
  async function finish(id,input){
    checkLease(get(id),input.lease);
    const chunks=input.error?null:makeVideoChunks(input.segments);
    return change(d=>{const j=d.jobs.find(j=>j.id===id);checkLease(j,input.lease);d.workerSeen=now();
      if(input.error)Object.assign(j,{status:'failed',error:safeText(input.error,250),progress:'Processing did not finish. Nothing from this upload is used in answers.'});
      else Object.assign(j,{status:'ready',chunks,error:null,progress:'Saved to knowledge. Ready to reference in answers.',completedAt:new Date(now()).toISOString(),language:safeText(input.language,30),coverage:safeText(input.coverage||'Spoken content only. Visual charts have not been interpreted.',400),method:safeText(input.method,80)});
      j.lease=null;
    });
  }
  async function retry(id){return change(d=>{const j=d.jobs.find(j=>j.id===id);if(!j||j.status!=='failed')throw new Error('Only a failed video can be retried.');Object.assign(j,{status:'queued',error:null,progress:'Waiting to process again.'});});}
  async function remove(id){const j=get(id);if(activeUploads.has(id)||j.status==='processing')throw new Error('Wait for this upload or processing job to finish before removing it.');await change(d=>{d.jobs=d.jobs.filter(j=>j.id!==id);});await rm(filePath(id),{force:true});await rm(path.join(folder,id+'.part'),{force:true});}
  function transcript(id){const j=get(id);return {...publicJob(j),segments:j.status==='ready'?j.chunks:[]};}
  function retrieve(question){
    const stop=new Set(['what','when','where','about','from','that','this','have','does','with','your','video','learn','learned','tell','please','there','would','could','should']);
    const terms=[...new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[])].filter(w=>w.length>2&&!stop.has(w));
    return data.jobs.filter(j=>j.status==='ready').flatMap(j=>j.chunks.map((c,i)=>({id:`${j.id}:${i}`,title:j.title,videoId:j.id,body:c.text,start:c.start,end:c.end,kind:c.kind,coverage:j.coverage,category:'Uploaded video',origin:'video',score:terms.reduce((n,w)=>n+(c.text.toLowerCase().includes(w)?2:0)+(j.title.toLowerCase().includes(w)?1:0),0)}))).filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,6);
  }
  function streamFile(id,response,lease){const j=get(id);if(lease)checkLease(j,lease);if(!j.uploadedAt)throw new Error('This video has not finished uploading.');response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':j.bytes,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});const stream=createReadStream(filePath(id));stream.on('error',()=>response.destroy());stream.pipe(response);}
  return {snapshot,create,upload,claim,progress,finish,retry,remove,transcript,retrieve,streamFile,exportMemory:()=>structuredClone(data.jobs).map(({lease,...j})=>j)};
}

async function json(request,max=20000){let bytes=0;const parts=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>max)throw new Error('Request too large.');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
export async function handleVideoApi({request,response,url,isOwner,training,workerToken}){
  const route=url.pathname.slice('/api/trade-lord/training'.length);
  const send=(status,body)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(body));};
  const worker=route==='/worker/claim'||/^\/worker\/[0-9a-f-]{36}\/(progress|complete|file)$/.test(route);
  if(worker?!workerAuthorized(request.headers.authorization,workerToken):!isOwner){send(401,{error:'Authentication required.'});return true;}
  if(!['GET','POST','DELETE'].includes(request.method)){send(405,{error:'Method not allowed.'});return true;}
  if(request.method!=='GET'){
    let originAllowed=true;try{if(request.headers.origin)originAllowed=new URL(request.headers.origin).host===request.headers.host;}catch{originAllowed=false;}
    if(!originAllowed||request.headers['sec-fetch-site']==='cross-site'){send(403,{error:'Open your own control panel to change training.'});return true;}
    const isUpload=/^\/[0-9a-f-]{36}\/file$/.test(route);
    const type=String(request.headers['content-type']||'');
    if(isUpload?!(/^(video\/(mp4|quicktime|webm|x-m4v)|application\/octet-stream)(;|$)/.test(type)):!type.startsWith('application/json')){send(415,{error:isUpload?'Choose a supported video.':'JSON required.'});return true;}
  }
  try{
    const s=await training();
    if(request.method==='GET'&&route===''){send(200,s.snapshot());return true;}
    if(worker){
      if(route==='/worker/claim'&&request.method==='POST'){await json(request);send(200,{job:await s.claim()});return true;}
      const [, ,id,action]=route.split('/');
      if(action==='file'&&request.method==='GET'){if(!request.headers['x-job-lease'])throw new Error('A processing lease is required.');s.streamFile(id,response,request.headers['x-job-lease']);return true;}
      if(request.method==='POST'&&['progress','complete'].includes(action)){const body=await json(request,action==='complete'?2*MB:20000);await (action==='complete'?s.finish(id,body):s.progress(id,body));send(200,{ok:true});return true;}
    }else{
      if(request.method==='POST'&&route===''){send(201,await s.create(await json(request)));return true;}
      const match=route.match(/^\/([0-9a-f-]{36})(?:\/(file|retry|transcript))?$/);
      if(match){const [,id,action]=match;
        if(request.method==='POST'&&action==='file'){send(200,await s.upload(id,request));return true;}
        if(request.method==='POST'&&action==='retry'){await json(request);await s.retry(id);send(200,s.snapshot());return true;}
        if(request.method==='GET'&&action==='transcript'){send(200,s.transcript(id));return true;}
        if(request.method==='DELETE'&&!action){await json(request);await s.remove(id);send(200,s.snapshot());return true;}
      }
    }
    send(404,{error:'Training action not found.'});
  }catch(e){if(!response.headersSent)send(/too large|exceeds/.test(e.message)?413:400,{error:e.code?'Video storage is unavailable. Please retry.':safeText(e.message,250)});}
  return true;
}
