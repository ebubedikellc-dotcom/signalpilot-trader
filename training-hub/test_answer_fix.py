import io
import json
import shutil
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

# The source repository generates this existing module during installation.
try:
    import model_gate
except ModuleNotFoundError:
    from install_question_repair import PAYLOAD
    model_gate = types.ModuleType('model_gate')
    exec(PAYLOAD['model_gate.py'], model_gate.__dict__)
    sys.modules['model_gate'] = model_gate
import store
import question_queue as queue
import question_answers as answers


def stream(*events):
    return io.BytesIO(b''.join(json.dumps(x).encode()+b'\n' for x in events))


def finish(job):
    deadline = time.monotonic()+3
    while time.monotonic() < deadline:
        value = queue.get(job['id'])
        if value['status'] in ('ready','failed'):
            return value
        time.sleep(.01)
    raise AssertionError('Question did not finish')


class AnswerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_root = store.ROOT
        store.ROOT = Path(self.tmp.name)
        with queue._guard:
            queue._jobs.clear()

    def tearDown(self):
        store.ROOT = self.old_root
        self.tmp.cleanup()

    def test_streaming_answer_and_question_settings(self):
        response = stream({'response':'33.33%', 'done':False},
                          {'response':' gain.', 'done':True, 'done_reason':'stop'})
        with patch.object(answers.urllib.request, 'urlopen', return_value=response) as request:
            job = queue.submit({'question':'recovery?'}, lambda _: answers.ask('saved notes'))
            result = finish(job)
        self.assertEqual(result['status'],'ready')
        self.assertEqual(result['answer'],'33.33% gain.')
        payload = json.loads(request.call_args.args[0].data)
        self.assertTrue(payload['stream'])
        self.assertFalse(payload['think'])
        self.assertEqual(payload['keep_alive'],0)
        self.assertEqual(payload['options']['num_ctx'],4096)
        self.assertEqual(payload['options']['num_predict'],384)
        self.assertEqual(request.call_args.kwargs['timeout'],900)

    def test_response_after_old_five_minute_deadline_can_complete(self):
        response = stream({'response':'Completed slowly.', 'done':True})
        @contextmanager
        def gate(**kwargs):
            self.assertTrue(kwargs['question'])
            yield
        with patch.object(answers,'turn',gate), patch.object(answers.time,'monotonic',side_effect=[0,400]), patch.object(answers.urllib.request,'urlopen',return_value=response):
            self.assertEqual(answers.ask('test'),'Completed slowly.')

    def test_waiting_generation_and_duplicate_protection(self):
        entered, release = threading.Event(), threading.Event()
        def answer(_):
            queue.progress('generating','writing_answer',12)
            entered.set()
            release.wait(2)
            return 'actual answer'
        job = queue.submit({'question':'one question'},answer)
        self.assertTrue(entered.wait(1))
        current = queue.current()['job']
        self.assertEqual(current['id'],job['id'])
        self.assertEqual(current['status'],'generating')
        self.assertEqual(current['response_chars'],12)
        self.assertNotIn('answer',current)
        with self.assertRaisesRegex(ValueError,'already waiting'):
            queue.submit({'question':'duplicate'},answer)
        release.set()
        self.assertEqual(finish(job)['answer'],'actual answer')

    def test_question_waits_for_worker_lock_then_runs(self):
        called = threading.Event()
        def respond(*args,**kwargs):
            called.set()
            return stream({'response':'done','done':True})
        with patch.object(answers.urllib.request,'urlopen',side_effect=respond):
            with model_gate.turn(wait_seconds=2):
                job=queue.submit({'question':'one'},lambda _:answers.ask('notes'))
                time.sleep(.15)
                self.assertEqual(queue.get(job['id'])['status'],'waiting')
                self.assertFalse(called.is_set())
            self.assertEqual(finish(job)['status'],'ready')

    def test_timeouts_and_connection_failure_are_distinct(self):
        errors = [(TimeoutError(), 'timed out before a complete answer'),
                  (urllib.error.URLError(TimeoutError()), 'timed out while connecting'),
                  (urllib.error.URLError(ConnectionRefusedError()), 'could not connect')]
        for error, expected in errors:
            with self.subTest(error=expected), patch.object(answers.urllib.request,'urlopen',side_effect=error):
                job=queue.submit({'question':'test'},lambda _:answers.ask('notes'))
                result=finish(job)
                self.assertEqual(result['status'],'failed')
                self.assertIn(expected,result['error'])
                self.assertNotIn('answer',result)

    def test_incomplete_and_limited_answers_are_not_passed_as_complete(self):
        cases = [({'response':'partial','done':False},'stopped before completing'),
                 ({'response':'partial','done':True,'done_reason':'length'},'answer-length limit'),
                 ({'response':'','done':True},'without returning answer'),
                 ({'error':'secret details'},'generation error')]
        for event, expected in cases:
            with self.subTest(expected=expected), patch.object(answers.urllib.request,'urlopen',return_value=stream(event)):
                job=queue.submit({'question':'test'},lambda _:answers.ask('notes'))
                result=finish(job)
                self.assertEqual(result['status'],'failed')
                self.assertIn(expected,result['error'])
                self.assertNotIn('answer',result)

    def test_http_error_does_not_expose_raw_details(self):
        error=urllib.error.HTTPError('http://ollama',500,'bad',{},io.BytesIO(b'private prompt requires more system memory'))
        with patch.object(answers.urllib.request,'urlopen',side_effect=error):
            with self.assertRaisesRegex(ValueError,'insufficient memory') as caught:
                answers.ask('notes')
        self.assertNotIn('private prompt',str(caught.exception))

    def test_empty_callback_does_not_become_ready_and_releases_slot(self):
        job=queue.submit({'question':'test'},lambda _: '')
        self.assertEqual(finish(job)['status'],'failed')
        next_job=queue.submit({'question':'next'},lambda _: 'valid')
        self.assertEqual(finish(next_job)['answer'],'valid')

    def test_active_job_and_recent_result_can_be_recovered(self):
        self.assertIsNone(queue.current()['job'])
        job=queue.submit({'question':'test'},lambda _: 'valid')
        result=finish(job)
        self.assertEqual(queue.current()['job'],result)
        with self.assertRaisesRegex(ValueError,'server restarted'):
            queue.get('missing')


