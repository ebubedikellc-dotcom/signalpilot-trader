import {$,api,auth,notify,speak} from './trade-lord-client.js?v=1';
let state,busy=false,recognition,signature='';
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
function face(mode){$('#lord-face').dataset.state=mode;$('#lord-face').setAttribute('aria-label','Trade Lord is '+({idle:'ready',thinking:'thinking',listening:'listening',speaking:'speaking'}[mode]));$('#presence-status').textContent=({idle:'Ask a question, share an idea, or tell me what to remember.',thinking:'I’m checking your saved knowledge…',listening:'I’m listening. Speak naturally.',speaking:'Reading my answer aloud.'})[mode];}
function render(){
  $('#workspace').hidden=false;$('#login').hidden=true;$('#engine').textContent=state.model.connected?'Conversation model connected':'Saved-knowledge answers · full conversation model not connected';$('#speak').checked=state.speech.readAloud;
  const next=state.conversations.map(m=>m.id).join(',');if(next===signature)return;signature=next;
  const box=$('#chat-messages');box.replaceChildren();
  for(const m of state.conversations){const row=document.createElement('article');row.className='message '+m.role;if(m.role==='assistant'){const label=document.createElement('small');label.textContent=m.engine==='action'?'TRADE LORD · SAVED ACTION':'TRADE LORD';row.append(label);}const words=document.createElement('div');words.textContent=m.text;row.append(words);
    if(m.sources?.length){const sources=document.createElement('div');sources.className='sources';for(const s of m.sources.slice(0,8)){const tag=document.createElement('span');tag.textContent=s.label;sources.append(tag);}row.append(sources);}box.append(row);
  }box.scrollTop=box.scrollHeight;$('#suggestions').hidden=state.conversations.length>0;
}
async function refresh(){state=await api();render();}
async function send(message){
  if(busy||!message.trim())return;busy=true;recognition?.abort();recognition=null;window.speechSynthesis?.cancel();face('thinking');$('#talk').disabled=true;$('#chat-form button').disabled=true;$('#chat-input').disabled=true;
  try{const reply=await api('/chat','POST',{message:message.trim()});$('#chat-input').value='';await refresh();face('idle');if(state.speech.readAloud)speak(reply.text,state.speech,face);}
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
$('#speak').onchange=async()=>{const enabled=$('#speak').checked;try{state=await api('/settings','POST',{speech:{readAloud:enabled}});if(!enabled){window.speechSynthesis?.cancel();face('idle');}notify('Voice preference saved.');}catch(e){$('#speak').checked=state.speech.readAloud;notify(e.message,true);}};
$('#stop-voice').onclick=()=>{window.speechSynthesis?.cancel();face('idle');};
function stop(){recognition?.abort();recognition=null;window.speechSynthesis?.cancel();if(!busy)face('idle');}
window.addEventListener('trade-lord-auth',()=>{state=null;stop();});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
auth(refresh);setInterval(()=>{if(state&&!busy&&!document.hidden)refresh().catch(e=>notify(e.message,true));},15000);
