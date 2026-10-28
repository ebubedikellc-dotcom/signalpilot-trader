import io, json, os, tempfile, unittest, threading, urllib.request, urllib.error
from pathlib import Path
import store
from server import Handler, ThreadingHTTPServer
class HubTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();store.ROOT=Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
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
