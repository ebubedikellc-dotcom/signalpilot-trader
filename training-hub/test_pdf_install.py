"""Exercise the patched upload routes in an isolated copy, never production."""
import shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
import install_file_lessons,install_question_repair,install_pdf_learning
class InstallationTests(unittest.TestCase):
 def test_install_and_routes(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)
   for f in Path(__file__).parent.glob('*.py'):shutil.copy(f,p/f.name)
   shutil.copy(Path(__file__).with_name('training.html'),p/'training.html')
   install_file_lessons.install(p)
   # Legacy importer tests need its installed endpoint, not unpatched repository server.py.
   subprocess.run([sys.executable,'-m','unittest','test_file_lessons','test_written_lessons'],cwd=p,check=True,capture_output=True)
   install_question_repair.patch(p);install_pdf_learning.install(p)
   subprocess.run([sys.executable,'-m','compileall','-q',str(p)],check=True)
   subprocess.run([sys.executable,'-c',CHECK],cwd=p,check=True)
   html=(p/'training.html').read_text();(p/'panel.js').write_text(html.split('<script>')[1].split('</script>')[0])
   subprocess.run(['node','--check',str(p/'panel.js')],check=True)
   with self.assertRaises(ValueError):install_pdf_learning.install(p)
CHECK='''
import io,tempfile,threading,json,urllib.request
from pathlib import Path
import store,server,file_lessons
from test_pdf_learning import fixture
with tempfile.TemporaryDirectory() as data:
 store.ROOT=Path(data)
 original=store.add('Existing video','https://youtu.be/zzzzzzzzzzz');store.claim()
 http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
 t=threading.Thread(target=http.serve_forever);t.start()
 try:
  url='http://127.0.0.1:'+str(http.server_port)
  req=urllib.request.Request(url+'/api/lessons/file',data=fixture(),headers={'X-Trade-Lord':'1','X-Lesson-Filename':'example.pdf','X-Lesson-Permission':'yes'})
  result=json.load(urllib.request.urlopen(req)); assert result['queued']
  tasks=json.load(urllib.request.urlopen(url+'/api/pdf/'+result['ids'][0]))['tasks'];assert len(tasks)==1
  assert store.get(original)['status']=='working'
  txt=file_lessons.save_upload(io.BytesIO(b'Existing text path'),18,'lesson.txt');assert txt['parts']==1
  assert 'PDF page and link progress' in urllib.request.urlopen(url+'/control-panel/trade-lord').read().decode()
 finally:http.shutdown();http.server_close();t.join()
'''
if __name__=='__main__':unittest.main()
