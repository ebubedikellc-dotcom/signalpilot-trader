"""Bounded model requests shared by the web and worker processes."""
import fcntl, json, os, time, urllib.request, urllib.error
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
                'prompt':prompt,'stream':False,'think':False,'keep_alive':0,
                'options':{'num_ctx':4096,'num_batch':128,'num_predict':700,'temperature':0.2}}).encode(),
            headers={'Content-Type':'application/json'})
        # Retry once only for transient model HTTP errors, never downloads.
        for attempt in range(2 if timeout > 300 else 1):
            try:
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    result=json.load(response)
                break
            except urllib.error.HTTPError as e:
                try: body=e.read(8192).decode('utf-8',errors='replace').lower()
                except Exception: body=''
                # Only fixed descriptions are shown publicly; never raw server output.
                if any(x in body for x in ('out of memory','requires more system memory','cannot allocate memory')):
                    reason='Model reported insufficient memory. Check model size and server memory.'
                elif any(x in body for x in ('timed out','timeout')):
                    reason='Model reported a timeout. Check CPU load and model service logs.'
                elif any(x in body for x in ('runner process','signal: killed','terminated')):
                    reason='Model runner stopped. Check service logs and memory; the cause is not confirmed.'
                else:
                    reason='Model service error; exact cause unavailable. Check model service logs.'
                if timeout > 300 and attempt == 0 and e.code in (500,502,503,504) and 'insufficient memory' not in reason:
                    time.sleep(2)
                    continue
                raise ValueError('Qwen HTTP '+str(e.code)+': '+reason) from e
            except (TimeoutError, urllib.error.URLError) as e:
                raise ValueError('Qwen request timed out or could not connect. Saved source text is kept.') from e
        if result.get('done_reason')=='length':
            raise ValueError('Qwen reached its response limit. This section is not complete.')
        answer=result.get('response','').strip()
        if not result.get('done') or not answer:
            raise ValueError('Qwen returned an empty or incomplete response.')
        return answer
