// Resume the existing request; never auto-submit a replacement after an error.
const questionButton = $('chat').querySelector('button');
function questionMessage(j) {
  const elapsed = Math.max(0, Math.floor(Date.now()/1000 - j.created));
  const phase = j.status === 'ready' ? 'Complete' : j.status === 'failed' ? 'Failed' :
    j.phase === 'writing_answer' ? 'Writing answer (' + j.response_chars + ' characters received)' :
    j.status === 'generating' ? 'Preparing answer' : 'Waiting for the current model task to finish';
  const header = phase + ' · ' + elapsed + ' seconds\nRequest: ' + j.id;
  if(j.status === 'ready') return header + '\n\n' + j.answer;
  if(j.status === 'failed') return header + '\n\n' + j.error;
  return header + '\nKeep this page open, or reload to resume checking the same request.';
}
async function pollQuestion(id) {
  for(let i=0;i<1200;i++) {
    const r = await fetch('/api/question/' + encodeURIComponent(id));
    const j = await r.json();
    if(!r.ok) {
      if(r.status === 404) localStorage.removeItem('tradeLordQuestion');
      throw Error(j.error || 'Unable to check the question. Reload to check the same request.');
    }
    $('answer').textContent = questionMessage(j);
    if(j.status === 'ready' || j.status === 'failed') {
      localStorage.removeItem('tradeLordQuestion');
      return;
    }
    if(!['waiting','generating'].includes(j.status)) throw Error('Unknown question status. No answer verified.');
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  throw Error('Still waiting. Reload to check the same request; do not resubmit.');
}
$('chat').onsubmit = async e => {
  e.preventDefault(); questionButton.disabled = true;
  try {
    const job = await api('/api/question', {question:$('question').value});
    localStorage.setItem('tradeLordQuestion',job.id);
    await pollQuestion(job.id);
  } catch(e) { $('answer').textContent = e.message; }
  finally { questionButton.disabled = false; }
};
(async()=>{
  questionButton.disabled = true;
  try {
    let id = localStorage.getItem('tradeLordQuestion');
    if(!id) {
      const r = await fetch('/api/question/current');
      const result = await r.json();
      if(!r.ok) throw Error(result.error || 'Unable to check the previous question.');
      if(result.job) {
        id = result.job.id;
        $('question').value = result.job.question;
        if(['waiting','generating'].includes(result.job.status)) localStorage.setItem('tradeLordQuestion',id);
      }
    }
    if(id) await pollQuestion(id);
  } catch(e) { $('answer').textContent = e.message; }
  finally { questionButton.disabled = false; }
})();
