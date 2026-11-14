import{createServer}from'node:http';import{timingSafeEqual,createHash}from'node:crypto';
import makeWASocket,{BufferJSON,initAuthCreds,proto,DisconnectReason}from'baileys';import QRCode from'qrcode';import pino from'pino';
import{encryptedStore}from'./encrypted-store.mjs';import{createBridge}from'./bridge.mjs';
const token=process.env.WHATSAPP_BRIDGE_TOKEN;if(!token||token.length<32)throw Error('Set a private WHATSAPP_BRIDGE_TOKEN with at least 32 characters.');
const store=await encryptedStore({directory:process.env.WHATSAPP_DATA_DIR||'/data',secret:token,replacer:BufferJSON.replacer,reviver:BufferJSON.reviver});
const logger=pino({level:'silent'});let active;
async function build(initialStatus){
 store.data.auth??={creds:initAuthCreds(),keys:{}};const saved=store.data.auth;
 const auth={creds:saved.creds,keys:{get:async(type,ids)=>Object.fromEntries(ids.map(id=>{let v=saved.keys[type]?.[id];if(type==='app-state-sync-key'&&v)v=proto.Message.AppStateSyncKeyData.fromObject(v);return[id,v];})),set:async update=>{for(const[type,values]of Object.entries(update)){saved.keys[type]??={};for(const[id,value]of Object.entries(values)){if(value===null)delete saved.keys[type][id];else saved.keys[type][id]=value;}}await store.save();}};
 return createBridge({makeSocket:makeWASocket,auth,saveAuth:()=>store.save(),store,qrImage:value=>QRCode.toDataURL(value,{width:260,margin:2}),disconnectReasons:DisconnectReason,logger,initialStatus});
}
active=await build();const hash=x=>createHash('sha256').update(x).digest();
createServer(async(req,res)=>{
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!timingSafeEqual(hash(req.headers.authorization||''),hash('Bearer '+token))){send(401,{error:'Private connection required.'});return;}
 try{const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/status'){send(200,active.status());return;}
  if(req.method==='GET'&&path==='/messages'){send(200,active.messages());return;}
  if(req.method!=='POST'||!['/connect','/disconnect','/send'].includes(path)){send(404,{error:'Action not found.'});return;}
  let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>16000)throw Object.assign(Error('Request too large.'),{status:413});chunks.push(c);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(Error('Invalid request.'),{status:400});}
  if(path==='/disconnect'){const result=await active.disconnect();active=await build(result);send(200,result);return;}
  send(200,await active[path.slice(1)](body));
 }catch(e){send(e.status||503,{error:e.status?e.message:'WhatsApp is unavailable. Check the local connection.'});}
}).listen(Number(process.env.PORT||3040),process.env.HOST||'127.0.0.1',()=>console.log('Private WhatsApp connector started.'));
