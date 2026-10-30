import json
from unittest.mock import patch
from test_processing import ProcessingTests,Response
class MemoryTests(ProcessingTests):
 def test_request_memory_settings_and_model_preserved(self):
  import model_requests
  with patch('urllib.request.urlopen',return_value=Response({'done':True,'response':'ok'})) as request:
   model_requests.ask('test')
   data=json.loads(request.call_args.args[0].data)
   self.assertEqual(data['keep_alive'],0)
   self.assertEqual(data['options']['num_batch'],128)
   self.assertEqual(data['options']['num_ctx'],4096)
   self.assertEqual(data['model'],'qwen3:8b-q4_K_M')
 def test_resume_only_failed_model_job(self):
  import store,resume_memory_failures
  a=store.add('failed','https://www.youtube.com/watch?v=R4h7fyAU7GA')
  b=store.add('complete','https://www.youtube.com/watch?v=xzUCED09Z_A')
  store.update(a,'needs_lessons','Qwen returned HTTP 500.',transcript='saved source')
  store.update(b,'ready','Complete',transcript='source',lessons='saved notes')
  resume_memory_failures.resume()
  self.assertEqual(store.get(a)['status'],'retry_lessons')
  self.assertEqual(store.get(b)['lessons'],'saved notes')
  self.assertEqual(store.get(b)['status'],'ready')
  self.assertTrue(list(store.ROOT.glob('before-memory-repair-*.sqlite')))
