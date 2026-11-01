"""One asynchronous question with observable phases and recoverable request IDs.

Jobs are process-local: restarting the web service still loses these results.
This module does not save, edit, retry, or delete any lesson.
"""
import threading
import time
import uuid

_jobs = {}
_guard = threading.Lock()
_slot = threading.Lock()
_local = threading.local()


def progress(status, phase, response_chars=0):
    key = getattr(_local, 'key', None)
    if key is None:
        return
    with _guard:
        if key in _jobs:
            _jobs[key].update(status=status, phase=phase, updated=time.time(),
                              response_chars=response_chars)


def submit(data, answer):
    question = str(data.get('question', '')).strip()
    if not question or len(question) > 2000:
        raise ValueError('Enter a question of 1–2000 characters.')
    if not _slot.acquire(False):
        raise ValueError('A question is already waiting or being answered. Wait for its result.')
    key, now = str(uuid.uuid4()), time.time()
    with _guard:
        for old in list(_jobs):
            if _jobs[old]['status'] in ('ready', 'failed') and _jobs[old]['updated'] < now - 3600:
                del _jobs[old]
        _jobs[key] = dict(id=key, question=question, status='waiting',
                          phase='waiting_for_model', created=now, updated=now,
                          response_chars=0)

    def run():
        _local.key = key
        try:
            result = answer({'question': question})
            if not isinstance(result, str) or not result.strip():
                raise ValueError('No complete answer was returned.')
            with _guard:
                _jobs[key].update(status='ready', phase='complete', answer=result,
                                  updated=time.time())
        except Exception as exc:
            message = str(exc) if isinstance(exc, ValueError) else 'Question processing failed; check server logs. No answer was verified.'
            with _guard:
                _jobs[key].update(status='failed', phase='failed', error=message,
                                  updated=time.time())
        finally:
            _local.key = None
            _slot.release()
    try:
        threading.Thread(target=run, daemon=True).start()
    except Exception:
        _slot.release()
        with _guard:
            del _jobs[key]
        raise
    return dict(id=key, status='waiting')


def get(key):
    with _guard:
        if key not in _jobs:
            raise ValueError('Question not found or server restarted. No answer was verified.')
        return dict(_jobs[key])


def current():
    with _guard:
        if not _jobs:
            return {'job': None}
        active = [j for j in _jobs.values() if j['status'] in ('waiting', 'generating')]
        job = max(active or list(_jobs.values()), key=lambda j: j['created'])
        return {'job': dict(job)}
