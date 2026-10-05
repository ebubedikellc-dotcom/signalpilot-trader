// One paced provider queue. Urgent trade checks overtake queued background reads,
// but never bypass provider limits or an in-flight request. Balances stay fresh.
export function createRpcReadPool({intervalMs=400,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  let nextAt=0,blockedUntil=0,busy=false,sequence=0;
  const pending=new Map(),confirmed=new Map(),queue=[];
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
  async function drain(){
    if(busy)return;
    busy=true;
    try {
      while(queue.length){
        // Select after pacing so a sell arriving during the wait takes priority.
        if(now()>=blockedUntil && now()<nextAt)await sleep(nextAt-now());
        queue.sort((a,b)=>b.priority-a.priority || a.sequence-b.sequence);
        const job=queue.shift();
        try {
          if(now()<blockedUntil)throw new Error(`Wallet verification rate-limited; requests paused until ${new Date(blockedUntil).toISOString()}`);
          nextAt=now()+intervalMs;
          const result=await job.action();
          if(job.method==='getParsedTransaction' && result?.meta){
            confirmed.set(job.key,{at:now(),value:result});
            if(confirmed.size>500)confirmed.delete(confirmed.keys().next().value);
          }
          job.resolve(result);
        }catch(error){
          if(/429|too many requests|rate.limit|max usage|resource exhausted/i.test(String(error.message)) && !/paused until/.test(error.message))pause();
          job.reject(error);
        }finally{pending.delete(job.key);}
      }
    }finally{busy=false;}
  }
  function run(method,args,action,priority=0){
    const key=method+':'+JSON.stringify(args);
    const cached=confirmed.get(key);
    if(cached && now()-cached.at<300000)return Promise.resolve(cached.value);
    const existing=pending.get(key);
    if(existing){existing.priority=Math.max(existing.priority,priority);return existing.promise;}
    if(pending.size>=100)return Promise.reject(new Error('Wallet verification queue is busy; waiting for current checks.'));
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const job={key,method,action,priority,sequence:sequence++,promise,resolve,reject};
    pending.set(key,job);queue.push(job);drain();
    return promise;
  }
  function wrap(connection,{priority=0}={}){return new Proxy(connection,{get(target,property){
    const value=Reflect.get(target,property,target);
    if(typeof value!=='function')return value;
    if(readMethods.has(property))return (...args)=>run(property,args,()=>value.apply(target,args),priority);
    return value.bind(target);
  }});}
  return {wrap,run,observe,status:()=>({blockedUntil,pending:pending.size})};
}