class InstallerTests(unittest.TestCase):
    def test_patch_preserves_other_routes_forms_and_refuses_repeat(self):
        from install_answer_fix import install
        source=Path(__file__).parent
        # A minimal representative live server/form with the already-installed
        # question API and unrelated PDF/lesson code. Do not touch real files.
        server="import question_queue\nfrom model_requests import ask\nclass Handler:\n    def get(self,route):\n        if route.startswith('/api/question/'):\n            return question_queue.get(route.rsplit('/',1)[1])\n        if route=='/api/pdf/test': return 'pdf retained'\n"
        html="<form id='lesson-file-form'></form>\n<script>\n$('chat').onsubmit=old;\nasync function pollQuestion(id){}\nconst pendingQuestion=localStorage.getItem('tradeLordQuestion'); if(pendingQuestion){$('chat').querySelector('button');}\nconst untouched='written lessons';\n</script>"
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'server.py').write_text(server)
            (root/'training.html').write_text(html)
            for name in ('question_answers.py','question_queue.py','question_ui.js'):
                shutil.copyfile(source/name,root/name)
            install(root)
            patched=(root/'server.py').read_text()
            self.assertIn('from question_answers import ask',patched)
            self.assertLess(patched.index("route=='/api/question/current'"),patched.index("route.startswith('/api/question/')"))
            self.assertIn("if route=='/api/pdf/test': return 'pdf retained'",patched)
            self.assertIn("<form id='lesson-file-form'></form>",(root/'training.html').read_text())
            self.assertIn("const untouched='written lessons'",(root/'training.html').read_text())
            with self.assertRaisesRegex(ValueError,'already installed'):
                install(root)
            self.assertEqual(patched,(root/'server.py').read_text())

    def test_unknown_source_aborts_before_writing(self):
        from install_answer_fix import install
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'server.py').write_text('unknown')
            (root/'training.html').write_text('unknown')
            with self.assertRaises(ValueError): install(root)
            self.assertEqual((root/'server.py').read_text(),'unknown')


if __name__=='__main__':
    unittest.main()
