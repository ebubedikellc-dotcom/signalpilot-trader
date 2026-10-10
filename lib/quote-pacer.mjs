// Adapt only after the provider reports a quota error. Signing/submission never
// enters this queue. Ready sells overtake waiting buys; background checks yield.
export function createQuotePacer({now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const states=new Map();
 const state=key=>{if(!states.has(key))states.set(key,{interval:0,next:0,queue:[],working:false});return states.get(key);};
 async function drain(s) {
  if(s.working)return;s.working=true;
  try {
   while(s.queue.length) {
    const delay=s.next-now();
    if(delay>0){await sleep(delay);continue;}
    s.queue.sort((a,b)=>b.priority-a.priority);
    const job=s.queue.shift();s.next=now()+s.interval;job.resolve();
   }
  } finally {s.working=false;}
 }
 return {
  slow(key,retryAt) {const s=state(key);s.interval=1050;s.next=Math.max(s.next,now()+s.interval,retryAt||0);},
  acquire(key,{priority=50,background=false}={}) {
   const s=state(key);
   if(background && s.queue.some(job=>job.priority>0))return Promise.reject(Error('Price check deferred to reserve quote capacity for live trades'));
   if(s.queue.length>=32)return Promise.reject(Error('Trade route queue is full; retry after current routes finish'));
   return new Promise(resolve=>{s.queue.push({priority:background?0:priority,resolve});void drain(s);});
  }
 };
}
