import{createHash,randomUUID}from'node:crypto';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const direct=jid=>typeof jid==='string'&&/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid);
export function createBridge({makeSocket,auth,saveAuth,store,qrImage,disconnectReasons,logger,now=Date.now,schedule=setTimeout,initialStatus}){
 let socket=null,state='idle',message='Choose Show connection QR code to link your phone.',qr=null,qrExpiresAt=0,generation=0,retries=0,enabled=false,starting=null;
 if(initialStatus){state=initialStatus.state;message=initialStatus.message;}
 const inbox=new Map(),seen=new Set();store.data.outbox??={};
 function status(){return{state,message,qrDataUrl:qr&&qrExpiresAt>now()?qr:null,qrExpiresAt,automaticReplies:false};}
 function setState(next,description){state=next;message=description;if(next!=='qr_ready'){qr=null;qrExpiresAt=0;}}
 async function open(){
  const own=++generation;setState('connecting','Connecting to WhatsApp…');
  const current=makeSocket({auth,logger,printQRInTerminal:false,syncFullHistory:false,markOnlineOnConnect:false,shouldSyncHistoryMessage:()=>false,getMessage:async()=>undefined});socket=current;
  current.ev.on('creds.update',()=>{saveAuth().catch(()=>{if(own!==generation)return;enabled=false;generation++;socket=null;setState('error','Session could not be saved. Reconnect after checking local storage.');current.end(new Error('Storage unavailable'));});});
  current.ev.on('connection.update',update=>{void(async()=>{
   if(own!==generation)return;
   if(update.qr){const value=await qrImage(update.qr);if(own===generation&&state!=='connected'){setState('qr_ready','Scan this QR code from WhatsApp → Linked devices.');qr=value;qrExpiresAt=now()+60000;}}
   if(update.connection==='open'){retries=0;setState('connected','Connected. New direct text messages will appear below.');}
   if(update.connection==='close'){
    socket=null;const code=update.lastDisconnect?.error?.output?.statusCode;
    if(code===disconnectReasons.loggedOut){enabled=false;setState('logged_out','WhatsApp signed out this device. Disconnect here, then link again.');return;}
    if(enabled&&retries<3){const delay=code===disconnectReasons.restartRequired?500:Math.min(30000,1000*2**retries);retries++;setState('reconnecting','Connection interrupted. Reconnecting…');schedule(()=>{if(enabled&&own===generation)open().catch(()=>setState('error','Connection failed. Try connecting again.'));},delay);}
    else setState('disconnected','Disconnected. Choose Show connection QR code to reconnect.');
   }
  })().catch(()=>setState('error','The WhatsApp connection could not be updated.'));});
  current.ev.on('messages.upsert',event=>{
   if(own!==generation||event.type!=='notify')return;
   for(const m of event.messages||[]){const sender=m.key?.remoteJid,id=m.key?.id;
    if(!id||m.key?.fromMe||!direct(sender)||seen.has(sender+':'+id))continue;
    const text=m.message?.conversation||m.message?.extendedTextMessage?.text;
    if(typeof text!=='string'||!text.trim())continue;
    seen.add(sender+':'+id);if(seen.size>1000)seen.delete(seen.values().next().value);
    const localId=randomUUID();inbox.set(localId,{id:localId,sender,name:String(m.pushName||sender.split('@')[0]).slice(0,100),text:text.slice(0,4000),receivedAt:new Date(now()).toISOString()});
    while(inbox.size>50)inbox.delete(inbox.keys().next().value);
   }
  });
 }
 async function connect(){if(starting)return starting;if(socket&&['connecting','qr_ready','connected','reconnecting'].includes(state))return status();enabled=true;retries=0;starting=open().then(status).finally(()=>starting=null);return starting;}
 async function disconnect(){enabled=false;generation++;const old=socket;socket=null;let revoked=!auth.creds?.registered;
  if(old){try{await old.logout();revoked=true;}catch{revoked=false;}finally{try{old.end(new Error('Owner disconnected'));}catch{}}}
  inbox.clear();seen.clear();store.data.auth=null;await store.save();setState('disconnected',revoked?'Disconnected. You can link another device.':'Stopped locally. Also remove TradeLog under Linked devices on your phone.');return status();
 }
 async function send(body){
  const target=inbox.get(body?.messageId),text=body?.text,id=body?.requestId;
  if(!target)throw fail('Choose a recent incoming message to reply to.');
  if(typeof text!=='string'||!text.trim()||text.length>4000||typeof id!=='string'||!/^[\da-f-]{36}$/i.test(id))throw fail('Provide a reply and a valid request ID.');
  const digest=createHash('sha256').update(target.sender+'\0'+text).digest('hex');const previous=store.data.outbox[id];
  if(previous){if(previous.digest!==digest)throw fail('This request ID was already used for a different reply.',409);if(previous.state==='submitted')return{state:'submitted',duplicate:true};throw fail('Delivery is uncertain. Check WhatsApp before trying again.',409);}
  if(state!=='connected'||!socket)throw fail('WhatsApp is disconnected.',409);
  if(Object.keys(store.data.outbox).length>=10000)throw fail('Reply journal requires maintenance before more messages can be sent.',503);
  store.data.outbox[id]={digest,state:'pending',at:now()};await store.save();
  try{await socket.sendMessage(target.sender,{text:text.trim()});store.data.outbox[id].state='submitted';await store.save();return{state:'submitted'};}
  catch{throw fail('Delivery is uncertain. Check WhatsApp before trying again.',502);}
 }
 return{status,connect,disconnect,send,messages:()=>({messages:[...inbox.values()].reverse()})};
}
