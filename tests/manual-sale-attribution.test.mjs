import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPositions} from '../lib/position-accounting.mjs';
const buy=(profile='safe',wallet='wallet')=>({wallet,profile,mint:'COIN',side:'buy',raw:'100',usd:5,time:1,txid:'buy'});
const sell=(overrides={})=>({wallet:'wallet',profile:'frog',mint:'COIN',side:'sell',raw:'100',usd:6,time:2,txid:'sale',source:'manual:preview',...overrides});
test('confirmed manual sale closes sole same-wallet holding despite panel profile',()=>{
 const fills=[buy(),sell()],r=buildPositions(fills);
 assert.equal(r.positions['wallet:safe:COIN'].raw,'0');assert.equal(r.closed.length,1);
 assert.equal(r.closed[0].profile,'safe');assert.equal(r.closed[0].pnl,1);
 assert.equal(fills[1].profile,'frog');
});
test('partial manual sale preserves the original holding cycle and remaining cost',()=>{
 const r=buildPositions([buy(),sell({raw:'40',usd:3})]);
 assert.equal(r.positions['wallet:safe:COIN'].raw,'60');assert.equal(r.positions['wallet:safe:COIN'].cost,3);
 assert.equal(r.positions['wallet:safe:COIN'].cycle,'buy');assert.equal(r.closed[0].pnl,1);
});
test('automatic sale, different wallet, ambiguous ownership and oversale cannot borrow another profile holding',()=>{
 for(const fills of [[buy(),sell({source:'source-signal'})], [buy('safe','other'),sell()],
  [buy(),{...buy('truenest'),txid:'other-buy'},sell()], [buy(),sell({raw:'101'})]]){
  const r=buildPositions(fills);assert.equal(r.closed.length,0);
  const held=Object.values(r.positions).find(p=>p.profile==='safe');assert.equal(held.raw,'100');
 }
});
