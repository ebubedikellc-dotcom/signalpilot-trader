// Official embedded courses for owner viewing; never reports them as learned.
export function createTradingClassroom({saveSettings}){
  const $=s=>document.querySelector(s),select=$('#study-course'),repeat=$('#study-repeat'),host=$('#study-player'),status=$('#study-status');
  let sources=[],dirty=false,signature='',opened=false;
  const selected=()=>sources.find(s=>s.id===select.value&&s.playlistId);
  function stop(message='Player closed. Your saved course choice is kept.'){
    if(!opened)return;
    host.replaceChildren();host.hidden=true;opened=false;$('#study-close').disabled=true;status.textContent=message;
  }
  function current(){const source=selected();$('#study-open-source').hidden=!source;if(source)$('#study-open-source').href=source.url;}
  function changed(){dirty=true;stop('Course selection changed. Press Open course to load it.');current();$('#study-save').textContent='Unsaved choices — press Save classroom settings.';}
  select.onchange=changed;repeat.onchange=changed;
  $('#study-load').onclick=()=>{
    const source=selected();if(!source||!/^[\w-]+$/.test(source.playlistId))return;
    stop();const frame=document.createElement('iframe'),url=new URL('https://www.youtube.com/embed/videoseries');
    url.searchParams.set('list',source.playlistId);url.searchParams.set('listType','playlist');url.searchParams.set('loop',repeat.checked?'1':'0');url.searchParams.set('playsinline','1');url.searchParams.set('autoplay','0');
    frame.src=url.href;frame.title=source.title+' — '+source.creator;frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allowFullscreen=true;
    host.replaceChildren(frame);host.hidden=false;opened=true;$('#study-close').disabled=false;
    status.textContent=`Opened ${source.title}. Press Play inside the video. ${repeat.checked?'This course is set to repeat. ':''}Playback does not train the AI. If YouTube cannot play it here, use the source link.`;
  };
  $('#study-close').onclick=()=>stop();
  $('#study-form').onsubmit=async e=>{
    e.preventDefault();const button=e.submitter,settings={courseId:select.value,repeat:repeat.checked};button.disabled=true;select.disabled=true;repeat.disabled=true;
    try{await saveSettings(settings);dirty=false;$('#study-save').textContent='Saved ✓ Your classroom choices will be here when you return.';}
    catch(error){$('#study-save').textContent=error.message;}
    finally{button.disabled=false;select.disabled=false;repeat.disabled=false;}
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Player closed while this screen was hidden. Press Open course when you return.');});
  window.addEventListener('pagehide',()=>stop());
  return {
    stop,
    configure(next,settings){
      sources=next||[];const nextSignature=JSON.stringify(sources);
      if(nextSignature!==signature){
        signature=nextSignature;select.replaceChildren();$('#study-sources').replaceChildren();
        for(const s of sources){
          if(s.playlistId)select.add(new Option(`${s.topic} · ${s.title}`,s.id));
          const card=document.createElement('article');card.className='knowledge-card';
          const topic=document.createElement('span');topic.className='eyebrow';topic.textContent=s.topic;
          const title=document.createElement('h3');title.textContent=s.title;
          const detail=document.createElement('p');detail.textContent=s.creator+' · '+s.kind;
          const state=document.createElement('small');state.textContent=s.status;
          const link=document.createElement('a');link.className='resource-link';link.href=s.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open original source ↗';
          card.append(topic,title,detail,state,link);$('#study-sources').append(card);
        }
      }
      if(!dirty){select.value=settings?.courseId||'futures';repeat.checked=settings?.repeat!==false;}
      $('#study-count').textContent=`${sources.filter(s=>s.playlistId).length} video courses · 8 written study lessons · 0 videos ingested`;
      current();
    }
  };
}
