import {rpcProvider} from '../lib/rpc-provider.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRpcReadPool} from '../lib/rpc-read-pool.mjs';
import {currentExitNotices} from '../lib/exit-status.mjs';
test('method-specific transaction limit does not block fresh sell balances and adapts its pace',async()=>{
 const h=harness();let transactions=0;
 await assert.rejects(h.pool.run('getParsedTransaction',['first'],async()=>{
   transactions++;h.pool.observe({status:429,headers:new Headers({'retry-after':'90'})},{method:'getTransaction',message:'Too many requests for a specific RPC call'});throw new Error('429 Too many requests');
 }),/429/);
 assert.equal(await h.pool.run('getBalance',['sell'],async()=>123,100),123);
 await assert.rejects(h.pool.run('getParsedTransaction',['other'],async()=>transactions++),/paused until/);
 assert.equal(transactions,1);h.advance(90001);
 const times=[];
 await h.pool.run('getParsedTransaction',['a'],async()=>{times.push(h.now());return null;});
 await h.pool.run('getParsedTransaction',['b'],async()=>{times.push(h.now());return null;});
 assert(times[1]-times[0]>=2000);
 assert.equal(h.pool.status().rateLimits,1);
});
function harness(){let time=1800000000000;const pool=createRpcReadPool({now:()=>time,sleep:async ms=>{time+=ms;},intervalMs:400});return {pool,now:()=>time,advance:ms=>{time+=ms;}};}
test('reads share one paced queue and identical in-flight work is coalesced',async()=>{
 const h=harness(),times=[];
 const read=async()=>{times.push(h.now());return 7;};
 const a=h.pool.run('getBalance',['wallet'],read),b=h.pool.run('getBalance',['wallet'],read);
 assert.equal(a,b);
 await Promise.all([a,b,h.pool.run('getBalance',['other'],read)]);
 assert.deepEqual(times,[1800000000000,1800000000400]);
});
test('balances are refreshed; confirmed transactions alone can be cached',async()=>{
 const h=harness();let calls=0;const read=async()=>++calls;
 assert.equal(await h.pool.run('getBalance',['w'],read),1);
 assert.equal(await h.pool.run('getBalance',['w'],read),2);
 const tx=async()=>{calls++;return {meta:{err:null}};};
 await h.pool.run('getParsedTransaction',['sig'],tx);await h.pool.run('getParsedTransaction',['sig'],tx);
 assert.equal(calls,3);
 await h.pool.run('getParsedTransaction',['missing'],async()=>{calls++;return null;});
 await h.pool.run('getParsedTransaction',['missing'],async()=>{calls++;return null;});assert.equal(calls,5);
});
test('429 pauses queued requests and honors the longer Retry-After',async()=>{
 const h=harness();let calls=0;
 const first=h.pool.run('getBalance',['w'],async()=>{calls++;h.pool.observe({status:429,headers:new Headers({'retry-after':'120'})});throw new Error('429 Too many requests');});
 const second=h.pool.run('getParsedTransaction',['sig'],async()=>{calls++;});
 const results=await Promise.allSettled([first,second]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);
 h.advance(60001);await assert.rejects(h.pool.run('getBalance',['w'],async()=>{calls++;}),/paused until/);assert.equal(calls,1);
 h.advance(60000);await h.pool.run('getBalance',['w'],async()=>{calls++;});assert.equal(calls,2);
});
test('proxy intercepts reads without changing the receiver or write semantics',async()=>{
 const h=harness(),raw={value:3,getBalance:async function(){return this.value;},sendRawTransaction:function(){return this.value+1;}};
 const c=h.pool.wrap(raw);assert.equal(await c.getBalance('w'),3);assert.equal(c.sendRawTransaction(),4);
});
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
test('configured verification provider is restored and connections are reused',()=>{
 let created=0;
 class Connection {constructor(endpoint,options){this.endpoint=endpoint;this.options=options;created++;}}
 const c=vm.createContext({Map,Proxy,Reflect,String,rpcProvider,process:{env:{}},Connection,createRpcReadPool,clusterApiUrl:()=> 'https://api.mainnet-beta.solana.com',AbortSignal,fetch:()=>{}});
 vm.runInContext(source.slice(source.indexOf('const rpcConnections'),source.indexOf('function isRateLimitError')),c);
 const a=c.solanaConnection({heliusKey:'test-key'}),b=c.solanaConnection({heliusKey:'test-key'});
 assert.equal(a.endpoint,'https://mainnet.helius-rpc.com/?api-key=test-key');assert.equal(created,1);assert.equal(a.options.disableRetryOnRateLimit,true);
 assert.equal(c.solanaConnection({}).endpoint,'https://api.mainnet-beta.solana.com');assert.equal(created,2);
});
test('failure of optional trader statistics does not abort wallet report or duplicate sponsored pending entries',async()=>{
 const d={pending:{'jupiter:r':{txid:'tx',wallet:'w'}},checked:{},fills:[],sourceFills:[]};let reconciled=0;
 const c=vm.createContext({Object,Date,Boolean,Number,currentExitNotices,executionReport:null,solanaConnection:()=>({}),executionJournal:{load:async()=>d,save:async()=>{},reconcile:async()=>{reconciled++;},snapshot:async()=>({positions:{coin:{raw:'4',verified:true}}})},updateSourceReports:async()=>{throw new Error('source statistics rate-limited');},growthSnapshot:()=>null,buildPositions:()=>({closed:[]}),supportedProfiles:[],tradeWallet:()=> 'w',profileFromTrade:()=> 'frog',canonicalSignalId:x=>x});
 vm.runInContext(source.slice(source.indexOf('async function refreshExecutionReport'),source.indexOf('let riskWorking')),c);
 await c.refreshExecutionReport({settings:{},trades:[{execution:{txid:'tx',action:'buy'}}]});
 assert.equal(reconciled,1);assert.equal(c.executionReport.positions.coin.raw,'4');assert.match(c.executionReport.sourceReportError,/rate-limited/);assert.equal(Object.keys(d.pending).length,1);
});

