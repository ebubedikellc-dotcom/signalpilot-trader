import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicRecovery} from '../lib/public-recovery.mjs';
import {rpcProvider,freeConnection,directMonitoringEnabled} from '../lib/rpc-provider.mjs';

test('public-only selection ignores stored and environment provider keys',()=>{
  const settings={copyConnection:'public',heliusKey:'old',alchemyKey:'old'},env={HELIUS_API_KEY:'old',ALCHEMY_API_KEY:'old'};
  assert.equal(freeConnection(settings,env),true);
  assert.equal(rpcProvider(settings,env).public,true);
  assert.equal(rpcProvider({heliusKey:'old'},{COPYTRADE_CONNECTION:'public'}).name,'Public Solana');
  assert.equal(directMonitoringEnabled({settings,profiles:{}},env,1,0),false);
});
function harness({cursor,batchSize=8,pageSize=3,maxPages=3}={}) {
  let rows=[],saved={...(cursor?{wallet:cursor}:{})},missing=new Set();const reads=[],writes=[];
  const options={pageSize,maxPages,batchSize,now:()=>1000,load:async()=>saved,
    save:async value=>{saved={...value};writes.push({...value});},
    signatures:async(_wallet,{before,limit})=>{const start=before?rows.findIndex(r=>r.signature===before)+1:0;return rows.slice(start,start+limit);},
    transaction:async sig=>{reads.push(sig);return missing.has(sig)?null:{signature:sig};},
    decode:(tx,_wallet,sig)=>sig.startsWith('transfer')?null:{signature:sig,verified:true}};
  return {feed:createPublicRecovery(options),options,reads,writes,setRows:values=>{rows=values.map(v=>typeof v==='string'?{signature:v}:v);},missing,getSaved:()=>saved};
}
test('first observation establishes a baseline without replaying historical buys',async()=>{
  const h=harness();h.setRows(['old3','old2','old1']);assert.deepEqual(await h.feed.poll('wallet'),[]);
  assert.deepEqual(h.reads,[]);assert.equal(h.getSaved().wallet,'old3');
  h.setRows(['new','old3','old2']);assert.deepEqual((await h.feed.poll('wallet')).map(t=>t.signature),['new']);
});
test('recovery paginates, decodes oldest first and never duplicates notifications',async()=>{
  const h=harness({cursor:'a'});h.setRows(['f','e','d','c','b','a']);
  const result=await h.feed.poll('wallet');assert.deepEqual(h.reads,['b','c','d','e','f']);
  assert.deepEqual(result.map(t=>t.signature),['f','e','d','c','b']);await h.feed.poll('wallet');assert.equal(h.reads.length,5);
});
test('null transaction is retried without advancing beyond the missing item',async()=>{
  const h=harness({cursor:'a'});h.setRows(['d','c','b','a']);h.missing.add('c');
  await assert.rejects(h.feed.poll('wallet'),/retry/);assert.equal(h.getSaved().wallet,'b');assert.equal(h.feed.status('wallet').ok,false);
  h.missing.delete('c');await h.feed.poll('wallet');assert.equal(h.getSaved().wallet,'d');assert.deepEqual(h.reads,['b','c','c','d']);
});
test('failed and non-swap transactions are not copy signals',async()=>{
  const h=harness({cursor:'a'});h.setRows([{signature:'failed',err:{InstructionError:1}},'transfer-b','a']);
  assert.deepEqual(await h.feed.poll('wallet'),[]);assert.deepEqual(h.reads,['transfer-b']);assert.equal(h.getSaved().wallet,'failed');
});
test('bounded recovery reports catch-up instead of claiming current state',async()=>{
  const h=harness({cursor:'a',batchSize:2});h.setRows(['e','d','c','b','a']);
  await h.feed.poll('wallet');assert.equal(h.feed.status('wallet').catchingUp,true);assert.equal(h.getSaved().wallet,'c');
  await h.feed.poll('wallet');assert.equal(h.feed.status('wallet').catchingUp,false);assert.equal(h.getSaved().wallet,'e');
});
test('missing checkpoint fails closed instead of dropping unseen history',async()=>{
  const h=harness({cursor:'a',maxPages:1});h.setRows(['e','d','c','b','a']);
  await assert.rejects(h.feed.poll('wallet'),/checkpoint/);assert.equal(h.getSaved().wallet,'a');assert.deepEqual(h.reads,[]);
});
test('persisted cursor survives restart and resumes only subsequent activity',async()=>{
  const h=harness({cursor:'a'});h.setRows(['b','a']);await h.feed.poll('wallet');
  const restarted=createPublicRecovery(h.options);h.setRows(['c','b','a']);
  assert.deepEqual((await restarted.poll('wallet')).map(t=>t.signature),['c','b']);assert.deepEqual(h.reads,['b','c']);
});
test('concurrent callers share one recovery scan',async()=>{
  const h=harness({cursor:'a'});h.setRows(['b','a']);await Promise.all([h.feed.poll('wallet'),h.feed.poll('wallet')]);assert.deepEqual(h.reads,['b']);
});

test('failed checkpoint writes do not advance memory or drop a decoded trade',async()=>{
 const h=harness({cursor:'a'});h.setRows(['b','a']);let reject=true;
 const feed=createPublicRecovery({...h.options,save:async value=>{if(reject)throw Error('disk full');return h.options.save(value);}});
 await assert.rejects(feed.poll('wallet'),/disk full/);reject=false;
 assert.deepEqual((await feed.poll('wallet')).map(x=>x.signature),['b']);assert.deepEqual(h.reads,['b','b']);
});
