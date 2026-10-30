import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import store,worker,model_requests
class Response:
 def __init__(self,data):self.data=data
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def read(self):return json.dumps(self.data).encode()
class ProcessingTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.old=store.ROOT;store.ROOT=Path(self.tmp.name);store.connect().close()
 def tearDown(self):store.ROOT=self.old;self.tmp.cleanup()
 def test_reject_truncation(self):
  with patch('urllib.request.urlopen',return_value=Response({'done':True,'done_reason':'length','response':'cut off'})):
   with self.assertRaisesRegex(ValueError,'response limit'):model_requests.ask('test')
 def test_accept_complete(self):
  with patch('urllib.request.urlopen',return_value=Response({'done':True,'done_reason':'stop','response':'complete'})):
   self.assertEqual(model_requests.ask('test'),'complete')
 def test_busy_does_not_call_model(self):
  import fcntl
  with (store.ROOT/'model-request.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   with patch('urllib.request.urlopen') as request:
    with self.assertRaisesRegex(ValueError,'processing a lesson'):model_requests.ask('test')
    request.assert_not_called()
 def test_checkpoint_resume(self):
  with patch.object(worker,'ask',side_effect=['section one',ValueError('timeout')]),patch.object(store,'update'):
   with self.assertRaises(ValueError):worker.lessons('a'*3600,'test-source')
  with patch.object(worker,'ask',return_value='section two') as ask,patch.object(store,'update'):
   result=worker.lessons('a'*3600,'test-source')
   self.assertEqual(ask.call_count,1)
   self.assertIn('section one',result);self.assertIn('section two',result)
if __name__=='__main__':unittest.main()