test('only reads fail over when the configured provider is rate-limited; writes never retry elsewhere',async()=>{
 const calls=[];
 class Connection {
  constructor(endpoint){this.endpoint=endpoint;}
  async getBalance(){calls.push(this.endpoint);if(this.endpoint.includes('helius'))throw new Error('429 quota limit');return 123;}
  async sendRawTransaction(){calls.push('write');throw new Error('429 quota limit');}
 }
 const c=vm.createContext({Map,Proxy,Reflect,String,rpcProvider,process:{env:{HELIUS_API_KEY:'test-env-key'}},Connection,createRpcReadPool,clusterApiUrl:()=> 'https://api.mainnet-beta.solana.com',AbortSignal,fetch:()=>{}});
 vm.runInContext(source.slice(source.indexOf('const rpcConnections'),source.indexOf('function solanaAddress')),c);
 const client=c.solanaConnection({heliusKey:'test-key'});
 assert.equal(await client.getBalance('w'),123);
 assert.deepEqual(calls,['https://mainnet.helius-rpc.com/?api-key=test-key','https://solana-rpc.publicnode.com']);
 await assert.rejects(client.sendRawTransaction('bytes'),/429/);assert.equal(calls.at(-1),'write');assert.equal(calls.length,3);
});

test('urgent sell checks overtake background reads without interrupting an active request',async()=>{
 let release;const blocked=new Promise(r=>release=r),order=[];
 const h=harness();
 const active=h.pool.run('getBalance',['active'],async()=>{await blocked;order.push('active');});
 const background=h.pool.run('getBalance',['dashboard'],async()=>order.push('dashboard'));
 const buy=h.pool.run('getParsedTransaction',['buy'],async()=>order.push('buy'),50);
 const sell=h.pool.run('getParsedTransaction',['sell'],async()=>order.push('sell'),100);
 release();await Promise.all([active,background,buy,sell]);
 assert.deepEqual(order,['active','sell','buy','dashboard']);
});
test('a shared pending lookup is promoted when a sell needs it',async()=>{
 let release;const blocked=new Promise(r=>release=r),order=[];const h=harness();
 const active=h.pool.run('getBalance',['active'],()=>blocked);
 const dashboard=h.pool.run('getBalance',['dashboard'],async()=>order.push('dashboard'));
 const low=h.pool.run('getParsedTransaction',['source'],async()=>order.push('source'));
 const high=h.pool.run('getParsedTransaction',['source'],async()=>{throw new Error('must coalesce')},100);
 assert.equal(low,high);release();await Promise.all([active,dashboard,low,high]);assert.deepEqual(order,['source','dashboard']);
});
test('urgent work respects provider Retry-After and repeated checks do not extend it forever',async()=>{
 const h=harness();h.pool.observe({status:429,headers:new Headers({'retry-after':'60'})});
 for(let i=0;i<3;i++){await assert.rejects(h.pool.run('getBalance',['sell'],async()=>1,100),/paused until/);h.advance(20000);}
 assert.equal(await h.pool.run('getBalance',['sell'],async()=>1,100),1);
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function parallelHarness(){
 let time=0;
 const pool=createRpcReadPool({maxConcurrent:2,intervalMs:250,now:()=>time,sleep:async ms=>{time+=ms;}});
 return {pool,now:()=>time};
}
test('a sell read starts before a slow background read finishes, with unchanged request spacing',async()=>{
 const h=parallelHarness(),starts=[];let release;
 const background=h.pool.run('getBalance',['dashboard'],()=>{starts.push(h.now());return new Promise(r=>release=r);});
 const sell=h.pool.run('getParsedTokenAccountsByOwner',['sell'],()=>{starts.push(h.now());return 42;},100);
 assert.equal(await sell,42);
 assert.deepEqual(starts,[0,250]);
 assert.equal(h.pool.status().active,1); // Slow background response is still outstanding.
 release(1);await background;assert.equal(h.pool.status().active,0);
});
test('two-read limit, reserved trade lane, coalescing and priority survive slow responses',async()=>{
 const h=parallelHarness(),order=[];let releaseBackground,releaseBuy;
 const background=h.pool.run('getBalance',['dashboard1'],()=>new Promise(r=>releaseBackground=r));
 const background2=h.pool.run('getBalance',['dashboard2'],async()=>order.push('background2'));
 await flush();assert.equal(h.pool.status().active,1);
 const buy=h.pool.run('getParsedTransaction',['buy'],()=>new Promise(r=>releaseBuy=r),50);
 assert.equal(buy,h.pool.run('getParsedTransaction',['buy'],()=>{throw new Error('duplicate');},50));
 await flush();assert.equal(h.pool.status().active,2);
 const sell=h.pool.run('getBalance',['sell'],async()=>order.push('sell'),100);
 await flush();assert.deepEqual(order,[]);
 releaseBuy(null);await buy;await sell;assert.deepEqual(order,['sell']);
 releaseBackground(1);await Promise.all([background,background2]);
 assert.deepEqual(order,['sell','background2']);assert.equal(h.pool.status().active,0);
});
test('promoting a queued background lookup wakes the reserved trade lane immediately',async()=>{
 const h=parallelHarness();let release;
 const background=h.pool.run('getBalance',['slow'],()=>new Promise(r=>release=r));
 const lookup=h.pool.run('getParsedTransaction',['shared'],async()=>({meta:{err:null}}));
 await flush();assert.equal(h.pool.status().requests,1);
 const urgent=h.pool.run('getParsedTransaction',['shared'],()=>{throw new Error('duplicate');},100);
 assert.equal(lookup,urgent);await urgent;assert.equal(h.pool.status().requests,2);
 release(1);await background;
});
test('parallel reads honor provider cooldown before dispatching any more queued work',async()=>{
 const h=parallelHarness();let releaseFirst,releaseSecond,calls=0;
 const first=h.pool.run('getBalance',['one'],()=>{calls++;return new Promise(r=>releaseFirst=r);},50);
 const second=h.pool.run('getBalance',['two'],()=>{calls++;return new Promise(r=>releaseSecond=r);},50);
 await flush();assert.equal(calls,2);
 const third=h.pool.run('getBalance',['three'],async()=>{calls++;},100);
 const rejected=assert.rejects(third,/paused until/);
 h.pool.observe({status:429,headers:new Headers({'retry-after':'120'})});
 releaseFirst(1);await first;await rejected;assert.equal(calls,2);
 releaseSecond(2);await second;assert.equal(h.pool.status().active,0);
});
