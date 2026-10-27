// Visible YouTube playback only. No audio extraction or model-training side effects.
const groups=['en-NG','en-GB','en-US'];
const labels={'en-NG':'Nigerian English','en-GB':'UK English','en-US':'US English'};
export function orderedVideos(sources){
  return groups.flatMap(group=>sources.filter(s=>s.kind==='YouTube reference'&&s.playbackAvailable!==false&&s.playbackGroup===group&&/^[\w-]{11}$/.test(s.id)));
}

export class LessonPlayback {
  constructor({onChange=()=>{},visible=()=>true}={}){
    this.onChange=onChange;this.visible=visible;this.lessons=[];this.index=0;this.repeat='all';
    this.player=null;this.loadedId=null;this.active=false;this.played=false;this.status='ready';this.message='Ready. Press Play to begin.';
  }
  emit(){this.onChange(this);}
  get lesson(){return this.lessons[this.index];}
  configure(sources,repeat){
    const lessons=orderedVideos(sources),currentId=this.lesson?.id;
    this.lessons=lessons;this.index=Math.max(0,lessons.findIndex(s=>s.id===currentId));
    this.setRepeat(repeat);this.emit();
  }
  setRepeat(value){this.repeat=['all','one','off'].includes(value)?value:'all';}
  attach(player){
    this.player=player;
    if(this.active&&this.visible())this.load();
    else if(this.lesson){this.loadedId=this.lesson.id;player.cueVideoById(this.loadedId);}
  }
  load(){
    if(!this.player||!this.lesson)return;
    this.played=false;this.loadedId=this.lesson.id;
    this.player.loadVideoById({videoId:this.loadedId,startSeconds:0});
  }
  play(index){
    if(!this.lessons.length||!this.visible())return;
    const select=Number.isInteger(index),reload=select||['error','complete'].includes(this.status);
    if(select)this.index=Math.max(0,Math.min(index,this.lessons.length-1));
    else if(this.status==='complete')this.index=0;
    this.active=true;this.status='loading';this.message='Loading video…';this.emit();
    if(this.player){if(reload||this.loadedId!==this.lesson.id)this.load();else this.player.playVideo();}
  }
  pause(message='Paused. Press Play to continue.'){
    this.active=false;this.played=false;this.player?.pauseVideo();
    this.status='paused';this.message=message;this.emit();
  }
  next(){if(this.lessons.length)this.play((this.index+1)%this.lessons.length);}
  stateChanged(code,videoId){
    if(videoId&&videoId!==this.lesson?.id)return;
    if(code===1){
      if(!this.visible()){this.pause('Paused while this screen is closed. Press Play when you return.');return;}
      this.active=true;this.played=true;this.status='playing';this.message='Playing. AI speech training is not running.';
    }else if(code===0){
      // Only an actually playing video may advance. Ignore duplicate/stale end events.
      if(!this.active||!this.played)return;
      this.played=false;
      if(!this.visible()){this.pause();return;}
      if(this.repeat==='one')this.play(this.index);
      else if(this.index<this.lessons.length-1)this.play(this.index+1);
      else if(this.repeat==='all')this.play(0);
      else {this.active=false;this.status='complete';this.message='Playlist finished. Press Play to start again.';}
    }else if(code===2&&this.active){this.active=false;this.played=false;this.status='paused';this.message='Paused. Press Play to continue.';}
    else if(code===3&&this.active){this.status='loading';this.message='Buffering video…';}
    this.emit();
  }
  blocked(){this.active=false;this.played=false;this.status='blocked';this.message='Your browser needs a tap. Press Play inside the video to continue.';this.emit();}
  fail(message){
    this.active=false;this.played=false;this.player?.pauseVideo();
    this.status='error';this.message=message;this.emit();
  }
}

let apiLoading;
function loadYouTube(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(apiLoading)return apiLoading;
  apiLoading=new Promise((resolve,reject)=>{
    const tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';
    const previous=window.onYouTubeIframeAPIReady;
    const fail=()=>{clearTimeout(timer);tag.remove();apiLoading=null;reject(new Error('YouTube did not load. Check your connection and press Play again, or open the video on YouTube.'));};
    const timer=setTimeout(fail,15000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);previous?.();resolve(window.YT);};
    tag.onerror=fail;document.head.append(tag);
  });
  return apiLoading;
}

