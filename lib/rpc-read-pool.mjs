// Share read traffic across Connection instances; never cache a spendable balance.
export function createRpcReadPool({intervalMs=400,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  let tail=Promise.resolve(),nextAt=0,blockedUntil=0;
  const pending=new Map(),confirmed=new Map();
  const readMethods=new Set(['getBalance','getParsedTokenAccountsByOwner','getParsedTransaction','getBlockHeight','getSignatureStatuses','getAccountInfo','getLatestBlockhash']);
  function pause(ms=60000){blockedUntil=Math.max(blockedUntil,now()+ms);}
  function observe(response){
    if(response.status===429){
      const value=response.headers.get('retry-after');
      const seconds=Number(value);
      const wait=value ? (Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now()):60000;
      pause(Math.max(60000,Number.isFinite(wait)?wait:60000));
    }
    return response;
  }
  function run(method,args,action){
    const key=method+':'+JSON.stringify(args);
    const cached=confirmed.get(key);
    if(cached && now()-cached.at<300000)return Promise.resolve(cached.value);
    if(pending.has(key))return pending.get(key);
    if(pending.size>=100)return Promise.reject(new Error('Wallet verification queue is busy; waiting for current checks.'));
    const work=tail.then(async()=>{
      if(now()<blockedUntil)throw new Error(`Wallet verification rate-limited; requests paused until ${new Date(blockedUntil).toISOString()}`);
      if(now()<nextAt)await sleep(nextAt-now());
      nextAt=now()+intervalMs;
      try {
        const result=await action();
        if(method==='getParsedTransaction' && result?.meta){
          confirmed.set(key,{at:now(),value:result});
          if(confirmed.size>500)confirmed.delete(confirmed.keys().next().value);
        }
        return result;
      }catch(error){
        if(/429|too many requests|rate.limit|max usage|resource exhausted/i.test(String(error.message)))pause();
        throw error;
      }
    });
    tail=work.catch(()=>{});
    const result=work.finally(()=>pending.delete(key));
    pending.set(key,result);return result;
  }
  function wrap(connection){return new Proxy(connection,{get(target,property){
    const value=Reflect.get(target,property,target);
    if(typeof value!=='function')return value;
    if(readMethods.has(property))return (...args)=>run(property,args,()=>value.apply(target,args));
    return value.bind(target);
  }});}
  return {wrap,run,observe,status:()=>({blockedUntil,pending:pending.size})};
}
