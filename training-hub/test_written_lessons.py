import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
import store
import written_lessons
import server

class WrittenLessonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = store.ROOT
        store.ROOT = Path(self.temp.name)

    def tearDown(self):
        store.ROOT = self.previous
        self.temp.cleanup()

    def test_save_during_video_processing_and_retrieve_without_model_on_save(self):
        video = store.add('Video', 'https://youtu.be/abcdefghijk')
        store.claim()
        with patch('server.ask', side_effect=AssertionError('Saving must not call Qwen')):
            saved = written_lessons.save({'title':'My lesson', 'text':'The test word is violet.'})
        self.assertEqual(store.get(video)['status'], 'working')
        self.assertIsNone(store.claim())
        self.assertEqual(store.get(saved['id'])['lessons'], 'The test word is violet.')
        with patch('server.ask', return_value='violet') as ask:
            server.chat_answer({'question':'What is the test word?'})
        self.assertIn('The test word is violet.', ask.call_args.args[0])
        self.assertIn('[Written] My lesson', ask.call_args.args[0])

    def test_duplicate_and_validation(self):
        data = {'title':'Rules', 'text':'Keep my source unchanged.'}
        first = written_lessons.save(data)
        second = written_lessons.save(data)
        self.assertEqual(first['id'], second['id'])
        self.assertTrue(second['duplicate'])
        for text in (' ', 'a'*12001, None):
            with self.assertRaises(ValueError):
                written_lessons.save({'title':'Bad', 'text':text})
        self.assertEqual(len(store.jobs()), 1)

    def test_retrieves_end_of_long_lesson(self):
        row={'title':'Test', 'url':None, 'lessons':'ordinary text '*700 + ' Violet falcons use emerald nests.'}
        results=written_lessons.excerpts([row], 'Where do violet falcons nest?')
        self.assertIn('emerald nests', results[0]['lessons'])
        self.assertLessEqual(sum(len(x['lessons']) for x in results),8000)

    def test_http_route_unicode_and_header_protection(self):
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True)
        thread.start()
        try:
            url=f'http://127.0.0.1:{http.server_port}/api/lessons/text'
            body=json.dumps({'title':'Written test','text':'学'*11000},ensure_ascii=False).encode()
            request=urllib.request.Request(url,data=body,headers={'Content-Type':'application/json','X-Trade-Lord':'1'})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status,201)
                ident=json.load(response)['id']
            self.assertEqual(len(store.get(ident)['lessons']),11000)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(url,data=body))
            self.assertEqual(error.exception.code,403)
        finally:
            http.shutdown()
            http.server_close()
            thread.join()

if __name__=='__main__':
    unittest.main()
