import json, tempfile, time, unittest, threading, urllib.request, urllib.error
from pathlib import Path
from unittest.mock import patch
import connections as c, store
from server import Handler, ThreadingHTTPServer

class ConnectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();store.ROOT=Path(self.tmp.name)/'source';store.connect().close()
    def tearDown(self):self.tmp.cleanup()
    def test_key_auth_and_revocation(self):
        k=c.create_key('Site A')
        self.assertTrue(c.authorized('Bearer '+k['key']))
        self.assertFalse(c.authorized('Bearer invalid'))
        self.assertNotIn(k['key'],json.dumps(c.keys()))
        with c.db() as db:self.assertNotIn(k['key'],str([tuple(r) for r in db.execute('SELECT * FROM website_keys')]))
        c.revoke(k['id']);self.assertFalse(c.authorized('Bearer '+k['key']))
    def test_encrypted_roundtrip_and_empty_destination(self):
        id=store.add('Risk lesson','https://youtu.be/abcdefghijk');store.update(id,'ready',transcript='Transcript',lessons='Use position limits.')
        store.media(id).write_bytes(b'test video bytes')
        store.add_topic('Risk management');c.create_key('Old website')
        t=c.start_export()
        for _ in range(100):
            state=c.transfer(t['id'])
            if state['status']!='building':break
            time.sleep(.02)
        self.assertEqual(state['status'],'ready',state)
        backup=c.transfer_dir()/(t['id']+'.tlbackup')
        self.assertNotIn(b'Use position limits.',backup.read_bytes())
        source_root=store.ROOT;store.ROOT=Path(self.tmp.name)/'destination';store.connect().close()
        with self.assertRaises(ValueError):c.restore(backup,'wrong-password-that-is-long')
        self.assertEqual(store.jobs(),[])
        result=c.restore(backup,t['password']);self.assertEqual(result['videos'],1);self.assertEqual(result['lessons'],1)
        self.assertEqual(store.get(id)['lessons'],'Use position limits.');self.assertEqual(store.media(id).read_bytes(),b'test video bytes')
        self.assertEqual(c.keys(),[])
        with self.assertRaises(ValueError):c.restore(backup,t['password'])
        self.assertTrue((source_root/(id+'.video')).exists())
    def test_transfer_expiry_and_unsafe_archive_rejected(self):
        import io, tarfile
        transfer_id='11111111-1111-4111-8111-111111111111'
        with c.db() as db:db.execute('INSERT INTO transfers VALUES (?,?,?,?)',(transfer_id,'ready','',time.time()-1))
        path=c.transfer_dir()/(transfer_id+'.tlbackup');path.write_bytes(b'expired')
        self.assertEqual(c.transfer(transfer_id)['status'],'expired');self.assertFalse(path.exists())
        plain=Path(self.tmp.name)/'unsafe.tar';encrypted=Path(self.tmp.name)/'unsafe.tlbackup'
        with tarfile.open(plain,'w') as tar:
            for name,body in [('manifest.json',b'{"version":1,"model":"qwen3:4b","jobs":[],"topics":[],"videos":[]}'),('../escape',b'bad')]:
                member=tarfile.TarInfo(name);member.size=len(body);tar.addfile(member,io.BytesIO(body))
        c.encrypt(plain,encrypted,'a-long-test-password')
        with self.assertRaises(ValueError):c.restore(encrypted,'a-long-test-password')
        self.assertFalse((store.ROOT.parent/'escape').exists());self.assertEqual(store.jobs(),[])
    def test_api_auth_shared_knowledge_and_scoping(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
        base='http://127.0.0.1:'+str(server.server_port)
        def post(path,key=''):
            return urllib.request.urlopen(urllib.request.Request(base+path,data=b'{"question":"What are risk limits?"}',headers={'Content-Type':'application/json','Authorization':'Bearer '+key}))
        try:
            with self.assertRaises(urllib.error.HTTPError) as err:post('/v1/chat')
            self.assertEqual(err.exception.code,401)
            k=c.create_key('Site B');id=store.add('Lesson');store.update(id,'ready',lessons='Risk limits apply.')
            with patch('server.ask',return_value='Risk limits apply.') as ask:
                with post('/v1/chat',k['key']) as r:self.assertEqual(json.load(r)['answer'],'Risk limits apply.')
                self.assertIn('Risk limits apply.',ask.call_args.args[0])
            with self.assertRaises(urllib.error.HTTPError) as err:post('/api/transfer',k['key'])
            self.assertEqual(err.exception.code,403)
            c.revoke(k['id'])
            with self.assertRaises(urllib.error.HTTPError) as err:post('/v1/chat',k['key'])
            self.assertEqual(err.exception.code,401)
        finally:server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
