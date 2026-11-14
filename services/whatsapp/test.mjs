import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBridge} from './bridge.mjs';
import {encryptedStore} from './encrypted-store.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
function harness(overrides={}) {
 const sockets=[],saved=[],timers=[];let clock=1000,failSend=false,failSave=false;
 const store={data:{},async save(){if(failSave)throw Error('disk');saved.push(structuredClone(store.data));}};
 const bridge=createBridge({store,auth:{creds:{registered:true}},saveAuth:()=>store.save(),logger:{},
  now:()=>clock,qrImage:async v=>'data:image/png;base64,'+Buffer.from(v).toString('base64'),
  schedule:fn=>timers.push(fn),disconnectReasons:{loggedOut:401,restartRequired:515},
  makeSocket:options=>{const s={options,ev:new EventEmitter(),sent:[],ends:0,logouts:0,
   async sendMessage(jid,body){assert.equal(saved.at(-1).outbox[Object.keys(store.data.outbox).at(-1)].state,'pending');this.sent.push({jid,body});if(failSend)throw Error('network');},
   async logout(){this.logouts++;},end(){this.ends++;}};sockets.push(s);return s;},...overrides});
 const receive=(s,props={})=>s.ev.emit('messages.upsert',{type:'notify',messages:[{key:{remoteJid:'123@s.whatsapp.net',id:'incoming-1'},message:{conversation:'Hello'},pushName:'Contact',...props}]});
 return{bridge,store,sockets,saved,timers,receive,advance:n=>clock+=n,breakSend:()=>failSend=true,breakSave:()=>failSave=true};
}
test('pairing starts only by request; QR expires and disappears on connection',async()=>{
 const h=harness();assert.equal(h.sockets.length,0);assert.equal(h.bridge.status().automaticReplies,false);
 await h.bridge.connect();const s=h.sockets[0];s.ev.emit('connection.update',{qr:'private-pairing-value'});await flush();
 assert.match(h.bridge.status().qrDataUrl,/data:image\/png/);h.advance(60001);assert.equal(h.bridge.status().qrDataUrl,null);
 s.ev.emit('connection.update',{connection:'open'});assert.equal(h.bridge.status().state,'connected');assert.equal(h.bridge.status().qrDataUrl,null);
 assert.equal(s.options.printQRInTerminal,false);assert.equal(s.options.syncFullHistory,false);assert.equal(s.options.markOnlineOnConnect,false);
});
test('only new direct text messages enter the inbox; nothing sends automatically',async()=>{
 const h=harness();await h.bridge.connect();const s=h.sockets[0];h.receive(s);h.receive(s);
 h.receive(s,{key:{remoteJid:'123@g.us',id:'group'}});h.receive(s,{key:{remoteJid:'123@s.whatsapp.net',id:'self',fromMe:true}});
 h.receive(s,{key:{remoteJid:'123@s.whatsapp.net',id:'photo'},message:{imageMessage:{caption:'Photo'}}});
 s.ev.emit('messages.upsert',{type:'append',messages:[{key:{remoteJid:'123@s.whatsapp.net',id:'history'},message:{conversation:'old'}}]});
 assert.equal(h.bridge.messages().messages.length,1);assert.equal(s.sent.length,0);
});
test('owner-selected reply uses a durable journal and duplicate requests do not resend',async()=>{
 const h=harness();await h.bridge.connect();const s=h.sockets[0];s.ev.emit('connection.update',{connection:'open'});h.receive(s);
 const body={messageId:h.bridge.messages().messages[0].id,text:'Hi',requestId:randomUUID()};
 assert.deepEqual(await h.bridge.send(body),{state:'submitted'});assert.equal((await h.bridge.send(body)).duplicate,true);assert.equal(s.sent.length,1);
 assert.equal(s.sent[0].jid,'123@s.whatsapp.net');assert.equal(h.saved.at(-1).outbox[body.requestId].state,'submitted');
 await assert.rejects(h.bridge.send({...body,text:'Different'}),e=>e.status===409);
 await assert.rejects(h.bridge.send({...body,messageId:'unseen',recipient:'456@s.whatsapp.net'}),e=>e.status===400);
});
test('ambiguous delivery is never automatically retried',async()=>{
 const h=harness();await h.bridge.connect();const s=h.sockets[0];s.ev.emit('connection.update',{connection:'open'});h.receive(s);h.breakSend();
 const body={messageId:h.bridge.messages().messages[0].id,text:'Hello',requestId:randomUUID()};
 await assert.rejects(h.bridge.send(body),/uncertain/);await assert.rejects(h.bridge.send(body),/uncertain/);
 assert.equal(s.sent.length,1);assert.equal(h.store.data.outbox[body.requestId].state,'pending');
});
test('storage failure prevents sending and disconnection clears private data',async()=>{
 const h=harness();await h.bridge.connect();const s=h.sockets[0];s.ev.emit('connection.update',{connection:'open'});h.receive(s);h.breakSave();
 await assert.rejects(h.bridge.send({messageId:h.bridge.messages().messages[0].id,text:'Hello',requestId:randomUUID()}));assert.equal(s.sent.length,0);
 const ok=harness();await ok.bridge.connect();ok.receive(ok.sockets[0]);await ok.bridge.disconnect();
 assert.equal(ok.bridge.messages().messages.length,0);assert.equal(ok.store.data.auth,null);assert.equal(ok.sockets[0].logouts,1);assert.equal(ok.bridge.status().qrDataUrl,null);
});
test('old socket events and scheduled reconnects cannot revive a disconnected session',async()=>{
 const h=harness();await h.bridge.connect();const old=h.sockets[0];old.ev.emit('connection.update',{connection:'close'});assert.equal(h.timers.length,1);
 const status=await h.bridge.disconnect();assert.match(status.message,/remove TradeLog/);h.timers[0]();await flush();h.receive(old);old.ev.emit('connection.update',{connection:'open'});
 assert.equal(h.sockets.length,1);assert.equal(h.bridge.status().state,'disconnected');assert.equal(h.bridge.messages().messages.length,0);
});
test('logged-out session stops reconnects and disconnected sends fail',async()=>{
 const h=harness();await h.bridge.connect();const s=h.sockets[0];h.receive(s);
 s.ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});
 assert.equal(h.bridge.status().state,'logged_out');assert.equal(h.timers.length,0);
 await assert.rejects(h.bridge.send({messageId:h.bridge.messages().messages[0].id,text:'Hello',requestId:randomUUID()}),e=>e.status===409);
});
test('encrypted session round-trips, serializes writes and fails closed with the wrong key',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'wa-store-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const {BufferJSON}=await import('baileys');
 const options={directory,secret:'unit-test-secret-not-a-live-credential',replacer:BufferJSON.replacer,reviver:BufferJSON.reviver};
 const first=await encryptedStore(options);first.data.auth={private:'private-session-material',key:Buffer.from([1,2,3])};const pending=first.save();first.data.counter=2;await first.save();await pending;
 const raw=await readFile(join(directory,'session.enc'));assert.equal(raw.includes(Buffer.from('private-session-material')),false);
 const restored=await encryptedStore(options);assert.equal(restored.data.counter,2);assert.deepEqual(restored.data.auth.key,Buffer.from([1,2,3]));
 assert.equal((await stat(join(directory,'session.enc'))).mode&0o777,0o600);
 await assert.rejects(encryptedStore({...options,secret:'wrong'}),/could not be opened/);assert.deepEqual(await readFile(join(directory,'session.enc')),raw);
});
