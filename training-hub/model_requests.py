"""Bounded model requests shared by the web and worker processes."""
import fcntl, json, os, urllib.request, urllib.error
import store

def ask(prompt, timeout=300):
    # Both containers mount /data. Avoid a chat request queuing behind a long lesson.
    with (store.ROOT/'model-request.lock').open('a') as lock:
        if timeout <= 300:
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('Qwen is processing a lesson. Please try your question shortly.')
        else:
            fcntl.flock(lock, fcntl.LOCK_EX)
        req=urllib.request.Request(os.getenv('OLLAMA_URL','http://ollama:11434')+'/api/generate',
            data=json.dumps({'model':os.getenv('QWEN_MODEL','qwen3:8b-q4_K_M'),
                'prompt':prompt,'stream':False,'think':False,
                'options':{'num_ctx':4096,'num_predict':700,'temperature':0.2}}).encode(),
            headers={'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                result=json.load(response)
        except urllib.error.HTTPError as e:
            raise ValueError('Qwen returned HTTP '+str(e.code)+'. Check the model service logs.') from e
        except (TimeoutError, urllib.error.URLError) as e:
            raise ValueError('Qwen request timed out or could not connect. Saved source text is kept.') from e
        if result.get('done_reason')=='length':
            raise ValueError('Qwen reached its response limit. This section is not complete.')
        answer=result.get('response','').strip()
        if not result.get('done') or not answer:
            raise ValueError('Qwen returned an empty or incomplete response.')
        return answer
