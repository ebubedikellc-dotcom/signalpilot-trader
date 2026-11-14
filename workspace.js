const $=id=>document.getElementById(id);
const histories={chat:[],research:[]};
const route=location.pathname.replace(/\/$/,'');
const view=['/chat','/research'].includes(route)?'conversation':route==='/calculator'?'calculator':route==='/whatsapp'?'whatsapp':'home';
for(const pane of document.querySelectorAll('[data-view]'))pane.hidden=pane.dataset.view!==view;
const pageTitles={home:['Your day, in one place.','Trading, learning and conversations. Your tools, together.'],conversation:[route==='/research'?'Research':'Normal chat',route==='/research'?'Explore online sources and keep the evidence close.':'Ask questions and keep the conversation going.'],calculator:['Calculator & checker','Check your numbers before making a decision.'],whatsapp:['WhatsApp','Your messages. Your voice. Your replies.']};
$('ws-hero').querySelector('h1').textContent=pageTitles[view][0];
$('ws-hero').querySelector('h1 + p').textContent=pageTitles[view][1];
document.title=pageTitles[view][0]+' · TradeLog';
$('ws-mode').value=route==='/research'?'research':'chat';
$('ws-conversation-title').textContent=route==='/research'?'Research':'Normal chat';
if(route==='/research')$('ws-mode-help').textContent='Research searches online and includes source links. Check dates and evidence before using a finding.';
async function api(url,body){
  const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed.');return data;
}
function notice(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('ws-error',error);}
async function load(){
  const {user}=await api('/api/auth/me');const owner=user?.role==='owner';$('ws-login').hidden=owner;$('ws-owner').hidden=!owner;
  window.dispatchEvent(new CustomEvent('workspace-owner-change',{detail:{owner}}));
  if(!owner)return;
  const s=await api('/api/workspace/status');
  notice('ws-chat-status',s.chat.configured?`Chat configured: ${s.chat.model}`:'Chat: model connection needed');
  notice('ws-research-status',s.research.configured?'Research configured: Vane':'Research: Vane connection needed');
  notice('ws-whatsapp-summary',s.whatsapp?.configured?'WhatsApp connector configured':'WhatsApp: connection service needed');
  notice('ws-lessons-status',s.laptopLessons.message);notice('ws-handover-status',s.handover.message);
}
$('ws-login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const f=new FormData(e.target);await api('/api/auth/owner',{email:f.get('email'),password:f.get('password')});e.target.elements.password.value='';await load();}catch(err){notice('ws-login-status',err.message,true);}finally{button.disabled=false;}});
$('ws-logout').addEventListener('click',async()=>{try{await api('/api/auth/logout',{});histories.chat=[];histories.research=[];$('ws-messages').replaceChildren();$('ws-calculator-result').hidden=true;await load();}catch(e){notice('ws-request-status',e.message,true);}});
$('ws-calculator').addEventListener('submit',async e=>{e.preventDefault();const out=$('ws-calculator-result');out.hidden=false;try{
  const result=await api('/api/workspace/calculate',Object.fromEntries(new FormData(e.target)));
  out.dataset.error=String(!result.withinBudget);out.textContent=`${result.withinBudget?'WITHIN THE SUPPLIED BUDGET':'EXCEEDS THE SUPPLIED BUDGET'}\n\nExisting-position exposure, including costs: ${result.currentRisk}\nProposed total exposure, including costs: ${result.proposedRisk}\nRisk budget: ${result.riskBudget}\nMaximum additional units: ${result.maxAdditionalUnits}\n\n${result.formula}\n\n${result.basis}${result.existingPositionExceedsBudget?'\nThe existing position already exceeds this budget.':''}`;
}catch(err){out.dataset.error='true';out.textContent=err.message;}});
function append(role,content,sources=[]){const box=document.createElement('article');box.className='ws-message';box.dataset.role=role;const label=document.createElement('strong');label.textContent=role==='user'?'You':'TradeLog';const p=document.createElement('p');p.textContent=content;box.append(label,p);if(sources.length){const ul=document.createElement('ul');for(const source of sources){const li=document.createElement('li'),a=document.createElement('a');a.href=source.url;a.textContent=source.title;a.target='_blank';a.rel='noopener noreferrer';li.append(a);ul.append(li);}box.append(ul);}$('ws-messages').append(box);box.scrollIntoView({block:'nearest'});}
$('ws-mode').addEventListener('change',()=>{const mode=$('ws-mode').value;$('ws-messages').replaceChildren();for(const m of histories[mode])append(m.role,m.content);notice('ws-mode-help',mode==='chat'?'Chat uses your local model and recent conversation. Replies are drafts; nothing is sent to anyone.':'Research searches the web and returns source links. Review sources and dates before using a finding.');});
$('ws-clear-chat').addEventListener('click',()=>{histories[$('ws-mode').value]=[];$('ws-messages').replaceChildren();notice('ws-request-status','Conversation cleared.');});
$('ws-conversation').addEventListener('submit',async e=>{e.preventDefault();const mode=$('ws-mode').value,message=e.target.elements.message.value.trim();if(!message)return;
  $('ws-send').disabled=true;$('ws-mode').disabled=true;$('ws-clear-chat').disabled=true;append('user',message);notice('ws-request-status',mode==='research'?'Searching and reading sources…':'Preparing a reply…');
  try{const result=await api(`/api/workspace/${mode}`,{message,history:histories[mode].slice(-8)});append('assistant',result.message,result.sources);histories[mode].push({role:'user',content:message},{role:'assistant',content:result.message.slice(0,4000)});histories[mode]=histories[mode].slice(-8);e.target.elements.message.value='';notice('ws-request-status',mode==='research'?'Research complete. Source links are listed with the answer.':'Reply ready.');}
  catch(err){notice('ws-request-status',err.message,true);}
  finally{$('ws-send').disabled=false;$('ws-mode').disabled=false;$('ws-clear-chat').disabled=false;}
});
load().catch(e=>notice('ws-login-status',e.message,true));
