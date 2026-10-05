import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcProvider,monitoredProfiles} from '../lib/rpc-provider.mjs';
test('Alchemy configuration supplies separate HTTP and streaming endpoints',()=>{
 const p=rpcProvider({alchemyKey:'owner-key',heliusKey:'old-key'});
 assert.equal(p.name,'Alchemy');assert.equal(p.http,'https://solana-mainnet.g.alchemy.com/v2/owner-key');
 assert.equal(p.ws,'wss://solana-mainnet.streaming.alchemy.com/v2/owner-key');
 assert.equal(rpcProvider({}, {ALCHEMY_API_KEY:'env-key'}, {direct:true}).name,'Alchemy');
 assert.equal(rpcProvider({alchemyKey:'key'}, {}, {publicOnly:true}).public,true);
});
test('direct alerts remain independent of an exhausted Helius credential',()=>{
 assert.equal(rpcProvider({heliusKey:'old-key'},{},{direct:true}).name,'Public Solana');
 assert.equal(rpcProvider({heliusKey:'old-key'}).name,'Helius');
});
test('selected trader plus previous owners of open or pending holdings are monitored',()=>{
 const state={strategy:{activeProfile:'frog'}},supported=['safe','frog','truenest'];
 assert.deepEqual(monitoredProfiles(state,{positions:{},pending:{}},supported),['frog']);
 const report={positions:{a:{profile:'safe',raw:'20'},b:{profile:'truenest',raw:'0'}},pending:{c:{profile:'truenest'}}};
 assert.deepEqual(monitoredProfiles(state,report,supported),['frog','safe','truenest']);
 delete report.pending.c;assert.deepEqual(monitoredProfiles(state,report,supported),['frog','safe']);
 assert.equal(monitoredProfiles(state,null,supported).length,3);
});
