import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcProvider,monitoredProfiles,directMonitoringEnabled} from '../lib/rpc-provider.mjs';
test('Alchemy configuration supplies separate HTTP and streaming endpoints',()=>{
 const p=rpcProvider({alchemyKey:'owner-key'});
 assert.equal(p.name,'Alchemy');assert.equal(p.http,'https://solana-mainnet.g.alchemy.com/v2/owner-key');
 assert.equal(p.ws,'wss://solana-mainnet.streaming.alchemy.com/v2/owner-key');
 assert.equal(rpcProvider({}, {ALCHEMY_API_KEY:'env-key'}, {direct:true}).name,'Alchemy');
 assert.equal(rpcProvider({alchemyKey:'key'}, {}, {publicOnly:true}).public,true);
});
test('Helius is preferred for both wallet reads and direct trader alerts',()=>{
 for(const options of [{},{direct:true}]) {
  const p=rpcProvider({heliusKey:'owner-key',alchemyKey:'other-key'},{},options);
  assert.equal(p.name,'Helius');
  assert.equal(p.http,'https://mainnet.helius-rpc.com/?api-key=owner-key');
  assert.equal(p.ws,'wss://mainnet.helius-rpc.com/?api-key=owner-key');
 }
 assert.equal(rpcProvider({}, {HELIUS_API_KEY:'env-key'}, {direct:true}).name,'Helius');
 assert.equal(rpcProvider({heliusKey:'key'}, {}, {publicOnly:true}).name,'Public Solana');
 assert.equal(rpcProvider({}, {}, {direct:true}).name,'Public Solana');
});
test('selected trader plus previous owners of open or pending holdings are monitored',()=>{
 const state={strategy:{activeProfile:'frog'}},supported=['safe','frog','truenest'];
 assert.deepEqual(monitoredProfiles(state,{positions:{},pending:{}},supported),['frog']);
 const report={positions:{a:{profile:'safe',raw:'20'},b:{profile:'truenest',raw:'0'}},pending:{c:{profile:'truenest'}}};
 assert.deepEqual(monitoredProfiles(state,report,supported),['frog','safe','truenest']);
 delete report.pending.c;assert.deepEqual(monitoredProfiles(state,report,supported),['frog','safe']);
 assert.equal(monitoredProfiles(state,null,supported).length,3);
});

test('Helius monitoring stays warm while trading is paused without enabling execution',()=>{
 const state={settings:{heliusKey:'key'},profiles:{safe:{running:false}}};
 assert.equal(directMonitoringEnabled(state,{},100,0),true);
 assert.equal(state.profiles.safe.running,false);
 state.settings.heliusKey='';assert.equal(directMonitoringEnabled(state,{},100,0),false);
 assert.equal(directMonitoringEnabled(state,{HELIUS_API_KEY:'key'},100,0),true);
 assert.equal(directMonitoringEnabled(state,{},100,200),true);
});
