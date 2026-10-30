"""Bounded document text import, independent of the video/model worker."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
import xml.etree.ElementTree as ET

MAX_FILE = 8 * 1024 * 1024
MAX_TEXT = 200000
MAX_PAGES = 100
SLOT = threading.BoundedSemaphore(1)
SUFFIXES = {'.txt', '.md', '.pdf', '.docx'}

def clean_filename(name):
    name = str(name).replace('\\', '/').rsplit('/', 1)[-1]
    name = ''.join(c for c in name if c.isprintable()).strip()[:180]
    if not name or Path(name).suffix.lower() not in SUFFIXES:
        raise ValueError('Choose a PDF, DOCX, TXT or MD file (not DOC or a ZIP archive).')
    return name

def _extract(path, suffix):
    warnings = []
    blocks = []
    if suffix in ('.txt', '.md'):
        raw = path.read_bytes()
        encoding = 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
        try:
            text = raw.decode(encoding)
        except UnicodeError:
            raise ValueError('Save this text file as UTF-8 and upload it again.')
        if '\x00' in text or any(ord(c) < 32 and c not in '\n\r\t\f' for c in text):
            raise ValueError('This does not appear to be a plain text file.')
        blocks = [('Text', text)]
    elif suffix == '.docx':
        ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        try:
            with zipfile.ZipFile(path) as z:
                infos = z.infolist()
                if len(infos) > 2000 or sum(i.file_size for i in infos) > 24*1024*1024:
                    raise ValueError('Word document is too complex; split it into smaller files.')
                if any(i.flag_bits & 1 for i in infos) or any('vbaproject' in i.filename.lower() for i in infos):
                    raise ValueError('Encrypted or macro-enabled Word documents are not supported.')
                data = z.read('word/document.xml')
                if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
                    raise ValueError('Unsupported document XML.')
                root = ET.fromstring(data)
                for number, p in enumerate(root.iter(ns+'p'), 1):
                    parts = []
                    for node in p.iter():
                        if node.tag == ns+'t': parts.append(node.text or '')
                        elif node.tag == ns+'tab': parts.append('\t')
                        elif node.tag in (ns+'br', ns+'cr'): parts.append('\n')
                    text = ''.join(parts).strip()
                    if text: blocks.append((f'Paragraph {number}', text))
        except (zipfile.BadZipFile, KeyError, ET.ParseError):
            raise ValueError('Could not read this DOCX. Export it as text or a text PDF.')
        warnings.append('Word body text and table-cell text only. Images, headers, footers, comments and footnotes are not interpreted; table layout may be lost.')
    else:
        if not path.read_bytes()[:1024].lstrip().startswith(b'%PDF-'):
            raise ValueError('This file is not a readable PDF.')
        target = path.with_suffix('.extracted.txt')
        try:
            result = subprocess.run(['pdftotext', '-enc', 'UTF-8', str(path), str(target)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=22)
        except FileNotFoundError:
            raise ValueError('PDF reader is not installed. Upload TXT or DOCX for now.')
        except subprocess.TimeoutExpired:
            raise ValueError('PDF took too long to read. Split it into smaller files.')
        if result.returncode:
            raise ValueError('Could not extract this PDF. It may be damaged, password protected or restrict extraction; use an authorized text copy.')
        if target.stat().st_size > MAX_TEXT*4:
            raise ValueError('Document is too long; split it into smaller files.')
        pages = target.read_text(encoding='utf-8').split('\f')
        if pages and not pages[-1].strip(): pages.pop()
        if len(pages) > MAX_PAGES:
            raise ValueError('Use PDFs of at most 100 pages; split this file into parts.')
        blank = []
        for number, text in enumerate(pages, 1):
            if text.strip(): blocks.append((f'Page {number}', text.strip()))
            else: blank.append(number)
        warnings.append('PDF text only. Charts, diagrams and images are not visually interpreted; complex layouts may extract incorrectly.')
        if blank:
            warnings.append('No extractable text on pages '+', '.join(map(str, blank))+'. These may be blank or scanned and need OCR; their contents were not imported.')
    if not any(text.strip() for _, text in blocks):
        raise ValueError('No readable text found. Scanned or image-only files need OCR before upload; no lessons saved.')
    if sum(len(t) for _, t in blocks) > MAX_TEXT:
        raise ValueError('Document exceeds 200,000 text characters; split it into smaller files.')
    return {'blocks': blocks, 'warnings': warnings}

def _parse_file(path, suffix):
    # The subprocess sets its own limits before loading the untrusted document.
    result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--extract', str(path), suffix],
                            capture_output=True, timeout=30)
    if result.returncode or len(result.stdout) > 2*1024*1024:
        raise ValueError('Document exceeded reader limits or could not be read. Split it into smaller files.')
    try: data = json.loads(result.stdout)
    except (ValueError, UnicodeError): raise ValueError('Document reader returned no usable text.')
    if 'error' in data: raise ValueError(data['error'])
    return data

def save_upload(stream, size, filename, title=''):
    import store
    filename = clean_filename(filename)
    title = str(title).strip() or Path(filename).stem
    if not 1 <= len(title) <= 140: raise ValueError('Use a lesson title of at most 140 characters.')
    if not 0 < size <= MAX_FILE: raise ValueError('Choose a document no larger than 8 MB.')
    if not SLOT.acquire(blocking=False): raise ValueError('Another document is being read. Please wait for it to finish.')
    try:
        with tempfile.TemporaryDirectory(prefix='trade-lord-document-') as temp:
            path = Path(temp)/('source'+Path(filename).suffix.lower())
            digest = hashlib.sha256()
            with path.open('wb') as f:
                remaining = size
                while remaining:
                    block = stream.read(min(remaining, 65536))
                    if not block: raise ValueError('Upload interrupted; no lessons saved.')
                    f.write(block); digest.update(block); remaining -= len(block)
            try: data = _parse_file(path, path.suffix)
            except subprocess.TimeoutExpired: raise ValueError('Document reader timed out; split the file into smaller parts.')
        # Each bounded lesson repeats its provenance. No silent tail truncation.
        contents = []
        for label, text in data['blocks']:
            text = text.strip()
            start = 0
            while start < len(text):
                end = min(start+9000,len(text))
                if end < len(text):
                    boundary = text.rfind('\n',start+4500,end)
                    if boundary < 0: boundary = text.rfind('. ',start+4500,end)
                    if boundary < 0: boundary = text.rfind(' ',start+4500,end)
                    if boundary >= 0: end = boundary+1
                piece = f'[{label}; character {start+1}]\n'+text[start:end]
                if contents and len(contents[-1])+len(piece)+2 <= 10000:
                    contents[-1] += '\n\n'+piece
                else: contents.append(piece)
                start = end
        fingerprint = digest.hexdigest()
        warnings = data['warnings']
        lessons = [f'Source file: {filename}\nSHA256: {fingerprint}\nPart {i+1} of {len(contents)}. Extracted reference text, not model retraining.\n'+
                   ('Extraction limits: '+' '.join(warnings)+'\n' if warnings else '')+'\n'+body
                   for i, body in enumerate(contents)]
        if store.space()+sum(len(x.encode()) for x in lessons)*4+65536 > store.QUOTA:
            raise ValueError('Storage allowance is full; no lessons saved.')
        ids = [str(uuid.uuid5(uuid.NAMESPACE_URL, 'trade-lord-document-v1:'+fingerprint+':'+str(i))) for i in range(len(lessons))]
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = [db.execute('SELECT id FROM jobs WHERE id=?', (id,)).fetchone() is not None for id in ids]
            if all(existing):
                return {'ids':ids,'parts':len(ids),'duplicate':True,'warnings':warnings}
            if any(existing): raise ValueError('Some parts of this document already exist; no additional parts saved. Review the existing lessons.')
            if db.execute('SELECT count(*) FROM jobs').fetchone()[0]+len(ids)>1000:
                raise ValueError('Source limit reached; no lessons saved.')
            now = time.time()
            detail = f'Document text saved in {len(ids)} part(s). '+('Some content needs review; read extraction limits.' if warnings else 'Available as lesson reference.')
            for i, (id, lesson) in enumerate(zip(ids, lessons)):
                label = f'[File] {title[:110]} - part {i+1}/{len(ids)}'
                db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)', (id,label,None,'ready',detail,now,now,'',lesson))
        return {'ids':ids,'parts':len(ids),'duplicate':False,'warnings':warnings}
    finally:
        SLOT.release()

if __name__ == '__main__':
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (192*1024*1024, 192*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU, (25,25))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2*1024*1024,2*1024*1024))
    try:
        result = _extract(Path(sys.argv[2]), sys.argv[3])
    except Exception as exc:
        result = {'error': str(exc) if isinstance(exc, ValueError) else 'Could not read this document. No lessons saved.'}
    print(json.dumps(result, ensure_ascii=False))
