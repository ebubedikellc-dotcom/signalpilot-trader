import tempfile, threading, time, unittest, fcntl
from pathlib import Path
from unittest.mock import patch
import store, model_gate, question_queue, model_requests
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.old=store.ROOT; store.ROOT=Path(self.tmp.name)
 def tearDown(self): store.ROOT=self.old; self.tmp.cleanup()
 def test_question_waits_without_overlapping(self):
  entered=threading.Event()
  with (store.ROOT/'model-request.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   def question():
    with model_gate.turn(question=True,wait_seconds=2): entered.set()
   t=threading.Thread(target=question);t.start();time.sleep(.15)
   self.assertFalse(entered.is_set());fcntl.flock(lock,fcntl.LOCK_UN);t.join(2)
  self.assertTrue(entered.is_set())
 def test_worker_yields_to_question_and_resumes(self):
  order=[]
  with model_gate.turn(question=True):
   def worker():
    with model_gate.turn(wait_seconds=2): order.append('worker')
   t=threading.Thread(target=worker);t.start();time.sleep(.15);self.assertEqual(order,[])
  t.join(2);self.assertEqual(order,['worker'])
 def test_timeout_releases_priority(self):
  with (store.ROOT/'model-request.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   with self.assertRaisesRegex(ValueError,'Timed out'):
    with model_gate.turn(question=True,wait_seconds=.05): pass
  with model_gate.turn(question=True,wait_seconds=.05): pass
 def test_async_one_submission_actual_result(self):
  release=threading.Event()
  def answer(data): release.wait(2); return 'real model response'
  job=question_queue.submit({'question':'test'},answer)
  self.assertEqual(question_queue.get(job['id'])['status'],'waiting')
  with self.assertRaises(ValueError): question_queue.submit({'question':'duplicate'},answer)
  release.set()
  for _ in range(100):
   if question_queue.get(job['id'])['status']=='ready':break
   time.sleep(.01)
  self.assertEqual(question_queue.get(job['id'])['answer'],'real model response')
 def test_failure_is_not_answer(self):
  def fail(data):raise ValueError('Model timed out')
  job=question_queue.submit({'question':'test'},fail)
  for _ in range(100):
   result=question_queue.get(job['id'])
   if result['status']=='failed':break
   time.sleep(.01)
  self.assertEqual(result['status'],'failed');self.assertNotIn('answer',result)
 def test_unknown_job_is_explicit(self):
  with self.assertRaisesRegex(ValueError,'restarted'):question_queue.get('missing')
if __name__=='__main__':unittest.main()
