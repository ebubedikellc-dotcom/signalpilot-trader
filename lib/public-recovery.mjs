// Confirmed history fills gaps in WebSocket delivery. No signing capability.
// Persist the cursor after decoding each item, never after an unavailable read.
export function createPublicRecovery({signatures, transaction, decode, load=async()=>({}), save=async()=>{}, now=Date.now, pageSize=25, maxPages=4, batchSize=8}) {
  let cursors;
  const active=new Map(), tapes=new Map(), health=new Map();
  let loading, writing=Promise.resolve();
  const initialize=()=>loading ||= Promise.resolve().then(load).then(value=>{
    const {_tapes={},...stored}=value;cursors=stored;
    for(const [wallet,tape] of Object.entries(_tapes))if(Array.isArray(tape))tapes.set(wallet,tape.slice(0,128));
  });
  async function persist(wallet,signature,tape=tapes.get(wallet)||[]) {
    writing=writing.catch(()=>{}).then(async()=>{
      const next={...cursors,[wallet]:signature},nextTapes=new Map(tapes);nextTapes.set(wallet,tape);
      await save({...next,_tapes:Object.fromEntries(nextTapes)});
      cursors=next;tapes.set(wallet,tape);
    });
    await writing;
  }
  async function scan(wallet) {
    await initialize();
    const cursor=cursors[wallet];
    let before, found=!cursor, exhausted=false;
    const rows=[], seen=new Set();
    for(let page=0;page<maxPages;page++) {
      const result=await signatures(wallet,{limit:pageSize,...(before?{before}:{})});
      if(!Array.isArray(result))throw Error('Public history response is invalid.');
      for(const row of result) {
        if(!row.signature)throw Error('Public history contains a missing signature.');
        if(row.signature===cursor){found=true;break;}
        if(!seen.has(row.signature)){rows.push(row);seen.add(row.signature);}
      }
      if(!cursor || found || result.length<pageSize){exhausted=result.length<pageSize;break;}
      const next=result.at(-1)?.signature;
      if(!next || next===before)throw Error('Public history pagination did not advance.');
      before=next;
    }
    if(!cursor) {
      // First run is an observation baseline, never a replay of historical buys.
      if(rows[0])await persist(wallet,rows[0].signature);
      health.set(wallet,{ok:true,baseline:true,catchingUp:false,checkedAt:now(),error:''});
      return tapes.get(wallet)||[];
    }
    if(!found)throw Error(`Public history gap: checkpoint was not found${exhausted?' in available history':''}. Reconcile missed trades before restarting buys.`);
    const chronological=rows.reverse();
    let tape=tapes.get(wallet)||[];
    for(const row of chronological.slice(0,batchSize)) {
      if(!row.err) {
        const tx=await transaction(row.signature);
        if(!tx)throw Error('Confirmed transaction is not available yet; recovery will retry.');
        const decoded=decode(tx,wallet,row.signature,new Date(now()).toISOString());
        if(decoded)tape=[decoded,...tape.filter(item=>item.signature!==decoded.signature)].slice(0,128);
      }
      await persist(wallet,row.signature,tape);
    }
    health.set(wallet,{ok:true,baseline:false,catchingUp:rows.length>batchSize,checkedAt:now(),error:''});
    return tape;
  }
  return {
    status:wallet=>health.get(wallet)||{ok:false,checkedAt:null,error:'Public history has not been checked.'},
    poll(wallet) {
      if(active.has(wallet))return active.get(wallet);
      const task=scan(wallet).catch(error=>{
        health.set(wallet,{ok:false,checkedAt:now(),error:error.message});throw error;
      }).finally(()=>active.delete(wallet));
      active.set(wallet,task);return task;
    }
  };
}
