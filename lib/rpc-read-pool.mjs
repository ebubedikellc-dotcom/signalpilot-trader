// One paced provider queue. Urgent trade checks overtake queued background reads,
// but never bypass provider limits. Bounded overlap avoids waiting for a slow
// response before starting an independent read. Balances stay fresh.
export function createRpcReadPool({intervalMs=400,maxConcurrent=1,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const concurrency=Math.max(1,Math.min(2,Math.floor(Number(maxConcurrent)) || 1));
  let nextAt=0,blockedUntil=0,busy=false,sequence=0,active=0,backgroundActive=0;
  const pending=new Map(),confirmed=new Map(),queue=[];
  const methodBlocks=new Map(),methodIntervals=new Map(),methodNext=new Map();
  let requests=0,rateLimits=0,lastRateLimitAt=null,lastRateLimitMethod=null;
  const readMethods=new Set(['getBalance','getParsedTokenAccountsByOwner','getParsedTransaction','getBlockHeight','getSignatureStatuses','getAccountInfo','getLatestBlockhash','getMultipleAccountsInfoAndContext','simulateTransaction']);
  function pause(ms=60000){blockedUntil=Math.max(blockedUntil,now()+ms);}
  function observe(response,{method='',message=''}={}){
    method=({getTransaction:'getParsedTransaction',getTokenAccountsByOwner:'getParsedTokenAccountsByOwner',getMultipleAccounts:'getMultipleAccountsInfoAndContext'})[method] || method;
    if(response.status===429){
      rateLimits++;lastRateLimitAt=new Date(now()).toISOString();lastRateLimitMethod=method || null;
      const value=response.headers.get('retry-after');
      const seconds=Number(value);
      const wait=value ? (Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now()):60000;
      const duration=Math.max(60000,Number.isFinite(wait)?wait:60000);
      if(method && /specific RPC call/i.test(message)) {
        methodBlocks.set(method,Math.max(methodBlocks.get(method)||0,now()+duration));
        methodIntervals.set(method,Math.min(30000,Math.max(2000,(methodIntervals.get(method)||intervalMs)*2)));
      } else pause(duration);
    }
    return response;
  }
  async function execute(job){
    try {
      const result=await job.action();
      if(job.method==='getParsedTransaction' && result?.meta){
        confirmed.set(job.key,{at:now(),value:result});
        if(confirmed.size>500)confirmed.delete(confirmed.keys().next().value);
      }
      job.resolve(result);
    }catch(error){
      if(/429|too many requests|rate.limit|max usage|resource exhausted/i.test(String(error.message)) && !/paused until/.test(error.message) && now()>=(methodBlocks.get(job.method)||0))pause();
      job.reject(error);
    }finally{
      pending.delete(job.key);
      active--;
      if(job.background)backgroundActive--;
      drain();
    }
  }
  async function drain(){
    if(busy)return;
    busy=true;
    try {
      while(queue.length && active<concurrency){
        // Select after pacing so a sell arriving during the wait takes priority.
        if(now()>=blockedUntil && now()<nextAt)await sleep(nextAt-now());
        queue.sort((a,b)=>b.priority-a.priority || a.sequence-b.sequence);
        // A paced transaction lookup must not hold up a ready balance/sell check.
        // Only one background request may be active: keep a lane available for
        // trade checks instead of filling both with dashboard/statistics work.
        const eligible=j=>j.priority>0 || backgroundActive===0;
        const candidates=queue.filter(eligible);
        if(!candidates.length)break;
        const readyIndex=queue.findIndex(j=>eligible(j) && (now()<(methodBlocks.get(j.method)||0) || now()>=(methodNext.get(j.method)||0)));
        if(readyIndex<0){await sleep(Math.min(...candidates.map(j=>methodNext.get(j.method)||0))-now());continue;}
        if(readyIndex>0)queue.unshift(queue.splice(readyIndex,1)[0]);
        const job=queue.shift();
        try {
          const retryAt=Math.max(blockedUntil,methodBlocks.get(job.method)||0);
          if(now()<retryAt){const error=new Error(`Wallet verification rate-limited; requests paused until ${new Date(retryAt).toISOString()}`);error.retryAt=retryAt;throw error;}
          nextAt=now()+intervalMs;
          methodNext.set(job.method,now()+(methodIntervals.get(job.method)||0));
          requests++;
          active++;
          job.background=job.priority<=0;
          if(job.background)backgroundActive++;
          execute(job);
        }catch(error){
          if(/429|too many requests|rate.limit|max usage|resource exhausted/i.test(String(error.message)) && !/paused until/.test(error.message) && now()>=(methodBlocks.get(job.method)||0))pause();
          job.reject(error);
          pending.delete(job.key);
        }
      }
    }finally{busy=false;}
  }
  function run(method,args,action,priority=0){
    const key=method+':'+JSON.stringify(args);
    const cached=confirmed.get(key);
    if(cached && now()-cached.at<300000)return Promise.resolve(cached.value);
    const existing=pending.get(key);
    if(existing){existing.priority=Math.max(existing.priority,priority);drain();return existing.promise;}
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
  return {wrap,run,observe,status:()=>({blockedUntil,pending:pending.size,active,maxConcurrent:concurrency,requests,rateLimits,lastRateLimitAt,lastRateLimitMethod,methodBlocks:Object.fromEntries(methodBlocks)})};
}
