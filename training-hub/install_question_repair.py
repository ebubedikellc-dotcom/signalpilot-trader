"""Patch existing hub files; abort on unexpected versions before writing."""
import ast, pathlib, sys
PAYLOAD = {'model_gate.py': '"""Cross-process model exclusion with priority for one waiting question."""\nimport fcntl, time\nfrom contextlib import contextmanager\nimport store\n\n@contextmanager\ndef turn(question=False, wait_seconds=2100):\n    deadline = time.monotonic() + wait_seconds\n    with (store.ROOT/\'question-priority.lock\').open(\'a\') as priority, (store.ROOT/\'model-request.lock\').open(\'a\') as model:\n        intent = False\n        try:\n            if question:\n                try: fcntl.flock(priority, fcntl.LOCK_EX | fcntl.LOCK_NB)\n                except BlockingIOError: raise ValueError(\'Another question is waiting. Please wait for its result.\')\n                intent = True\n            while True:\n                allowed = question\n                if not question:\n                    try:\n                        fcntl.flock(priority, fcntl.LOCK_EX | fcntl.LOCK_NB)\n                        allowed = True\n                    except BlockingIOError: allowed = False\n                acquired = False\n                try:\n                    if allowed:\n                        try:\n                            fcntl.flock(model, fcntl.LOCK_EX | fcntl.LOCK_NB)\n                            acquired = True\n                        except BlockingIOError: pass\n                finally:\n                    if not question and allowed: fcntl.flock(priority, fcntl.LOCK_UN)\n                if acquired: break\n                if time.monotonic() >= deadline:\n                    raise ValueError(\'Timed out waiting for the model. No answer was generated; lessons are preserved.\')\n                time.sleep(0.1)\n            yield\n        finally:\n            fcntl.flock(model, fcntl.LOCK_UN)\n            if intent: fcntl.flock(priority, fcntl.LOCK_UN)\n', 'question_queue.py': '"""Bounded asynchronous question jobs; no note writes and no parallel model calls."""\nimport threading, time, uuid\n_jobs = {}\n_guard = threading.Lock()\n_slot = threading.Lock()\n\ndef submit(data, answer):\n    question = str(data.get(\'question\', \'\')).strip()\n    if not question or len(question) > 2000:\n        raise ValueError(\'Enter a question of 1–2000 characters.\')\n    if not _slot.acquire(False):\n        raise ValueError(\'A question is already waiting or being answered. Wait for its result.\')\n    key = str(uuid.uuid4())\n    with _guard:\n        cutoff = time.time() - 3600\n        for old in list(_jobs):\n            if _jobs[old][\'created\'] < cutoff:\n                del _jobs[old]\n        _jobs[key] = dict(id=key, status=\'waiting\', created=time.time())\n    def run():\n        try:\n            result = answer({\'question\': question})\n            with _guard: _jobs[key].update(status=\'ready\', answer=result)\n        except Exception as exc:\n            message = str(exc) if isinstance(exc, ValueError) else \'Question processing failed; check server logs. No answer was verified.\'\n            with _guard: _jobs[key].update(status=\'failed\', error=message)\n        finally:\n            _slot.release()\n    try: threading.Thread(target=run, daemon=True).start()\n    except Exception:\n        _slot.release()\n        with _guard: del _jobs[key]\n        raise\n    return dict(id=key, status=\'waiting\')\n\ndef get(key):\n    with _guard:\n        if key not in _jobs:\n            raise ValueError(\'Question not found or server restarted. No answer was verified.\')\n        return dict(_jobs[key])\n'}

def patch(root):
    root=pathlib.Path(root)
    output=dict(PAYLOAD)
    model=(root/'model_requests.py').read_text()
    start=model.index('    # Both containers mount /data.')
    end=model.index('        req=urllib.request.Request',start)
    model=model[:start]+"    from model_gate import turn\n    with turn(question=timeout <= 300):\n"+model[end:]
    output['model_requests.py']=model
    visual=(root/'visual_lessons.py').read_text()
    old="    with (store.ROOT/'model-request.lock').open('a') as lock:\n        fcntl.flock(lock,fcntl.LOCK_EX)"
    if visual.count(old)!=1: raise ValueError('Unexpected visual lock code')
    output['visual_lessons.py']=visual.replace(old,"    from model_gate import turn\n    with turn():")
    server=(root/'server.py').read_text()
    if 'import question_queue' in server: raise ValueError('Question repair already installed')
    server='import question_queue\n'+server
    anchor="        if route=='/api/jobs':"
    if server.count(anchor)!=1: raise ValueError('Unexpected GET routes')
    server=server.replace(anchor,"        if route.startswith('/api/question/'):\n            try: return self.send(200,question_queue.get(route.rsplit('/',1)[1]))\n            except ValueError as e: return self.send(404,{'error':str(e)})\n"+anchor)
    anchor="            if route=='/api/chat':"
    if server.count(anchor)!=1: raise ValueError('Unexpected POST routes')
    server=server.replace(anchor,"            if route=='/api/question':\n                return self.send(202,question_queue.submit(data,chat_answer))\n"+anchor)
    output['server.py']=server
    html=(root/'training.html').read_text()
    lines=html.splitlines()
    matches=[i for i,line in enumerate(lines) if line.startswith("$('chat').onsubmit=")]
    if len(matches)!=1: raise ValueError('Unexpected question form')
    lines[matches[0]]=JS
    output['training.html']='\n'.join(lines)+'\n'
    for name,content in output.items():
        if name.endswith('.py'): ast.parse(content)
    for name,content in output.items(): (root/name).write_text(content)

JS = "$('chat').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;let id;try{const job=await api('/api/question',{question:$('question').value});id=job.id;localStorage.setItem('tradeLordQuestion',id);await pollQuestion(id)}catch(e){$('answer').textContent=e.message}finally{b.disabled=false}};\nasync function pollQuestion(id){$('answer').textContent='Question accepted. Waiting for a safe turn after the current lesson request, then generating an answer…';for(let i=0;i<900;i++){const r=await fetch('/api/question/'+encodeURIComponent(id));const j=await r.json();if(!r.ok)throw Error(j.error||'Unable to check question');if(j.status==='ready'){localStorage.removeItem('tradeLordQuestion');$('answer').textContent=j.answer;return}if(j.status==='failed'){localStorage.removeItem('tradeLordQuestion');throw Error(j.error)}await new Promise(resolve=>setTimeout(resolve,3000))}throw Error('Still waiting. Reload this page to check the same question; do not resubmit.');}\nconst pendingQuestion=localStorage.getItem('tradeLordQuestion');if(pendingQuestion){const b=$('chat').querySelector('button');b.disabled=true;pollQuestion(pendingQuestion).catch(e=>{$('answer').textContent=e.message}).finally(()=>{b.disabled=false})}\n"
if __name__=='__main__': patch(sys.argv[1])
