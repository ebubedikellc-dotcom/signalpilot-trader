import io, json, os, tempfile, unittest, threading, urllib.request, urllib.error
from pathlib import Path
import store
from unittest.mock import patch
from types import SimpleNamespace
import worker
from server import Handler, ThreadingHTTPServer, chat_answer
class HubTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();store.ROOT=Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def test_chat_without_processed_lessons_does_not_call_model(self):
        with patch('server.ask') as ask:
            answer=chat_answer({'question':'What did the teacher explain?'})
        ask.assert_not_called()
        self.assertIn('do not have any processed video lessons',answer)
    def test_chat_ignores_unfinished_and_empty_lessons(self):
        for status,notes in [('working','Unfinished notes'),('failed','Failed notes'),('ready','  ')]:
            id=store.add(status)
            store.update(id,status,lessons=notes)
        with patch('server.ask') as ask:
            chat_answer({'question':'Explain the lesson'})
        ask.assert_not_called()
    def test_chat_references_only_completed_lessons(self):
        ready=store.add('Teacher lesson')
        store.update(ready,'ready',lessons='[12s] The teacher explains a worked example.')
        pending=store.add('Unfinished lesson')
        store.update(pending,'working',lessons='Unprocessed material must not be used.')
        with patch('server.ask',return_value='Teacher lesson [12s]: a worked example.') as ask:
            answer=chat_answer({'question':'Explain the worked example'})
        self.assertIn('Teacher lesson',answer)
        sources=json.loads(ask.call_args.args[0].split('SOURCE NOTES:\n',1)[1].split('\nQUESTION:\n',1)[0])
        self.assertEqual([source['title'] for source in sources],['Teacher lesson'])
        self.assertEqual(sources[0]['lessons'],store.get(ready)['lessons'])
    def test_brain_link_persists_and_rejects_credentials(self):
        self.assertEqual(store.brain_link(),'')
        store.save_brain_link('https://brain.example.com/')
        self.assertEqual(store.brain_link(),'https://brain.example.com')
        for value in ('javascript:alert(1)','http://brain.example.com','https://user:pass@brain.example.com','https://brain.example.com/?key=secret'):
            with self.assertRaises(ValueError):store.save_brain_link(value)
        self.assertEqual(store.brain_link(),'https://brain.example.com')
        store.save_brain_link('');self.assertEqual(store.brain_link(),'')
    def test_long_lessons_remain_valid_at_context_boundary(self):
        notes='Teacher explains "examples" and exceptions.\n'*500
        ready=store.add('Long lesson')
        store.update(ready,'ready',lessons=notes)
        with patch('server.ask',return_value='From the excerpt.') as ask:
            chat_answer({'question':'What examples did the teacher explain?'})
        sources=json.loads(ask.call_args.args[0].split('SOURCE NOTES:\n',1)[1].split('\nQUESTION:\n',1)[0])
        self.assertEqual(sources[0]['title'],'Long lesson')
        self.assertTrue(sources[0]['excerpted'])
        self.assertTrue(notes.startswith(sources[0]['lessons']))
        self.assertLess(len(sources[0]['lessons']),len(notes))
        self.assertEqual(store.get(ready)['lessons'],notes)
    def test_link_canonicalization_and_duplicates(self):
        a=store.add('Lesson','https://youtu.be/abcdefghijk')
        b=store.add('Duplicate','https://www.youtube.com/watch?v=abcdefghijk&list=anything')
        self.assertEqual(a,b);self.assertEqual(len(store.jobs()),1)
        for url in ('http://youtu.be/abcdefghijk','https://127.0.0.1/video.mp4','https://youtube.com.evil.test/watch?v=abcdefghijk','https://www.youtube.com/playlist?list=PLabcd','https://user:pass@youtube.com/watch?v=abcdefghijk'):
            with self.assertRaises(ValueError): store.canonical(url)
    def test_claim_once_and_durable_failure(self):
        id=store.add('Lesson','https://youtu.be/abcdefghijk')
        self.assertEqual(store.claim()['id'],id);self.assertIsNone(store.claim())
        store.update(id,'needs_upload','Cannot retrieve')
        self.assertEqual(store.get(id)['url'],'https://www.youtube.com/watch?v=abcdefghijk')
        self.assertIsNone(store.claim())
    def test_transcript_checkpoint_preserved(self):
        id=store.add('Lesson');store.update(id,'working',transcript='[0s] A lesson')
        store.update(id,'needs_lessons','Model offline')
        self.assertEqual(store.get(id)['transcript'],'[0s] A lesson')
        self.assertEqual(store.get(id)['lessons'],'')
    def test_topic_persistence_dedup_and_source_queue(self):
        id=store.add_topic('  Position sizing  ')
        self.assertEqual(store.add_topic('Position sizing'),id)
        topic=store.claim_topic();self.assertEqual(topic['id'],id)
        self.assertIsNone(store.claim_topic())
        result=SimpleNamespace(stdout=json.dumps([{'title':'Risk lesson','url':'https://youtu.be/abcdefghijk'}]))
        with patch('worker.subprocess.run',return_value=result): worker.process_topic(topic)
        self.assertEqual(store.topics()[0]['status'],'queued')
        self.assertEqual(len(store.jobs()),1)
        with patch('worker.subprocess.run',return_value=result): worker.process_topic(topic)
        self.assertEqual(len(store.jobs()),1)
        self.assertEqual(store.claim()['url'],'https://www.youtube.com/watch?v=abcdefghijk')
    def test_failed_topic_does_not_block_upload_queue(self):
        id=store.add_topic('Risk management')
        topic=store.claim_topic()
        with patch('worker.subprocess.run',side_effect=TimeoutError):worker.process_topic(topic)
        self.assertEqual(store.topics()[0]['status'],'failed')
        uploaded=store.add('Upload');store.update(uploaded,'queued')
        self.assertEqual(store.claim()['id'],uploaded)
        with self.assertRaises(ValueError):store.add_topic('x')
    def test_http_upload_validation_and_retry(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        def post(route,body,header=True):
            h={'Content-Type':'application/json'}
            if header:h['X-Trade-Lord']='1'
            return urllib.request.urlopen(urllib.request.Request(base+route,data=body,headers=h))
        try:
            with self.assertRaises(urllib.error.HTTPError) as denied: post('/api/add',b'{}',False)
            self.assertEqual(denied.exception.code,403)
            with post('/api/add',json.dumps({'title':'My video','permission':True}).encode()) as r:id=json.load(r)['id']
            with self.assertRaises(urllib.error.HTTPError):post('/api/upload/'+id,b'not a video file')
            self.assertEqual(store.get(id)['status'],'needs_upload')
            with post('/api/upload/'+id,b'\x00\x00\x00\x18ftypmp42data') as r:self.assertEqual(r.status,200)
            self.assertEqual(store.get(id)['status'],'queued')
            with self.assertRaises(urllib.error.HTTPError):post('/api/upload/'+id,b'\x00\x00\x00\x18ftypmp42data')
            self.assertTrue(store.media(id).exists())
        finally:server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
