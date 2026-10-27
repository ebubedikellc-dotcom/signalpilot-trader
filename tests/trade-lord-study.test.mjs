import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTradeLord} from '../lib/trade-lord.mjs';
import {TRADING_SOURCES,TRADING_LESSONS,validateStudy} from '../lib/trade-lord-study.mjs';

test('classroom settings persist, reject arbitrary embed IDs, and do not launch training',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'trade-study-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const service=await createTradeLord({directory,env:{}});
  await service.settings({study:{courseId:'options',repeat:false}});
  await assert.rejects(service.settings({study:{courseId:'forex'},speech:{playlistRepeat:'bad'}}));
  const fresh=await createTradeLord({directory,env:{}}),snapshot=fresh.snapshot();
  assert.deepEqual(snapshot.study,{courseId:'options',repeat:false});
  assert.equal(snapshot.tradingStudy.videosStudied,0);assert.equal(snapshot.tradingStudy.modelWeightsTrained,false);assert.equal(snapshot.tradingStudy.overnightTrainingRunning,false);
  assert.throws(()=>validateStudy({courseId:'javascript:alert(1)'}),/listed trading course/);
  assert.throws(()=>validateStudy({repeat:'true'}),/true or false/);
  assert.equal(snapshot.tradingSources.filter(s=>s.playlistId).length,12);
  assert.equal(snapshot.notes.filter(n=>n.category==='Trading study').length,8);
  assert.equal(fresh.exportMemory().foundations.filter(n=>n.category==='Trading study').length,8);
});
test('trading video questions retrieve written trading notes, never claim videos were learned',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'trade-study-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const service=await createTradeLord({directory,env:{}});
  const result=await service.chat({message:'What did you learn from YouTube trading courses about leverage and forex?'});
  assert.equal(result.engine,'evidence');assert.match(result.text,/12 video-course links/);assert.match(result.text,/No video content has been ingested/);assert.match(result.text,/losses beyond the original deposit/);
  assert.doesNotMatch(result.text,/The speech library/);
  assert.ok(TRADING_SOURCES.every(s=>s.url.startsWith('https://')));
  assert.ok(TRADING_LESSONS.every(n=>n.source&&n.body));
});
