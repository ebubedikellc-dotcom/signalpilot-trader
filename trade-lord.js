import {$,api,notify,speak} from './trade-lord-client.js?v=1';
let state,busy=false,recognition,signature='',isOwner=false;
function stored(key,fallback){try{return JSON.parse(sessionStorage.getItem(key))??fallback;}catch{return fallback;}}
function keep(key,value){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}
let publicMessages=stored('trade-lord-public-chat',[]);
if(!Array.isArray(publicMessages))publicMessages=[];
publicMessages=publicMessages.filter(m=>['user','assistant'].includes(m?.role)&&typeof m.text==='string'&&m.text.length<=10000).slice(-60);
const savedSpeech=stored('trade-lord-public-speech',{});
const localSpeech={readAloud:savedSpeech?.readAloud===true};
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
function face(mode){$('#lord-face').dataset.state=mode;$('#lord-face').setAttribute('aria-label','Trade Lord is '+({idle:'ready',thinking:'thinking',listening:'listening',speaking:'speaking'}[mode]));$('#presence-status').textContent=({idle:isOwner?'Ask a question, share an idea, or tell me what to remember.':'Ask a question or share an idea. No account needed.',thinking:'I’m looking into your question…',listening:'I’m listening. Speak naturally.',speaking:'Reading my answer aloud.'})[mode];}
function render(){
  $('#workspace').hidden=false;$('#owner-settings').hidden=!isOwner;$('#clear-chat').hidden=isOwner;$('#engine').textContent=state.model.connected?'Conversation model connected':'Written-lesson answers · full conversation model not connected';$('#speak').checked=state.speech.readAloud;
  $('#access-note').textContent=isOwner?'Your private owner conversation. You can say “Remember that…” to save a lesson, or “Pause observation”. Trade Lord cannot place trades or move money.':'Free public conversation. Your messages stay in this browser tab and are sent to this site to answer you. They are not added to the owner’s training.';
  $('#first-question').dataset.ask=isOwner?'What have you learned about my traders?':'What can you help me with?';$('#first-question').textContent=isOwner?'What have you learned?':'What can you help with?';
  const next=state.conversations.map(m=>m.id).join(',');if(next===signature)return;signature=next;
  const box=$('#chat-messages');box.replaceChildren();
  for(const m of state.conversations){const row=document.createElement('article');row.className='message '+m.role;if(m.role==='assistant'){const label=document.createElement('small');label.textContent=m.engine==='action'?'TRADE LORD · SAVED ACTION':'TRADE LORD';row.append(label);}const words=document.createElement('div');words.textContent=m.text;row.append(words);
    if(m.sources?.length){const sources=document.createElement('div');sources.className='sources';for(const s of m.sources.slice(0,8)){const tag=document.createElement('span');tag.textContent=s.label;sources.append(tag);}row.append(sources);}box.append(row);
  }box.scrollTop=box.scrollHeight;$('#suggestions').hidden=state.conversations.length>0;
}
async function refresh(){state=await api(isOwner?'':'/public');if(!isOwner){state.conversations=publicMessages;state.speech.readAloud=localSpeech.readAloud===true;}render();}
async function start(){try{const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});isOwner=r.ok&&(await r.json()).user?.role==='owner';}catch{isOwner=false;}try{await refresh();face('idle');}catch(e){notify(e.message,true);}}
async function send(message){
  if(busy||!message.trim())return;if(!state){notify('The site is still connecting. Please try again shortly.',true);return;}busy=true;recognition?.abort();recognition=null;window.speechSynthesis?.cancel();face('thinking');$('#talk').disabled=true;$('#chat-form button').disabled=true;$('#chat-input').disabled=true;
  try{const body={message:message.trim()};if(!isOwner)body.history=publicMessages.slice(-8).map(m=>({role:m.role,text:m.text.slice(0,2000)}));const reply=await api(isOwner?'/chat':'/public/chat','POST',body);if(!isOwner){publicMessages.push({id:reply.id+'-question',role:'user',text:body.message},reply);publicMessages=publicMessages.slice(-60);keep('trade-lord-public-chat',publicMessages);}$('#chat-input').value='';await refresh();face('idle');if(state.speech.readAloud)speak(reply.text,state.speech,face);}
  catch(e){face('idle');notify(e.message,true);}finally{busy=false;$('#talk').disabled=!Recognition;$('#chat-form button').disabled=false;$('#chat-input').disabled=false;}
}
$('#chat-form').onsubmit=e=>{e.preventDefault();send($('#chat-input').value);};
document.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>send(b.dataset.ask));
if(!Recognition){$('#talk').disabled=true;$('#voice-hint').textContent='This browser does not support voice input. Type below, or try Safari / Chrome.';}
else {$('#voice-hint').textContent='Tap to speak. I’ll answer when you finish.';$('#talk').onclick=()=>{
  if(recognition){recognition.stop();return;}
  window.speechSynthesis?.cancel();const r=new Recognition();let finalWords='';recognition=r;r.lang=state?.speech?.listenLocale||'en-NG';r.interimResults=true;r.continuous=false;
  r.onstart=()=>{face('listening');$('#talk span').textContent='Finish speaking';};
  r.onresult=e=>{let words='';finalWords='';for(let i=0;i<e.results.length;i++){words+=e.results[i][0].transcript+' ';if(e.results[i].isFinal)finalWords+=e.results[i][0].transcript+' ';}$('#chat-input').value=words.trim().slice(0,2000);};
  r.onerror=e=>{if(e.error!=='aborted')notify(e.error==='not-allowed'?'Allow microphone access in your browser, or type below.':'I could not hear that clearly. Please try again or type below.',true);};
  r.onend=()=>{const current=recognition===r;recognition=null;if(!busy)face('idle');$('#talk span').textContent='Talk to me';if(current&&finalWords.trim()&&!document.hidden&&!busy&&state)send(finalWords.trim().slice(0,2000));};
  try{r.start();}catch{recognition=null;face('idle');notify('Microphone could not start. You can type below.',true);}
};}
$('#speak').onchange=async()=>{const enabled=$('#speak').checked;if(!state)return;try{if(isOwner)state=await api('/settings','POST',{speech:{readAloud:enabled}});else{localSpeech.readAloud=enabled;state.speech.readAloud=enabled;keep('trade-lord-public-speech',localSpeech);}if(!enabled){window.speechSynthesis?.cancel();face('idle');}notify('Voice preference saved.');}catch(e){$('#speak').checked=state.speech.readAloud;notify(e.message,true);}};
$('#clear-chat').onclick=()=>{if(isOwner||busy||!state)return;stop();publicMessages=[];keep('trade-lord-public-chat',publicMessages);state.conversations=[];signature='reset';render();notify('Conversation cleared from this browser tab.');};
$('#stop-voice').onclick=()=>{window.speechSynthesis?.cancel();face('idle');};
function stop(){recognition?.abort();recognition=null;window.speechSynthesis?.cancel();if(!busy)face('idle');}
window.addEventListener('trade-lord-auth',()=>{state=null;isOwner=false;signature='';$('#chat-messages').replaceChildren();stop();refresh().catch(e=>notify(e.message,true));});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
start();setInterval(()=>{if(state&&!busy&&!document.hidden)refresh().catch(e=>notify(e.message,true));},15000);