export function createSpeechPlaylist({saveSettings}){
  const $=s=>document.querySelector(s);
  const repeat=$('#playlist-repeat'),save=$('#playlist-save'),host=$('#lesson-player-host'),placeholder=$('#lesson-player-placeholder');
  let dirty=false,queueSignature='',loadingPlayer=null,playerInstance=null,configured=false,loadingTimer=null,waitingFor=null;
  const visible=()=>!document.hidden&&!$('[data-panel="speech"]').hidden&&!$('#workspace').hidden;
  const playback=new LessonPlayback({visible,onChange:render});
  function render(){
    const p=playback,s=p.lesson;
    if(p.status==='loading'&&p.active){
      if(waitingFor!==s?.id){clearTimeout(loadingTimer);waitingFor=s?.id;loadingTimer=setTimeout(()=>p.fail('The video is taking too long to start. Try Play again, open it on YouTube, or press Next.'),25000);}
    }else{clearTimeout(loadingTimer);loadingTimer=null;waitingFor=null;}
    $('#lesson-title').textContent=s?.title||'No videos available';
    $('#lesson-position').textContent=s?`${labels[s.playbackGroup]} · Video ${p.index+1} of ${p.lessons.length}`:'No videos in this playlist';
    $('#lesson-focus').textContent=s?.focus||'';
    $('#lesson-status').textContent=p.message;
    $('#lesson-status').classList.toggle('playlist-error',p.status==='error');
    $('#lesson-source').hidden=!s;if(s)$('#lesson-source').href=`https://www.youtube.com/watch?v=${s.id}`;
    $('#lesson-play').disabled=!s;$('#lesson-pause').disabled=!p.active;
    $('#lesson-next').disabled=!s;$('#lesson-restart').disabled=!s;
    $('#lesson-play').textContent=p.status==='playing'?'Playing ▶':p.status==='loading'?'Loading…':'Play ▶';
    for(const el of document.querySelectorAll('[data-language]'))el.classList.toggle('selected',el.dataset.language===s?.playbackGroup);
    const signature=p.lessons.map(s=>s.id).join(',');
    if(signature!==queueSignature){
      queueSignature=signature;$('#lesson-list').replaceChildren();
      p.lessons.forEach((s,i)=>{
        const item=document.createElement('li'),button=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('small');
        button.type='button';button.dataset.lessonIndex=i;name.textContent=`${i+1}. ${s.title}`;detail.textContent=labels[s.playbackGroup];
        button.append(name,detail);button.onclick=()=>start(i);item.append(button);$('#lesson-list').append(item);
      });
    }
    for(const button of document.querySelectorAll('[data-lesson-index]')){
      if(Number(button.dataset.lessonIndex)===p.index)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    }
  }
  async function ensurePlayer(){
    if(playback.player)return;
    if(loadingPlayer)return loadingPlayer;
    loadingPlayer=(async()=>{
      const YT=await loadYouTube();
      if(!playback.active||!visible())return;
      host.hidden=false;placeholder.hidden=true;
      await new Promise((resolve,reject)=>{
        let settled=false;
        const timer=setTimeout(()=>{settled=true;playerInstance?.destroy();playerInstance=null;host.replaceChildren(Object.assign(document.createElement('div'),{id:'lesson-player'}));host.hidden=true;placeholder.hidden=false;reject(new Error('The video player did not respond. Press Play to try again, or open the video on YouTube.'));},15000);
        playerInstance=new YT.Player('lesson-player',{
          width:'100%',height:'100%',videoId:playback.lesson.id,
          playerVars:{playsinline:1,autoplay:0,controls:1,origin:location.origin},
          events:{
            onReady:e=>{if(settled)return;settled=true;clearTimeout(timer);playback.attach(e.target);resolve();},
            onStateChange:e=>{let id;try{id=new URL(e.target.getVideoUrl()).searchParams.get('v');}catch{}playback.stateChanged(e.data,id);},
            onAutoplayBlocked:()=>playback.blocked(),
            onError:()=>playback.fail('YouTube could not play this video here. It may be unavailable or restricted. Open it on YouTube, or press Next.')
          }
        });
      });
    })();
    try{await loadingPlayer;}finally{loadingPlayer=null;}
  }
  async function start(index){
    playback.play(index);
    try{await ensurePlayer();}catch(error){playback.fail(error.message);}
  }
  $('#lesson-play').onclick=()=>start();
  $('#lesson-pause').onclick=()=>playback.pause();
  $('#lesson-next').onclick=()=>start((playback.index+1)%playback.lessons.length);
  $('#lesson-restart').onclick=()=>start(0);
  repeat.onchange=()=>{dirty=true;playback.setRepeat(repeat.value);save.textContent='Applied for now. Press Save playlist settings to keep this choice.';};
  $('#playlist-form').onsubmit=async e=>{
    e.preventDefault();const button=e.submitter,value=repeat.value;button.disabled=true;repeat.disabled=true;save.textContent='Saving…';
    try{await saveSettings(value);dirty=false;save.textContent='Saved ✓ Your repeat choice stays here when you return.';}
    catch(error){save.textContent=error.message;}
    finally{button.disabled=false;repeat.disabled=false;}
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playback.active)playback.pause('Paused while this screen is closed. Press Play when you return.');});
  window.addEventListener('pagehide',()=>{if(playback.active)playback.pause();});
  return {
    configure(sources,savedRepeat){if(!dirty)repeat.value=savedRepeat||'all';if(!configured){save.textContent='Selected: '+repeat.selectedOptions[0].textContent+'.';configured=true;}playback.configure(sources,repeat.value);},
    pause(){if(playback.active)playback.pause('Paused when you left Speech. Press Play when you return.');}
  };
}
