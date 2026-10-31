"""Patch the installed file-upload endpoint without changing the video worker."""
from pathlib import Path
import ast, sys

def install(root):
    root=Path(root)
    server=(root/'server.py').read_text(); html=(root/'training.html').read_text(); files=(root/'file_lessons.py').read_text()
    if 'import pdf_learning' in server: raise ValueError('PDF learning upgrade already installed; no changes made.')
    if 'import file_lessons' not in server or 'import question_queue' not in server:
        raise ValueError('Install the existing PDF/question repair first.')
    server='import pdf_learning\n'+server
    marker="        if route=='/api/jobs':"
    if server.count(marker)!=1: raise ValueError('Unknown GET route layout.')
    server=server.replace(marker,"        if route.startswith('/api/pdf/'):\n            try: return self.send(200,{'tasks':pdf_learning.status(route.rsplit('/',1)[1])})\n            except ValueError as e: return self.send(404,{'error':str(e)})\n"+marker)
    marker='    filename = clean_filename(filename)'
    if files.count(marker)!=1: raise ValueError('Unknown uploader version.')
    files=files.replace(marker,marker+"\n    if Path(filename).suffix.lower() == '.pdf':\n        from pdf_learning import upload\n        return upload(stream, size, filename, title)")
    start=html.find('<section class="card" id="file-teaching">'); end=html.find('</section>',start)
    if start<0 or end<0: raise ValueError('Missing file upload form.')
    html=html[:start]+FORM+html[end+len('</section>'):]
    marker="(j.duplicate?'This document is already saved. ':j.parts+' lesson part(s) saved. ')"
    if html.count(marker)!=1: raise ValueError('Unknown upload response handler.')
    html=html.replace(marker,"(j.duplicate?'This document is already saved or queued. ':j.queued?'PDF queued for pages and direct links. ':j.parts+' lesson part(s) saved. ')")
    marker="if(job.url){"
    if html.count(marker)!=1: raise ValueError('Unknown source list.')
    html=html.replace(marker,PROGRESS+marker)
    for name,content in [('server.py',server),('file_lessons.py',files)]: ast.parse(content)
    for name,content in [('server.py',server),('file_lessons.py',files),('training.html',html)]: (root/name).write_text(content)

FORM='''<section class="card" id="file-teaching"><h2>Upload a lesson file</h2><p>PDFs: read page text, review each page image and follow direct webpage or YouTube links. Work is queued and progress is saved.</p><form id="lesson-file-form"><label>Lesson title (optional)<input id="lesson-file-title" maxlength="140" placeholder="For example: My trading handbook"></label><label>Choose file<input id="lesson-file" type="file" accept=".pdf,.docx,.txt,.md" required></label><p><small>Up to 8 MB, 100 PDF pages, 200,000 extracted characters and 50 direct links. Original PDFs are retained on this server. Keep your own copy: the existing transfer tool exports saved notes, not PDF originals or PDF task progress. Each page is visually reviewed at limited resolution; small labels, scans and dense charts can be misread. Public HTTPS pages are read as text; YouTube links join the video queue. Other video hosts, nested links, linked PDFs, login-only pages and encrypted PDFs are not processed. URLs existing only inside images are not followed. DOCX, TXT and MD remain text-only imports.</small></p><label><input id="lesson-file-permission" type="checkbox" required> I have permission to process this file and its linked material.</label><p><button type="submit">Upload and process lessons</button></p></form><p id="lesson-file-status" role="status" aria-live="polite"></p></section>'''
PROGRESS="""if(job.status.startsWith('document_')){const d=document.createElement('details'),s=document.createElement('summary'),t=document.createElement('pre');s.textContent='PDF page and link progress';d.append(s,t);d.ontoggle=()=>{if(d.open)api('/api/pdf/'+job.id).then(x=>{t.textContent=x.tasks.map(v=>v.kind+' '+(v.kind==='document'?'PDF':v.value)+' — '+v.status+': '+v.detail).join('\\n')}).catch(e=>t.textContent=e.message)};row.append(d)}"""
if __name__=='__main__': install(sys.argv[1])
