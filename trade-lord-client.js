export const $=selector=>document.querySelector(selector);
export function notify(message,error=false){const box=$('#notice');box.textContent=message;box.classList.toggle('error',error);box.hidden=false;}
export async function api(path='',method='GET',body){
  const response=await fetch('/api/trade-lord'+path,{method,credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('trade-lord-auth'));throw new Error(result.error||'Could not complete this request. Please retry.');}return result;
}
export function auth(refresh){
  const show=()=>{$('#workspace').hidden=true;$('#login').hidden=false;};window.addEventListener('trade-lord-auth',show);
  $('#login-form').onsubmit=async event=>{event.preventDefault();const b=event.submitter;b.disabled=true;try{const response=await fetch('/api/auth/owner',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:new FormData(event.target).get('email')})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Login failed.');await refresh();}catch(e){notify(e.message,true);}finally{b.disabled=false;}};
  return (async()=>{try{const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(data.user?.role==='owner')await refresh();else{show();if(data.ownerEmail)$('#login-form input').value=data.ownerEmail;}}catch{show();notify('Could not connect. Please refresh and try again.',true);}})();
}
export const englishVoices=()=>window.speechSynthesis?.getVoices().filter(v=>/^en(?:[-_]|$)/i.test(v.lang))||[];
export function speak(text,settings,onState=()=>{}){
  if(!window.speechSynthesis){notify('Voice playback is unavailable in this browser. You can read the reply.');return;}
  const voices=englishVoices(),voice=voices.find(v=>v.voiceURI===settings.voiceURI)||voices.find(v=>v.lang.toLowerCase()===settings.replyLocale.toLowerCase())||voices.find(v=>v.lang.toLowerCase()==='en-gb')||voices[0];
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang=voice?.lang||settings.replyLocale;utterance.rate=settings.rate;if(voice)utterance.voice=voice;
  utterance.onstart=()=>onState('speaking');utterance.onend=()=>onState('idle');utterance.onerror=e=>{onState('idle');if(!['canceled','interrupted'].includes(e.error))notify('Your device could not speak this reply. The text is saved.');};
  speechSynthesis.cancel();speechSynthesis.speak(utterance);
}
