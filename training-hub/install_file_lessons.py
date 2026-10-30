"""Add file import to the installed hub, preserving previous repairs."""
from pathlib import Path
import shutil
import sys
import time

FORM = '''<section class="card" id="file-teaching"><h2>Upload a lesson file</h2><p>Upload a PDF, Word document or text file. Its readable text becomes saved lessons while your videos continue processing.</p><form id="lesson-file-form"><label>Lesson title (optional)<input id="lesson-file-title" maxlength="140" placeholder="For example: My trading handbook"></label><label>Choose file<input id="lesson-file" type="file" accept=".pdf,.docx,.txt,.md" required></label><p><small>Up to 8 MB, 100 PDF pages or 200,000 text characters. Long text is split into labeled parts. Scanned pages need OCR first. Charts and images are not interpreted by this uploader. Word headers, footnotes and comments are not included. Only extracted text is saved; keep your original file.</small></p><label><input id="lesson-file-permission" type="checkbox" required> I have permission to use this document.</label><p><button type="submit">Upload and save lessons</button></p></form><p id="lesson-file-status" role="status" aria-live="polite"></p></section>'''

JS = '''$('lesson-file-form').onsubmit=async e=>{
 e.preventDefault();const b=e.submitter,f=$('lesson-file').files[0],status=$('lesson-file-status');
 if(!f)return; if(f.size>8*1024*1024){status.textContent='Choose a file no larger than 8 MB.';return;}
 b.disabled=true;status.textContent='Uploading and reading your document…';
 try{const r=await fetch('/api/lessons/file',{method:'POST',headers:{'X-Trade-Lord':'1','Content-Type':'application/octet-stream','X-Lesson-Filename':encodeURIComponent(f.name),'X-Lesson-Title':encodeURIComponent($('lesson-file-title').value),'X-Lesson-Permission':'yes'},body:f});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Upload failed.');
 status.textContent=(j.duplicate?'This document is already saved. ':j.parts+' lesson part(s) saved. ')+(j.warnings||[]).join(' ');
 $('lesson-file-form').reset();await refresh();
 }catch(err){status.textContent=err.message;}finally{b.disabled=false;}
};
'''

ROUTE = '''            if route=='/api/lessons/file':
                if self.headers.get('X-Lesson-Permission')!='yes':
                    raise ValueError('Confirm permission to use this document.')
                self.connection.settimeout(35)
                from urllib.parse import unquote
                return self.send(201,file_lessons.save_upload(self.rfile,size,
                    unquote(self.headers.get('X-Lesson-Filename','')),
                    unquote(self.headers.get('X-Lesson-Title',''))))
'''

def install(root):
    root = Path(root)
    s = (root/'server.py').read_text()
    h = (root/'training.html').read_text()
    if "route=='/api/lessons/file'" not in s:
        if s.count('import written_lessons\n') != 1 or s.count("            if route=='/api/import':") != 1:
            raise ValueError('Unexpected server version; no changes made.')
        s = s.replace('import written_lessons\n','import written_lessons\nimport file_lessons\n',1)
        s = s.replace("            if route=='/api/import':",ROUTE+"            if route=='/api/import':",1)
    if 'id="lesson-file-form"' not in h:
        marker = '<section class="card" id="written-teaching">'
        js_marker = "$('written-form').onsubmit="
        if h.count(marker)!=1 or h.count(js_marker)!=1:
            raise ValueError('Unexpected control panel version; no changes made.')
        h = h.replace(marker,FORM+'\n'+marker,1)
        h = h.replace(js_marker,JS+js_marker,1)
    compile(s,'server.py','exec')
    stamp=str(time.time_ns())
    for name,content in [('server.py',s),('training.html',h)]:
        p=root/name
        if p.read_text()!=content:
            shutil.copy2(p,str(p)+'.before-file-lessons-'+stamp)
            p.write_text(content)
    print('File lesson source installed.')

if __name__=='__main__':install(sys.argv[1] if len(sys.argv)>1 else Path(__file__).parent)
