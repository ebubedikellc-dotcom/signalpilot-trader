import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
import zipfile
import store
import file_lessons
import server

def docx_bytes():
    data=io.BytesIO()
    with zipfile.ZipFile(data,'w') as z:
        z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Before table</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Risk limit 12</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>After table</w:t></w:r></w:p></w:body></w:document>')
    return data.getvalue()

class FileLessonTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=store.ROOT;store.ROOT=Path(self.temp.name)
    def tearDown(self):store.ROOT=self.old;self.temp.cleanup()
    def save(self,data,name='lesson.txt'):
        return file_lessons.save_upload(io.BytesIO(data),len(data),name)
    def test_long_unicode_saved_all_parts_without_model_or_video_interruption(self):
        video=store.add('Video','https://youtu.be/abcdefghijk');store.claim()
        body=('Risk is not a guarantee. 学习\n'*1500).encode()
        with patch('server.ask',side_effect=AssertionError('Must not invoke Qwen')):
            result=self.save(body)
        self.assertGreater(result['parts'],1)
        combined=''.join(store.get(id)['lessons'] for id in result['ids'])
        self.assertEqual(combined.count('Risk is not a guarantee.'),1500)
        self.assertEqual(store.get(video)['status'],'working')
        self.assertIsNone(store.claim())
        self.assertTrue(self.save(body)['duplicate'])
        self.assertEqual(len(store.jobs()),1+result['parts'])
    def test_docx_table_order(self):
        result=self.save(docx_bytes(),'file.docx')
        notes=store.get(result['ids'][0])['lessons']
        self.assertLess(notes.index('Before table'),notes.index('Risk limit 12'))
        self.assertLess(notes.index('Risk limit 12'),notes.index('After table'))
        self.assertTrue(result['warnings'])
    def test_pdf_page_provenance_and_scan_rejection(self):
        from reportlab.pdfgen.canvas import Canvas
        data=io.BytesIO();c=Canvas(data);c.drawString(30,600,'Page one has a risk rule.');c.showPage();c.showPage();c.drawString(30,600,'Page three has an exit rule.');c.save()
        result=self.save(data.getvalue(),'source.pdf')
        notes=''.join(store.get(id)['lessons'] for id in result['ids'])
        self.assertIn('[Page 1;',notes);self.assertIn('[Page 3;',notes)
        self.assertTrue(any('pages 2' in w for w in result['warnings']))
        data=io.BytesIO();c=Canvas(data);c.showPage();c.save()
        with self.assertRaisesRegex(ValueError,'OCR'):self.save(data.getvalue(),'scan.pdf')
    def test_validation_and_atomic_failure(self):
        for data,name in [(b'executable','a.exe'),(b'notpdf','a.pdf'),(b'\x00binary','a.txt'),(b'zip','a.docx'),(b' ','a.txt')]:
            with self.assertRaises(ValueError):self.save(data,name)
        self.assertEqual(store.jobs(),[])
        with self.assertRaises(ValueError):self.save(b'a'*200001)
        self.assertEqual(store.jobs(),[])
        with patch('file_lessons._parse_file',side_effect=__import__('subprocess').TimeoutExpired('x',30)):
            with self.assertRaisesRegex(ValueError,'timed out'):self.save(b'hello')
        self.assertFalse(self.save(b'valid again')['duplicate'])
    def test_http_permission_and_retrieval(self):
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        t=threading.Thread(target=http.serve_forever,daemon=True);t.start()
        url=f'http://127.0.0.1:{http.server_port}/api/lessons/file'
        try:
            headers={'X-Trade-Lord':'1','X-Lesson-Permission':'yes','X-Lesson-Filename':'risk.txt'}
            for h,code in [({},403),({'X-Trade-Lord':'1'},400),({**headers,'Sec-Fetch-Site':'cross-site'},403)]:
                with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(urllib.request.Request(url,data=b'Test',headers=h))
                self.assertEqual(e.exception.code,code)
            with urllib.request.urlopen(urllib.request.Request(url,data=b'File rule: violet means stop.',headers=headers)) as r:
                self.assertEqual(r.status,201);result=json.load(r)
            with patch('server.ask',return_value='stop') as ask:
                server.chat_answer({'question':'What is the violet file rule?'})
            self.assertIn('File rule: violet means stop.',ask.call_args.args[0])
            self.assertIn('[File]',store.get(result['ids'][0])['title'])
        finally:http.shutdown();http.server_close();t.join()

if __name__=='__main__':unittest.main()
