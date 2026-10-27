import {$,api,auth,notify,speak,englishVoices} from '/trade-lord-client.js?v=1';
let state,uploading=false,refreshing=false,speechDirty=false,videoSignature='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mb=bytes=>(bytes/1024/1024).toFixed(1)+' MB';
const stamp=seconds=>Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
function voices(){const select=$('#voice'),chosen=speechDirty?select.value:state?.speech.voiceURI||'';select.replaceChildren(new Option('Choose automatically',''));for(const v of englishVoices())select.add(new Option(`${v.name} · ${v.lang}`,v.voiceURI));if(chosen&&![...select.options].some(o=>o.value===chosen))select.add(new Option('Saved voice is unavailable on this device',chosen));select.value=chosen;}
function render(){
  $('#workspace').hidden=false;$('#login').hidden=true;const t=state.training;
  $('#processor-status').textContent=t.processor.message;$('#processor-status').classList.toggle('online',t.processor.online);$('#video-count').textContent=t.ready+' ready';$('#storage').textContent=`${mb(t.bytesUsed)} of ${mb(t.limits.maxStorageBytes)} used · ${t.jobs.length} / ${t.limits.maxFiles} videos`;
  const signature=JSON.stringify(t.jobs);if(signature!==videoSignature){videoSignature=signature;$('#video-list').innerHTML=t.jobs.length?t.jobs.slice().reverse().map(j=>`<article class="video-row"><span class="badge ${esc(j.status)}">${esc(j.statusLabel)}</span><h3>${esc(j.title)}</h3><p>${esc(j.progress)}</p>${j.error?`<p>${esc(j.error)}</p>`:''}${j.coverage?`<p>${esc(j.coverage)}</p>`:''}<p>${mb(j.bytes)}${j.passages?' · '+j.passages+' saved passages':''}</p><div class="actions">${j.status==='ready'?`<button data-transcript="${j.id}" type="button">See saved content</button>`:''}${j.status==='failed'?`<button data-retry="${j.id}" type="button">Retry processing</button>`:''}${j.status==='needs_upload'?`<button data-upload-again="${j.id}" type="button">Choose video again</button>`:''}${!['processing','uploading'].includes(j.status)?`<button class="remove" data-remove="${j.id}" type="button">Remove video & knowledge</button>`:''}</div><div class="transcript" data-content="${j.id}" hidden></div></article>`).join(''):'<div class="empty">Your saved videos will appear here.<br>Add the first one using “Choose your videos”.</div>';}
  $('#notes').innerHTML=state.notes.filter(n=>n.origin==='owner').map(n=>`<article class="saved-note"><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><button class="text-button" data-remove-note="${n.id}" type="button">Remove lesson</button></article>`).join('')||'<p class="muted">Your own lessons will appear here after saving.</p>';
  $('#teachers').innerHTML=state.teachers.map(t=>`<article class="saved-note"><h3>${esc(t.name)}</h3><p>${esc(t.wallet)}</p><p>${t.analysis.observations} saved swaps · ${t.analysis.matchedExits} matched exits</p><button class="text-button" data-remove-teacher="${t.id}" type="button">Stop observing</button></article>`).join('');
  $('#monitor-toggle').textContent=state.enabled?'Pause observation':'Resume observation';
  $('#model-status').textContent=state.model.connected?'Conversation model connected: '+state.model.name:state.model.error||'Full conversation model is not connected. Saved lessons and extracted video passages can still be searched.';
  if(!speechDirty){const f=$('#speech-form').elements,p=state.speech;f.listenLocale.value=p.listenLocale;f.replyLocale.value=p.replyLocale;f.rate.value=p.rate;f.readAloud.checked=p.readAloud;voices();}
}
async function refresh(){if(refreshing)return;refreshing=true;try{state=await api();render();}finally{refreshing=false;}}
function uploadFile(id,file,onProgress){return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST','/api/trade-lord/training/'+id+'/file');xhr.withCredentials=true;xhr.timeout=10*60*1000;xhr.setRequestHeader('Content-Type','application/octet-stream');
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
  xhr.onload=()=>{let data;try{data=JSON.parse(xhr.responseText);}catch{reject(new Error('Upload did not finish. Please try again.'));return;}if(xhr.status>=200&&xhr.status<300)resolve(data);else {if(xhr.status===401)window.dispatchEvent(new Event('trade-lord-auth'));reject(new Error(data.error||'Upload failed.'));}};
  xhr.onerror=xhr.ontimeout=()=>reject(new Error('Upload was interrupted. Choose this video again to retry.'));xhr.send(file);
});}
$('#upload-form').onsubmit=async e=>{
  e.preventDefault();if(uploading)return;const files=[...$('#videos').files];if(!files.length||files.length>6){notify('Choose between one and six videos.',true);return;}
  if(files.some(f=>f.size<12||f.size>100*1024*1024||! /\.(mp4|mov|m4v|webm)$/i.test(f.name))){notify('Choose MP4, MOV, M4V or WebM videos up to 100 MB each.',true);return;}
  uploading=true;const button=e.submitter;button.disabled=true;$('#videos').disabled=true;$('#upload-progress').hidden=false;$('#upload-queue').replaceChildren();let saved=0;
  for(const file of files){const row=document.createElement('div');row.className='queue-item';row.textContent=file.name+' · Preparing…';$('#upload-queue').append(row);
    try{const job=await api('/training','POST',{title:file.name.replace(/\.[^.]+$/,''),name:file.name,bytes:file.size,rightsConfirmed:$('#rights').checked});$('#upload-progress').value=0;$('#upload-status').textContent='Uploading '+file.name+'. Keep this page open until it finishes.';
      await uploadFile(job.id,file,p=>{$('#upload-progress').value=p;row.textContent=file.name+' · '+p+'% uploaded';});saved++;row.textContent=file.name+' · Saved ✓';await refresh();
    }catch(error){row.textContent=file.name+' · '+error.message;}
  }
  $('#upload-status').textContent=`${saved} of ${files.length} videos saved. ${state?.training.processor.online?'Processing will continue in the background.':'Saved uploads are waiting for the video processor to connect.'}`;$('#upload-progress').hidden=true;$('#videos').disabled=false;button.disabled=false;uploading=false;$('#upload-form').reset();refresh().catch(e=>notify(e.message,true));
};
$('#video-list').onclick=async e=>{const button=e.target.closest('button');if(!button)return;button.disabled=true;
  try{
    if(button.dataset.transcript){const id=button.dataset.transcript,box=document.querySelector(`[data-content="${id}"]`);if(!box.hidden){box.hidden=true;return;}const data=await api('/training/'+id+'/transcript');box.textContent=data.segments.map(s=>`${stamp(s.start)} · ${s.kind==='screen-text'?'Screen text':'Speech'}\n${s.text}`).join('\n\n');box.hidden=false;}
    else if(button.dataset.retry){await api('/training/'+button.dataset.retry+'/retry','POST',{});await refresh();}
    else if(button.dataset.remove){if(!confirm('Remove this video and its saved passages from Trade Lord’s knowledge?'))return;await api('/training/'+button.dataset.remove,'DELETE',{});await refresh();}
    else if(button.dataset.uploadAgain){const id=button.dataset.uploadAgain,job=state.training.jobs.find(j=>j.id===id),input=document.createElement('input');input.type='file';input.accept='.mp4,.mov,.m4v,.webm';input.onchange=async()=>{const file=input.files[0];if(!file)return;if(file.name!==job.name||file.size!==job.bytes){notify('Choose the same video. For a different video, use the main upload box.',true);return;}try{notify('Uploading '+file.name+'…');await uploadFile(id,file,p=>notify('Uploading '+file.name+' · '+p+'%'));await refresh();notify('Video saved. It is in the processing queue.');}catch(e){notify(e.message,true);}};input.click();}
  }catch(error){notify(error.message,true);}finally{button.disabled=false;}
};
$('#lesson-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('#lesson-status').textContent='Saving…';try{const input=Object.fromEntries(new FormData(e.target));input.rightsConfirmed=input.rightsConfirmed==='on';await api('/knowledge','POST',input);e.target.reset();$('#lesson-status').textContent='Saved ✓ Trade Lord can use this lesson in answers.';await refresh();}catch(error){$('#lesson-status').textContent=error.message;}finally{b.disabled=false;}};
$('#lesson-form').oninput=()=>$('#lesson-status').textContent='Unsaved changes — press Save lesson.';
$('#notes').onclick=async e=>{const b=e.target.closest('[data-remove-note]');if(!b)return;try{await api('/knowledge/'+b.dataset.removeNote,'DELETE',{});await refresh();}catch(e){notify(e.message,true);}};
$('#teacher-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/teachers','POST',Object.fromEntries(new FormData(e.target)));e.target.reset();await refresh();notify('Trader saved.');}catch(e){notify(e.message,true);}finally{b.disabled=false;}};
$('#teachers').onclick=async e=>{const b=e.target.closest('[data-remove-teacher]');if(!b)return;try{await api('/teachers/'+b.dataset.removeTeacher,'DELETE',{});await refresh();}catch(e){notify(e.message,true);}};
$('#monitor-toggle').onclick=async()=>{try{await api('/settings','POST',{enabled:!state.enabled});await refresh();}catch(e){notify(e.message,true);}};
function speechValues(){const f=$('#speech-form').elements;return {listenLocale:f.listenLocale.value,replyLocale:f.replyLocale.value,voiceURI:f.voiceURI.value,rate:Number(f.rate.value),readAloud:f.readAloud.checked};}
$('#speech-form').oninput=()=>{speechDirty=true;$('#speech-status').textContent='Unsaved changes — press Save voice settings.';};
$('#speech-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/settings','POST',{speech:speechValues()});speechDirty=false;await refresh();$('#speech-status').textContent='Saved ✓ Your voice preferences are stored.';}catch(error){$('#speech-status').textContent=error.message;}finally{b.disabled=false;}};
$('#preview-voice').onclick=()=>speak('Hello. I am Trade Lord. Tell me what you would like to discuss.',speechValues());
window.speechSynthesis?.addEventListener('voiceschanged',voices);
$('#export').onclick=async()=>{try{const memory=await api('/export'),url=URL.createObjectURL(new Blob([JSON.stringify(memory,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='trade-lord-knowledge.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notify(e.message,true);}};
window.addEventListener('trade-lord-auth',()=>{state=null;window.speechSynthesis?.cancel();});
window.addEventListener('beforeunload',e=>{if(uploading){e.preventDefault();e.returnValue='';}});
auth(refresh);setInterval(()=>{if(state&&!document.hidden)refresh().catch(e=>notify(e.message,true));},10000);
