import test from 'node:test';
import assert from 'node:assert/strict';
import {LessonPlayback,orderedVideos} from '../trade-lord-player.js';
import {SPEECH_SOURCES} from '../lib/trade-lord-speech.mjs';

function setup(){
  const calls=[];let visible=true;
  const p=new LessonPlayback({visible:()=>visible});
  p.configure(SPEECH_SOURCES,'all');
  const player={loadVideoById:value=>calls.push(['load',value.videoId]),cueVideoById:id=>calls.push(['cue',id]),playVideo:()=>calls.push(['play']),pauseVideo:()=>calls.push(['pause'])};
  return {p,calls,player,hide:()=>{visible=false;}};
}
test('Repeat all follows Nigerian, UK and US sources, then returns to Nigeria',()=>{
  const {p,calls,player}=setup();
  const lessons=orderedVideos([...SPEECH_SOURCES].reverse());
  assert.deepEqual(lessons.map(s=>s.playbackGroup),[...Array(7).fill('en-NG'),...Array(2).fill('en-GB'),...Array(3).fill('en-US')]);
  assert.equal(lessons.some(s=>s.id==='dtPRiXJYqWU'),false);
  assert.equal(p.active,false);assert.equal(calls.length,0);
  p.play();p.attach(player);
  for(let i=0;i<12;i++){
    assert.equal(p.index,i);
    p.stateChanged(1,p.lesson.id);p.stateChanged(0,p.lesson.id);
  }
  assert.equal(p.index,0);assert.equal(p.active,true);
  assert.deepEqual(calls.filter(c=>c[0]==='load').map(c=>c[1]),[...orderedVideos(SPEECH_SOURCES).map(s=>s.id),orderedVideos(SPEECH_SOURCES)[0].id]);
});
test('Repeat one stays on its lesson; Play once stops after US and can restart',()=>{
  const {p,player}=setup();p.play(8);p.attach(player);p.setRepeat('one');
  p.stateChanged(1,p.lesson.id);p.stateChanged(0,p.lesson.id);assert.equal(p.index,8);
  p.setRepeat('off');p.play(12);p.stateChanged(1,p.lesson.id);p.stateChanged(0,p.lesson.id);
  assert.equal(p.status,'complete');assert.equal(p.active,false);p.play();assert.equal(p.index,0);
});
test('pause before player loads, hidden pages, blocked autoplay and errors do not loop',()=>{
  const {p,calls,player,hide}=setup();p.play();p.pause();p.attach(player);
  assert.equal(calls.filter(c=>c[0]==='load').length,0);
  p.play();p.stateChanged(1,p.lesson.id);p.blocked();p.stateChanged(0,p.lesson.id);assert.equal(p.index,0);assert.equal(p.active,false);
  p.play();p.stateChanged(1,p.lesson.id);p.fail('Video unavailable');p.stateChanged(0,p.lesson.id);assert.equal(p.status,'error');assert.equal(p.index,0);
  p.next();assert.equal(p.index,1);p.stateChanged(1,p.lesson.id);hide();p.stateChanged(0,p.lesson.id);
  assert.equal(p.active,false);assert.equal(p.index,1);
});
test('duplicate end events, stale events and refreshed settings never skip a lesson',()=>{
  const {p,player}=setup();p.play();p.attach(player);const first=p.lesson.id;
  p.stateChanged(1,first);p.stateChanged(0,first);assert.equal(p.index,1);
  p.stateChanged(0,first);p.stateChanged(0,p.lesson.id);assert.equal(p.index,1);
  p.configure(SPEECH_SOURCES,'one');assert.equal(p.index,1);assert.equal(p.player,player);
  assert.equal(p.repeat,'one');
});
