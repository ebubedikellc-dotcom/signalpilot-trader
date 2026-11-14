const fail=(message,status)=>Object.assign(new Error(message),{status});
export function createWhatsappGateway({env=process.env,fetcher=fetch}={}){
 const configured=Boolean(env.WHATSAPP_BRIDGE_URL&&env.WHATSAPP_BRIDGE_TOKEN?.length>=32);
 const status=()=>({configured,connectionMethod:'qr',automaticReplies:false});
 async function request(action,body){
  if(!configured)throw fail('Install and connect the laptop WhatsApp service to show a real QR code.',503);
  const routes={status:['GET','/status'],messages:['GET','/messages'],connect:['POST','/connect'],disconnect:['POST','/disconnect'],send:['POST','/send']};
  if(!routes[action])throw fail('WhatsApp action not found.',404);
  const [method,path]=routes[action],url=new URL(path,env.WHATSAPP_BRIDGE_URL);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail('Invalid WhatsApp service address.',503);
  let r;try{r=await fetcher(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${env.WHATSAPP_BRIDGE_TOKEN}`,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(body||{}):undefined});}catch{throw fail(action==='send'?'Delivery is uncertain. Check WhatsApp before trying again.':'The WhatsApp connection service is unavailable.',502);}
  const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>250000)throw fail('WhatsApp response too large.',502);chunks.push(c);}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail('Invalid WhatsApp service response.',502);}
  if(!r.ok)throw fail(result.error||'The WhatsApp request failed.',r.status);
  return result;
 }
 return{status,request};
}
