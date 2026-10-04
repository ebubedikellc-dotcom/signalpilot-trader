import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRpcReadPool} from '../lib/rpc-read-pool.mjs';
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
 const c=vm.createContext({Map,Proxy,Reflect,String,process:{env:{}},Connection,createRpcReadPool,clusterApiUrl:()=> 'https://public.example',AbortSignal,fetch:()=>{}});
 vm.runInContext(source.slice(source.indexOf('const rpcConnections'),source.indexOf('function isRateLimitError')),c);
 const a=c.solanaConnection({heliusKey:'test-key'}),b=c.solanaConnection({heliusKey:'test-key'});
 assert.equal(a.endpoint,'https://mainnet.helius-rpc.com/?api-key=test-key');assert.equal(created,1);assert.equal(a.options.disableRetryOnRateLimit,true);
 assert.equal(c.solanaConnection({}).endpoint,'https://public.example');assert.equal(created,2);
});
test('failure of optional trader statistics does not abort wallet report or duplicate sponsored pending entries',async()=>{
 const d={pending:{'jupiter:r':{txid:'tx',wallet:'w'}},checked:{},fills:[],sourceFills:[]};let reconciled=0;
 const c=vm.createContext({Object,Date,Boolean,Number,executionReport:null,solanaConnection:()=>({}),executionJournal:{load:async()=>d,save:async()=>{},reconcile:async()=>{reconciled++;},snapshot:async()=>({positions:{coin:{raw:'4',verified:true}}})},updateSourceReports:async()=>{throw new Error('source statistics rate-limited');},growthSnapshot:()=>null,buildPositions:()=>({closed:[]}),supportedProfiles:[],tradeWallet:()=> 'w',profileFromTrade:()=> 'frog',canonicalSignalId:x=>x});
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
 const c=vm.createContext({Map,Proxy,Reflect,String,process:{env:{HELIUS_API_KEY:'test-env-key'}},Connection,createRpcReadPool,clusterApiUrl:()=> 'https://public.example',AbortSignal,fetch:()=>{}});
 vm.runInContext(source.slice(source.indexOf('const rpcConnections'),source.indexOf('function solanaAddress')),c);
 const client=c.solanaConnection({heliusKey:'test-key'});
 assert.equal(await client.getBalance('w'),123);
 assert.deepEqual(calls,['https://mainnet.helius-rpc.com/?api-key=test-key','https://public.example']);
 await assert.rejects(client.sendRawTransaction('bytes'),/429/);assert.equal(calls.at(-1),'write');assert.equal(calls.length,3);
});
