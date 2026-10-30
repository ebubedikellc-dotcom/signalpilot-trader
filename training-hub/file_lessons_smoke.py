"""Exercise the installed upload endpoint using an isolated temporary database."""
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import urllib.request


def small_pdf():
    stream = b'BT /F1 12 Tf 50 700 Td (PDF import check: amber means pause.) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
               b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
    data = bytearray(b'%PDF-1.4\n'); offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data)); data.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
    xref = len(data)
    data.extend(b'xref\n0 6\n0000000000 65535 f \n')
    for offset in offsets[1:]: data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(data)


def main():
    with tempfile.TemporaryDirectory(prefix='file-lesson-check-') as temp:
        os.environ['HUB_DATA'] = temp
        import store
        import server
        store.ROOT = Path(temp)
        video = store.add('Unrelated video', 'https://youtu.be/abcdefghijk')
        store.claim()
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{http.server_port}'
        def upload(name, body):
            request = urllib.request.Request(base+'/api/lessons/file', data=body,
                headers={'X-Trade-Lord':'1', 'X-Lesson-Filename':name, 'X-Lesson-Permission':'yes'})
            with urllib.request.urlopen(request, timeout=35) as response:
                assert response.status == 201
                return json.load(response)
        try:
            text = b'Local upload check: violet means stop.'
            result = upload('check.txt', text)
            assert text.decode() in store.get(result['ids'][0])['lessons']
            assert upload('check.txt', text)['duplicate'] is True
            result = upload('check.pdf', small_pdf())
            notes = store.get(result['ids'][0])['lessons']
            assert 'amber means pause' in notes and '[Page 1;' in notes
            assert store.get(video)['status'] == 'working'
            with urllib.request.urlopen(base+'/control-panel/trade-lord') as response:
                assert b'id="lesson-file-form"' in response.read()
            assert len(store.jobs()) == 3
        finally:
            http.shutdown(); http.server_close(); thread.join()
    print('Isolated TXT/PDF upload, saved-text readback and duplicate checks passed.')
    print('No real lesson records changed. This checks importing, not model understanding.')


if __name__ == '__main__': main()
