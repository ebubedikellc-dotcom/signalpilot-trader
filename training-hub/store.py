"""Durable queue for the standalone, owner-only Trade Lord service."""
import os, re, sqlite3, time, uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs
ROOT = Path(os.getenv('HUB_DATA', '/data'))
MAX_FILE = 100 * 1024 * 1024
QUOTA = 20 * 1024**3

def connect():
    ROOT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(ROOT / 'hub.sqlite', timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, title TEXT, url TEXT UNIQUE, status TEXT, detail TEXT, created REAL, updated REAL, transcript TEXT, lessons TEXT)')
    db.execute("CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, topic TEXT, status TEXT, detail TEXT, created REAL)")
    return db

def canonical(value):
    u = urlparse(value)
    if u.scheme != 'https' or u.username or u.password or u.port:
        raise ValueError('Use a public HTTPS YouTube video link.')
    if u.hostname not in ('youtube.com','www.youtube.com','m.youtube.com','youtu.be'):
        raise ValueError('This first version supports YouTube links. Upload files from other sources.')
    video = u.path.strip('/') if u.hostname == 'youtu.be' else (u.path.split('/')[2] if u.path.startswith('/shorts/') else parse_qs(u.query).get('v',[''])[0])
    if not re.fullmatch(r'[\w-]{11}',video,flags=re.ASCII):
        raise ValueError('Paste one video link, not a playlist or channel.')
    return 'https://www.youtube.com/watch?v=' + video

def add(title, url=None):
    url = canonical(url) if url else None
    with connect() as db:
        if url:
            row = db.execute('SELECT id FROM jobs WHERE url=?',(url,)).fetchone()
            if row: return row['id']
        if db.execute('SELECT count(*) FROM jobs').fetchone()[0] >= 1000:
            raise ValueError('Queue limit reached.')
        id = str(uuid.uuid4()); now = time.time()
        db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)',(id,title[:160] or url or 'Uploaded video',url,'checking' if url else 'needs_upload','Waiting for worker' if url else 'Waiting for file',now,now,'',''))
        return id

def update(id, status, detail='', **fields):
    if set(fields) - {'transcript','lessons'}: raise ValueError('Invalid fields')
    names = ['status','detail','updated'] + list(fields)
    with connect() as db:
        db.execute('UPDATE jobs SET '+','.join(n+'=?' for n in names)+' WHERE id=?',[status,detail[:400],time.time(),*fields.values(),id])

def get(id):
    if not re.fullmatch(r'[a-f0-9-]{36}',id): raise ValueError('Invalid record')
    with connect() as db:
        row = db.execute('SELECT * FROM jobs WHERE id=?',(id,)).fetchone()
    if not row: raise ValueError('Video not found')
    return dict(row)

def jobs():
    with connect() as db:
        return [dict(r) for r in db.execute('SELECT id,title,url,status,detail,created,updated FROM jobs ORDER BY created DESC')]

def claim():
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute("SELECT * FROM jobs WHERE status IN ('checking','queued','retry_lessons') ORDER BY created LIMIT 1").fetchone()
        if not row: return None
        db.execute("UPDATE jobs SET status='working',updated=? WHERE id=?",(time.time(),row['id']))
        return dict(row)

def media(id):
    get(id)
    return ROOT / (id + '.video')

def space():
    return sum(p.stat().st_size for p in ROOT.iterdir() if p.is_file())


def add_topic(topic):
    topic=' '.join(str(topic).split())
    if not 3 <= len(topic) <= 200: raise ValueError('Enter a topic between 3 and 200 characters.')
    with connect() as db:
        prior=db.execute("SELECT id FROM topics WHERE topic=? AND status IN ('waiting','searching')",(topic,)).fetchone()
        if prior: return prior['id']
        if db.execute('SELECT count(*) FROM topics').fetchone()[0]>=100: raise ValueError('Topic limit reached.')
        id=str(uuid.uuid4())
        db.execute('INSERT INTO topics VALUES (?,?,?,?,?)',(id,topic,'waiting','Waiting for the search worker',time.time()))
    return id

def topics():
    with connect() as db: return [dict(r) for r in db.execute('SELECT * FROM topics ORDER BY created DESC')]

def topic_update(id,status,detail):
    with connect() as db: db.execute('UPDATE topics SET status=?,detail=? WHERE id=?',(status,detail[:400],id))

def claim_topic():
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute("SELECT * FROM topics WHERE status='waiting' ORDER BY created LIMIT 1").fetchone()
        if not row:return None
        db.execute("UPDATE topics SET status='searching' WHERE id=?",(row['id'],))
        return dict(row)
