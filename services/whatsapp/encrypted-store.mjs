import{mkdir,readFile,writeFile,rename}from'node:fs/promises';
import{join}from'node:path';
import{randomBytes,createHash,createCipheriv,createDecipheriv}from'node:crypto';
export async function encryptedStore({directory,secret,replacer,reviver}){
 await mkdir(directory,{recursive:true,mode:0o700});const file=join(directory,'session.enc'),key=createHash('sha256').update(secret).digest();let data={};
 try{const b=await readFile(file);const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));data=JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString(),reviver);}catch(e){if(e.code!=='ENOENT')throw new Error('Saved WhatsApp session could not be opened. Restore the original bridge token; do not overwrite this session.');}
 let queue=Promise.resolve();
 function save(){const snapshot=JSON.stringify(data,replacer);const write=async()=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(snapshot),c.final()]);await writeFile(file+'.tmp',Buffer.concat([iv,c.getAuthTag(),body]),{mode:0o600});await rename(file+'.tmp',file);};queue=queue.then(write);return queue;}
 return{data,save};
}
