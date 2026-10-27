import {createSpeechPlaylist} from './trade-lord-player.js?v=1';
import {createTradingClassroom} from './trade-lord-study.js?v=1';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>value?`${value.slice(0,5)}…${value.slice(-5)}`:'—';
const number=value=>value===null||value===undefined?'—':Number(value.toFixed(3)).toLocaleString();
const date=value=>value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Not yet';
let state=null,view='overview',refreshing=false,chatSignature='',speechDirty=false;
const speechPlaylist=createSpeechPlaylist({saveSettings:async playlistRepeat=>{state=await api('/settings','POST',{speech:{playlistRepeat}});render();}});
const tradingClassroom=createTradingClassroom({saveSettings:async study=>{state=await api('/settings','POST',{study});render();}});
function notify(message,error=false){const n=$('#notice');n.textContent=message;n.classList.toggle('error',error);n.hidden=false;}
async function api(path='',method='GET',body){
  const response=await fetch('/api/trade-lord'+path,{method,credentials:'same-origin',cache:'no-store',headers:body!==undefined?{'Content-Type':'application/json'}:{},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok){if(response.status===401){speechPlaylist.pause();tradingClassroom.stop();$('#workspace').hidden=true;$('#login').hidden=false;}throw new Error(data.error||'The request did not complete. Please try again.');}return data;
}
function go(next){
  if(!['overview','chat','traders','knowledge','speech'].includes(next))next='overview';view=next;
  if(next!=='speech')speechPlaylist.pause();
  if(next!=='knowledge')tradingClassroom.stop();
  $$('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==view);
  $$('[data-view]').forEach(el=>{if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  history.replaceState(null,'','#'+view);window.scrollTo({top:0,behavior:'instant'});
}
$$('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
function teacherDescription(t){
  const a=t.analysis;
  if(t.health.error)return t.health.error;
  if(!a.observations)return t.health.lastCheckedAt?'Connection checked. Waiting for supported swaps.':'Waiting for the first background check.';
  return `${a.buys} buys, ${a.sells} sells. ${a.matchedExits?`${a.matchedExits} matched exits to study.`:'More exits needed to study outcomes.'}`;
}
function card(t){return `<article class="teacher-card"><div class="teacher-top"><span class="trader-avatar">${esc(t.name[0].toUpperCase())}</span><div><h3>${esc(t.name)}</h3><small>${esc(short(t.wallet))}</small></div></div><p class="teacher-description">${esc(teacherDescription(t))}</p><div class="teacher-stats"><span>Observed swaps<strong>${number(t.analysis.observations)}</strong></span><span>Study stage<strong style="font-size:11px;margin-top:9px">${esc(t.analysis.evidenceLevel)}</strong></span></div></article>`;}
function renderChat(){
  const messages=state.conversations||[],signature=messages.map(m=>m.id).join(',');
  if(signature===chatSignature&&$('#chat-messages').children.length)return;chatSignature=signature;
  const box=$('#chat-messages');box.replaceChildren();
  if(!messages.length){const message=document.createElement('div');message.className='chat-message assistant';message.innerHTML='<small>TRADE LORD · EVIDENCE ASSISTANT</small><div class="message-text">Welcome. I’m Trade Lord. I study your watched traders and keep the lessons you add. Ask what the observations show, or what evidence is still missing.</div>';box.append(message);}
  for(const m of messages){
    const row=document.createElement('div');row.className='chat-message '+m.role;
    if(m.role==='assistant'){const label=document.createElement('small');label.textContent=m.engine==='language-model'?'TRADE LORD · LANGUAGE MODEL':'TRADE LORD · EVIDENCE ASSISTANT';row.append(label);}
    const text=document.createElement('div');text.className='message-text';text.textContent=m.text;row.append(text);
    if(m.sources?.length){const sources=document.createElement('div');sources.className='message-sources';for(const s of m.sources.slice(0,8)){const tag=document.createElement('span');tag.textContent=s.label;sources.append(tag);}row.append(sources);}
    box.append(row);
  }box.scrollTop=box.scrollHeight;
}
function render(){
  $('#workspace').hidden=false;$('#login').hidden=true;
  $('#stat-traders').textContent=state.teachers.length+' / 5';$('#stat-swaps').textContent=number(state.totalSaved);
  $('#stat-notes').textContent=state.notes.length;$('#stat-exits').textContent=state.teachers.reduce((n,t)=>n+t.analysis.matchedExits,0);
  $('#sample-note').textContent=state.totalSaved>state.recentSample?`Analysis uses ${number(state.recentSample)} recent swaps`:'Verified source observations';
  $('#teacher-cards').innerHTML=state.teachers.map(card).join('')||'<div class="empty"><h3>Choose your first teacher.</h3><p>Add a trader’s public wallet on the Traders page.</p></div>';
  $('#monitor-badge').textContent=!state.enabled?'Observation paused':state.lastError?'Observer needs attention':'Observer enabled';
  $('#memory-status').textContent=state.lastObservationAt?'Last saved '+date(state.lastObservationAt):'Ready for observations';
  $('#observer-status').textContent=!state.enabled?'Paused':state.lastError?'Retrying connection':state.lastTick?'Running':'Starting';
  $('#model-status').textContent=state.model.connected?'Connected':state.model.configured?'Unavailable':'Not connected';
  $('#model-note').textContent=state.model.connected?'A language model is connected for grounded conversation. It has no trading tools.':state.model.error||'Evidence chat is ready. Open-ended AI conversation needs a running language model; no paid model is enabled.';
  $('#chat-engine').textContent=state.model.connected?`Connected model · ${state.model.name}`:'Evidence assistant · language model not connected';
  $('#chat-limit').textContent=state.model.connected?'Answers use trader statistics and saved knowledge. Model explanations can still be mistaken; check the evidence.':'Evidence mode answers questions from saved statistics and lessons. Open-ended conversation requires a connected language model.';
  $('#collection-note').textContent=state.collection;$('#coverage-text').textContent=state.coverage+` ${state.skipped} transactions were failed, unsupported, or unavailable.`;
  $('#monitor-toggle').textContent=state.enabled?'Pause observation':'Resume observation';
  const names=Object.fromEntries(state.teachers.map(t=>[t.wallet,t.name]));
  $('#diary').innerHTML=state.observations.length?state.observations.slice(0,6).map(r=>`<div class="diary-row"><span class="side ${r.side}">${r.side==='buy'?'↗':'↘'}</span><div><strong>${esc(names[r.wallet]||short(r.wallet))} · ${r.side==='buy'?'Buy':'Sell'}</strong><small><a href="https://solscan.io/tx/${encodeURIComponent(r.signature)}" target="_blank" rel="noopener noreferrer">${esc(short(r.mint))} ↗</a></small></div><div class="amount"><strong>${number(r.quoteAmount)} ${esc(r.quote)}</strong><small>${date(r.time)}</small></div></div>`).join(''):'<div class="empty"><span class="empty-icon">⌁</span><h3>The next move starts the story.</h3><p>Supported swaps will appear here as they are collected. We never add example trades to your real diary.</p></div>';
  const openIds=new Set($$('.trader-detail[open]').map(el=>el.dataset.id));
  $('#trader-list').innerHTML=state.teachers.map(t=>`<details class="trader-detail" data-id="${t.id}" ${openIds.has(t.id)?'open':''}><summary><div class="teacher-top"><span class="trader-avatar">${esc(t.name[0].toUpperCase())}</span><div><h3>${esc(t.name)}</h3><small>Last checked ${date(t.health.lastCheckedAt)}</small></div></div><span class="subtle-tag">${esc(t.analysis.evidenceLevel)}</span></summary><div class="wallet-address">${esc(t.wallet)}</div><p>${esc(teacherDescription(t))}</p><div class="trader-facts"><div>Buys<strong>${t.analysis.buys}</strong></div><div>Sells<strong>${t.analysis.sells}</strong></div><div>Matched exits<strong>${t.analysis.matchedExits}</strong></div><div>Median hold (minutes)<strong>${number(t.analysis.medianHoldMinutes)}</strong></div></div><p>${Object.entries(t.analysis.sizeByQuote).map(([q,v])=>`Median buy: ${number(v.median)} ${esc(q)} (${v.count} samples).`).join(' ')||'More observations are needed to measure buy size.'}</p><p>${t.analysis.unmatchedSells} sells have an incomplete cost basis. Matched exits use observed inventory only, before fees.</p><button class="danger-link" data-remove-trader="${t.id}">Stop watching ${esc(t.name)}</button></details>`).join('');
  $$('[data-remove-trader]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{state=await api('/teachers/'+b.dataset.removeTrader,'DELETE',{});render();notify('Trader removed from the watchlist. Saved observations are kept.');}catch(e){notify(e.message,true);}finally{b.disabled=false;}});
  const choice=$('#replay-wallet').value;
  $('#replay-wallet').innerHTML=state.teachers.map(t=>`<option value="${esc(t.wallet)}">${esc(t.name)}</option>`).join('');if(state.teachers.some(t=>t.wallet===choice))$('#replay-wallet').value=choice;
  if(document.activeElement!==$('#replay-cost'))$('#replay-cost').value=state.costBps/100;
  $('#knowledge-list').innerHTML=state.notes.slice().sort((a,b)=>(a.origin==='owner'?-1:1)-(b.origin==='owner'?-1:1)).map(n=>`<article class="knowledge-card"><span class="eyebrow">${esc(n.category)} · ${n.origin==='foundation'?'FOUNDATION':'YOUR LESSON'}</span><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p>${n.source?`<small>Source: ${esc(n.source)}</small>`:''}${n.origin==='owner'?`<div><button class="danger-link" data-remove-note="${n.id}">Remove lesson</button></div>`:''}</article>`).join('');
  $$('[data-remove-note]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{state=await api('/knowledge/'+b.dataset.removeNote,'DELETE',{});render();notify('Lesson removed.');}catch(e){notify(e.message,true);}finally{b.disabled=false;}});
  renderChat();renderSpeech();tradingClassroom.configure(state.tradingSources,state.study);
}
async function refresh(quiet=false){
  if(refreshing)return;refreshing=true;
  try{state=await api();render();if(!quiet)notify('Showing the latest saved memory.');}
  catch(e){if(!quiet||state)notify(e.message,true);}finally{refreshing=false;}
}
$('#refresh').onclick=()=>refresh();
$('#login-form').onsubmit=async e=>{
  e.preventDefault();const b=e.submitter;b.disabled=true;
  try{const r=await fetch('/api/auth/owner',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:new FormData(e.target).get('email')})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Login failed.');await refresh(true);}
  catch(error){notify(error.message,true);}finally{b.disabled=false;}
};
$('#trader-form').onsubmit=async e=>{
  e.preventDefault();const b=e.submitter;b.disabled=true;const values=Object.fromEntries(new FormData(e.target));$('#trader-save').textContent='Saving trader…';
  try{state=await api('/teachers','POST',values);render();e.target.reset();$('#trader-save').textContent='Saved. Trade Lord will collect this trader’s supported swaps.';}
  catch(error){$('#trader-save').textContent=error.message;}finally{b.disabled=false;}
};
$('#knowledge-form').onsubmit=async e=>{
  e.preventDefault();const b=e.submitter;b.disabled=true;const values=Object.fromEntries(new FormData(e.target));values.rightsConfirmed=values.rightsConfirmed==='on';$('#knowledge-save').textContent='Saving lesson…';
  try{state=await api('/knowledge','POST',values);render();e.target.reset();$('#knowledge-save').textContent='Saved ✓ Your lesson is in Trade Lord’s knowledge library.';}
  catch(error){$('#knowledge-save').textContent=error.message;}finally{b.disabled=false;}
};
$('#knowledge-form').oninput=()=>$('#knowledge-save').textContent='Unsaved changes — press Save lesson when ready.';
$('#monitor-toggle').onclick=async()=>{const b=$('#monitor-toggle');b.disabled=true;try{state=await api('/settings','POST',{enabled:!state.enabled});render();notify(state.enabled?'Observation resumed.':'Observation paused. Saved memory is kept.');}catch(e){notify(e.message,true);}finally{b.disabled=false;}};
async function sendMessage(value){
  const button=$('#chat-form button[type=submit]');if(button.disabled)return;
  const message=value.trim();if(!message)return;button.disabled=true;button.textContent='Thinking…';$('#chat-input').disabled=true;
  try{await api('/chat','POST',{message});$('#chat-input').value='';await refresh(true);
    if($('#speak').checked){const reply=state.conversations.at(-1)?.text;if(reply)say(reply,state.speech);}
  }catch(e){notify(e.message,true);}finally{button.disabled=false;button.textContent='Send ↑';$('#chat-input').disabled=false;}
}
$('#chat-form').onsubmit=e=>{e.preventDefault();sendMessage($('#chat-input').value);};
$$('[data-ask]').forEach(b=>b.onclick=()=>sendMessage(b.dataset.ask));
$('#replay-form').onsubmit=async e=>{
  e.preventDefault();const b=e.submitter;b.disabled=true;$('#replay-result').textContent='Checking the saved observations…';
  try{state=await api('/settings','POST',{costBps:Number($('#replay-cost').value)*100});const r=await api('/replay','POST',{wallet:$('#replay-wallet').value});$('#replay-result').textContent=r.available?`${r.baseline}\nEarlier sample: ${r.trainingExits} matched exits. Later holdout: ${r.testExits} exits (${date(r.testFrom)} – ${date(r.testTo)}).\nMedian return after assumed costs: ${number(r.medianReturnPct)}%. Positive exits: ${r.positiveExits} / ${r.testExits}.\n${r.caveat}`:r.message;}
  catch(error){$('#replay-result').textContent=error.message;}finally{b.disabled=false;}
};
$('#export-memory').onclick=async()=>{try{const memory=await api('/export');const blob=new Blob([JSON.stringify(memory,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='trade-lord-memory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Exported your lessons and the most recent saved observation sample.');}catch(e){notify(e.message,true);}};
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(Recognition){$('#dictate').hidden=false;$('#dictate').onclick=()=>{const r=new Recognition();r.lang=state?.speech?.listenLocale||'en-NG';r.interimResults=false;r.onresult=e=>{$('#chat-input').value=e.results[0][0].transcript;$('#chat-input').focus();notify('Check these words before pressing Send.');};r.onerror=e=>notify(e.error==='language-not-supported'?'This browser does not support that speech language. Try UK English in Speech, or type your message.':'Microphone input is unavailable. You can type your message.',true);try{r.start();}catch{notify('Microphone input could not start. You can type your message.',true);}};}
function speechValues(){const f=$('#speech-form').elements;return {listenLocale:f.listenLocale.value,replyLocale:f.replyLocale.value,voiceURI:f.voiceURI.value,rate:Number(f.rate.value),readAloud:f.readAloud.checked};}
function availableVoices(){return 'speechSynthesis' in window?speechSynthesis.getVoices().filter(v=>/^en(?:[-_]|$)/i.test(v.lang)):[];}
function chooseVoice(settings){const voices=availableVoices(),locale=settings.replyLocale.toLowerCase();return voices.find(v=>v.voiceURI===settings.voiceURI)||voices.find(v=>v.lang.toLowerCase().replace('_','-')===locale)||voices.find(v=>v.lang.toLowerCase()==='en-gb')||voices[0];}
function voiceStatus(){const p=speechValues(),voice=chooseVoice(p),same=voice?.lang.toLowerCase().replace('_','-')===p.replyLocale.toLowerCase();$('#voice-availability').textContent=voice?`Playback: ${voice.name} (${voice.lang}). ${same?'Uses a voice available on this device.':'Your preferred accent is unavailable on this device; this is the fallback voice.'} This is device speech, not a newly trained Trade Lord voice.`:'No English voice is available yet on this device. Text chat still works. Selecting a language does not create a new voice.';}
function refreshVoices(){const select=$('#speech-voice'),selected=speechDirty?select.value:state?.speech?.voiceURI||'';select.replaceChildren(new Option('Choose automatically',''));for(const v of availableVoices())select.add(new Option(`${v.name} · ${v.lang}`,v.voiceURI));if([...select.options].some(o=>o.value===selected))select.value=selected;else if(selected){select.add(new Option('Saved voice unavailable on this device',selected));select.value=selected;}voiceStatus();}
function say(message,settings){if(!('speechSynthesis' in window)){notify('This browser cannot read aloud. Text chat is available.',true);return;}const p=settings||speechValues(),utterance=new SpeechSynthesisUtterance(message),voice=chooseVoice(p);utterance.lang=voice?.lang||p.replyLocale;utterance.rate=p.rate;if(voice)utterance.voice=voice;utterance.onerror=e=>{if(!['canceled','interrupted'].includes(e.error))notify('The device voice could not play. Try another voice in Speech.',true);};speechSynthesis.cancel();speechSynthesis.speak(utterance);}
function renderSpeech(){
  speechPlaylist.configure(state.speechSources,state.speech.playlistRepeat);
  if(!speechDirty){const f=$('#speech-form').elements,p=state.speech;f.listenLocale.value=p.listenLocale;f.replyLocale.value=p.replyLocale;f.rate.value=p.rate;f.readAloud.checked=p.readAloud;refreshVoices();}
  $('#speak').checked=state.speech.readAloud;
  $('#speech-source-count').textContent=state.speechSources.length+' references';
  $('#speech-sources').innerHTML=state.speechSources.map(s=>`<article class="knowledge-card"><span class="eyebrow">${esc(s.kind)}</span><h3>${esc(s.title)}</h3><p>${esc(s.focus)}</p>${s.creator?`<small>${esc(s.creator)}</small>`:''}<p class="resource-license">${esc(s.license)}</p><span class="resource-state">${esc(s.status)}</span><a class="resource-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open reference ↗</a></article>`).join('');
  $('#phrase-list').innerHTML=state.notes.filter(n=>n.origin==='owner'&&n.category==='Speech').slice(-5).map(n=>`<div class="saved-phrase"><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p></div>`).join('');
}
$('#speech-form').oninput=()=>{speechDirty=true;$('#speech-save').textContent='Unsaved changes — press Save speech settings.';voiceStatus();};
$('#speech-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{state=await api('/settings','POST',{speech:speechValues()});speechDirty=false;render();$('#speech-save').textContent='Saved ✓ Your speech preferences are stored.';}catch(error){$('#speech-save').textContent=error.message;}finally{b.disabled=false;}};
$('#preview-voice').onclick=()=>say('Hello. I am Trade Lord. Let us take this one step at a time. I will explain what I know and what still needs checking.',speechValues());
$('#stop-voice').onclick=()=>window.speechSynthesis?.cancel();
$('#speak').onchange=async()=>{try{state=await api('/settings','POST',{speech:{readAloud:$('#speak').checked}});if(!state.speech.readAloud)window.speechSynthesis?.cancel();render();}catch(e){notify(e.message,true);$('#speak').checked=state.speech.readAloud;}};
$('#phrase-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;const f=new FormData(e.target),phrase=f.get('phrase').trim(),meaning=f.get('meaning').trim();try{state=await api('/knowledge','POST',{title:'My expression: '+phrase,body:`When I say “${phrase}”, I mean: ${meaning}`,category:'Speech',source:'Owner-provided expression',rightsConfirmed:true});render();e.target.reset();$('#phrase-save').textContent='Saved ✓ This expression is in your knowledge library.';}catch(error){$('#phrase-save').textContent=error.message;}finally{b.disabled=false;}};
if('speechSynthesis' in window)speechSynthesis.addEventListener('voiceschanged',refreshVoices);
async function boot(){
  go(location.hash.slice(1)||'overview');
  try{const r=await fetch('/api/auth/me',{cache:'no-store',credentials:'same-origin'});const a=await r.json();if(a.user?.role==='owner')await refresh(true);else{$('#login').hidden=false;if(a.ownerEmail)$('#login-form input').value=a.ownerEmail;}}
  catch{notify('Could not connect to SignalPilot. Please refresh and try again.',true);$('#login').hidden=false;}
}
boot();setInterval(()=>{if(state&&!document.hidden)refresh(true);},15000);
