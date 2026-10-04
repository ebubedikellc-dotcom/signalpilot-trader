import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {trailingExit,buildPositions} from '../lib/position-accounting.mjs';
import {createTradingJournal} from '../lib/trading-journal.mjs';
const p={key:'w:safe:m',wallet:'w',profile:'safe',mint:'m',raw:'100',cost:50,verified:true,cycle:'buy1'};
test('10% trail follows 60 to 80 to 100, never falls with the quote, and triggers at 90',()=>{
 let mark;
 for(const value of [60,80,100]){mark=trailingExit(p,value,10,mark);assert.equal(mark.trigger,value*.9);assert.equal(mark.triggered,false);}
 mark=trailingExit(p,95,10,mark);assert.equal(mark.trigger,90);assert.equal(mark.triggered,false);
 mark=trailingExit(p,90,10,mark);assert.equal(mark.reason,'10% trailing stop');
 assert.equal(trailingExit(p,110,10,mark).triggered,true,'failed exit must retry even after rebound');
});
test('initial decline triggers at 45; missing quotes or invalid settings do not trigger',()=>{
 assert.equal(trailingExit(p,45,10).triggered,true);
 for(const quote of [NaN,Infinity,0,-1])assert.equal(trailingExit(p,quote,10),null);
 for(const percent of [NaN,0,100,-1])assert.equal(trailingExit(p,50,percent),null);
});
test('partial sale scales the trigger; fresh purchase after full closure resets its peak',()=>{
 const peak=trailingExit(p,100,10);
 const reduced=trailingExit({...p,raw:'50',cost:25},49,10,peak);
 assert.equal(reduced.trigger,45);assert.equal(reduced.triggered,false);
 const fresh=trailingExit({...p,cycle:'buy2'},50,10,peak);
 assert.equal(fresh.trigger,45);assert.equal(fresh.triggered,false);
 const base={wallet:'w',profile:'safe',mint:'m',raw:'100',usd:50};
 const rebuilt=buildPositions([{...base,side:'buy',txid:'buy1',time:1},{...base,side:'sell',time:2},{...base,side:'buy',txid:'buy2',time:3}]);
 assert.equal(rebuilt.positions[p.key].cycle,'buy2');
});
test('separate coins and added quantities do not share or lower the unit peak',()=>{
 const peak=trailingExit(p,80,10);
 assert.equal(trailingExit({...p,raw:'200',cost:100},158,10,peak).trigger,144);
 assert.equal(trailingExit({...p,key:'other',cycle:'other'},50,10).trigger,45);
});
test('peak and triggered exit survive journal restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'trailing-'));
 try {
  const file=path.join(dir,'journal.json'),j=createTradingJournal(file,'USDC'),d=await j.load();
  d.trailingStops={[p.key]:trailingExit(p,100,10)};await j.save();
  const restarted=createTradingJournal(file,'USDC'),r=await restarted.load();
  r.trailingStops[p.key]=trailingExit(p,90,10,r.trailingStops[p.key]);assert.equal(r.trailingStops[p.key].triggered,true);await restarted.save();
  const final=await createTradingJournal(file,'USDC').load();
  assert.equal(trailingExit(p,100,10,final.trailingStops[p.key]).triggered,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
