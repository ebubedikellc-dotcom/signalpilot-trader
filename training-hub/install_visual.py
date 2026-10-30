"""Patch a copy of the deployed worker, refusing unknown versions."""
from pathlib import Path
import sys
root=Path(sys.argv[1]); worker=root/'worker.py'
text=worker.read_text()
if 'from visual_lessons import enrich' in text: raise SystemExit('Visual integration already installed.')
anchor='            try: notes=lessons(transcript, id)'
if text.count(anchor)!=1: raise SystemExit('Unrecognised worker; no files changed.')
text=text.replace(anchor,"            from visual_lessons import enrich\n            try:\n                transcript=enrich(id, store.media(id), transcript)\n                store.update(id,'working','Speech and sampled visual evidence saved; extracting notes.',transcript=transcript)\n            except Exception as exc:\n                store.update(id,'needs_lessons',str(exc)[:250])\n                continue\n            try: notes=lessons(transcript, id)")
text=text.replace('Saved notes available. Speech and sampled text only; full chart/video understanding has not been performed.',
    'Saved notes include speech, screen text and visual samples every 60 seconds. Unsampled events may be missed; interpretations need verification.')
compile(text,str(worker),'exec')
worker.write_text(text)
