import io, tempfile, unittest, sys, types
from pathlib import Path
from unittest.mock import patch
import store
import pdf_learning as pdf

def fixture():
    text=b'BT /F1 12 Tf 40 700 Td (Risk lesson. https://example.org/lesson) Tj ET\n0 0 1 RG 40 500 m 250 600 l S'
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length '+str(len(text)).encode()+b' >>\nstream\n'+text+b'\nendstream',
        b'<< /Type /Annot /Subtype /Link /Rect [40 650 200 680] /A << /S /URI /URI (https://www.youtube.com/watch?v=abcdefghijk) >> >>']
    data=bytearray(b'%PDF-1.4\n'); offsets=[]
    for i,obj in enumerate(objects,1):
        offsets.append(len(data));data.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
    xref=len(data);data.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets:data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(data)

class PDFTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.old=store.ROOT; store.ROOT=Path(self.temp.name);store.connect().close()
    def tearDown(self): store.ROOT=self.old;self.temp.cleanup()
    def upload(self):
        data=fixture();return pdf.upload(io.BytesIO(data),len(data),'lesson.pdf')['ids'][0]
    def complete(self,t):
        result=pdf.process(t)
        if result is not None:pdf.update(t['id'],'ready',result)
    def test_pdf_pages_links_duplicate_and_model_input(self):
        parent=self.upload();self.assertTrue(pdf.upload(io.BytesIO(fixture()),len(fixture()),'again.pdf')['duplicate'])
        self.complete(pdf.status(parent)[0]);tasks=pdf.status(parent);self.assertEqual(len(tasks),4)
        self.assertEqual({t['value'] for t in tasks if t['kind']=='link'},{'https://example.org/lesson','https://www.youtube.com/watch?v=abcdefghijk'})
        page=next(t for t in tasks if t['kind']=='page')
        def see(image,prompt):
            self.assertTrue(image.startswith(b'\x89PNG'));self.assertIn('untrusted',prompt)
            return 'Observed: blue rising line. Uncertain: no numerical axis labels.'
        with patch.dict(sys.modules,{'visual_lessons':types.SimpleNamespace(see=see)}):self.complete(page)
        saved=store.get(page['id'])['lessons']
        for value in ('PDF page 1','Risk lesson','blue rising line'):self.assertIn(value,saved)
        before=len(store.jobs());pdf.save_note(page,'duplicate','do not overwrite')
        self.assertEqual(len(store.jobs()),before);self.assertEqual(store.get(page['id'])['lessons'],saved)
    def test_video_waits_reuses_existing_and_blocked_is_incomplete(self):
        parent=self.upload();self.complete(pdf.status(parent)[0]);existing=store.add('Existing','https://youtu.be/abcdefghijk')
        t=next(t for t in pdf.status(parent) if t['kind']=='link' and 'youtube' in t['value']);self.complete(t)
        linked=next(x for x in pdf.status(parent) if x['id']==t['id'])
        self.assertEqual(linked['status'],'linked_video');self.assertEqual(linked['detail'],existing)
        for row in pdf.status(parent):
            if row['id']!=t['id']:pdf.update(row['id'],'ready','fixture')
        pdf.refresh_parent(parent);self.assertEqual(store.get(parent)['status'],'document_working')
        store.update(existing,'needs_upload','blocked');pdf.refresh_parent(parent);self.assertEqual(store.get(parent)['status'],'document_partial')
        store.update(existing,'ready','done',lessons='notes');pdf.refresh_parent(parent);self.assertEqual(store.get(parent)['status'],'document_complete')
    def test_failed_document_is_not_complete(self):
        parent=self.upload();pdf.update(pdf.status(parent)[0]['id'],'failed','Unreadable');pdf.refresh_parent(parent)
        self.assertEqual(store.get(parent)['status'],'document_partial')
    def test_private_addresses_and_credentials_rejected(self):
        for ip in ('127.0.0.1','10.0.0.1','169.254.169.254','::1','192.168.0.1'):
            with patch('socket.getaddrinfo',return_value=[(None,None,None,None,(ip,443))]):
                with self.assertRaises(ValueError):pdf.public_address('https://example.org/')
        for url in ('http://example.org','file:///etc/passwd','https://user:pass@example.org','https://example.org:8443'):
            with self.assertRaises(ValueError):pdf.public_address(url)
    def test_redirect_revalidated_and_scripts_ignored(self):
        class Response:
            status=302
            def getheader(self,name,default=''):return 'https://127.0.0.1/private' if name=='Location' else default
        class Connection:
            def __init__(self,*args):pass
            def request(self,*args,**kwargs):pass
            def getresponse(self):return Response()
            def close(self):pass
        def resolve(host,*args,**kwargs):return [(None,None,None,None,('93.184.216.34' if host=='example.org' else '127.0.0.1',443))]
        with patch('socket.getaddrinfo',side_effect=resolve),patch.object(pdf,'PinnedHTTPS',Connection):
            with self.assertRaises(ValueError):pdf.fetch_page('https://example.org/')
        p=pdf.HTMLText();p.feed('<p>Lesson</p><script>bad()</script><style>hidden</style>');self.assertEqual(''.join(p.text),'Lesson')
    def test_link_chunks_and_no_recursive_fetch(self):
        parent=self.upload();t=dict(id=pdf.key(parent,'link','test'),parent=parent,kind='link',value='https://example.org/lesson')
        content='a'*19000+' https://example.org/nested'
        with patch.object(pdf,'fetch_page',return_value=('https://example.org/final',content)) as fetch:pdf.process(t);fetch.assert_called_once()
        notes=[j for j in store.jobs() if j['status']=='ready'];self.assertEqual(len(notes),3)
        full=''.join(store.get(pdf.key(t['id'],'part',str(i)))['lessons'].split('retraining.\n',1)[1] for i in range(3));self.assertEqual(full,content)
    def test_upload_limits_and_interruptions(self):
        for size,raw in [(0,b''),(pdf.MAX_FILE+1,b''),(50,b'%PDF-'),(4,b'nope')]:
            with self.assertRaises(ValueError):pdf.upload(io.BytesIO(raw),size,'bad.pdf')
        self.assertEqual(store.jobs(),[])
    def test_excess_links_visible(self):
        parent=self.upload()
        with patch.object(pdf,'inspect_pdf',return_value=(1,['https://example.org/'+str(i) for i in range(53)])):self.complete(pdf.status(parent)[0])
        omitted=[x for x in pdf.status(parent) if x['kind']=='omitted'];self.assertEqual(omitted[0]['value'],'3');self.assertEqual(omitted[0]['status'],'failed')

if __name__=='__main__':unittest.main()
