"""Scoped website access and encrypted, portable owner backups.
The public API never exposes management, uploads, secrets or training controls.
"""
import hashlib, hmac, json, os, secrets, shutil, sqlite3, struct, tarfile, tempfile, threading, time, uuid
from pathlib import Path
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
import store
MAX_BACKUP = 21 * 1024**3
MAGIC = b'TLORD01\n'
EXPORT_LOCK = threading.Lock()
API_SLOT = threading.BoundedSemaphore(1)

def db():
    c=store.connect()
    c.execute('CREATE TABLE IF NOT EXISTS website_keys (id TEXT PRIMARY KEY, name TEXT, digest TEXT, created REAL, revoked INTEGER DEFAULT 0)')
    c.execute('CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, status TEXT, detail TEXT, expires REAL)')
    return c

def keys():
    with db() as c:return [dict(r) for r in c.execute('SELECT id,name,created,revoked FROM website_keys ORDER BY created DESC')]

def create_key(name):
    name=str(name).strip()
    if not 1<=len(name)<=80:raise ValueError('Name the website (up to 80 characters).')
    key='tl_'+secrets.token_urlsafe(32);id=str(uuid.uuid4())
    with db() as c:
        if c.execute('SELECT count(*) FROM website_keys WHERE revoked=0').fetchone()[0]>=20:raise ValueError('Revoke an unused key first (20 active keys maximum).')
        c.execute('INSERT INTO website_keys VALUES (?,?,?,?,0)',(id,name,hashlib.sha256(key.encode()).hexdigest(),time.time()))
    return {'id':id,'key':key}

def revoke(id):
    with db() as c:c.execute('UPDATE website_keys SET revoked=1 WHERE id=?',(id,))

def authorized(header):
    if not header.startswith('Bearer ') or len(header)>200:return False
    digest=hashlib.sha256(header[7:].encode()).hexdigest()
    with db() as c:rows=c.execute('SELECT digest FROM website_keys WHERE revoked=0').fetchall()
    return any(hmac.compare_digest(digest,r['digest']) for r in rows)

def transfer_dir():
    p=store.ROOT/'transfers';p.mkdir(mode=0o700,exist_ok=True);return p

def cleanup():
    with db() as c:
        for r in c.execute('SELECT id FROM transfers WHERE expires<?',(time.time(),)):
            (transfer_dir()/(r['id']+'.tlbackup')).unlink(missing_ok=True)
        c.execute("UPDATE transfers SET status='expired',detail='Create a fresh backup link.' WHERE expires<?",(time.time(),))

def transfer(id):
    if not isinstance(id,str) or not __import__('re').fullmatch(r'[a-f0-9-]{36}',id):raise ValueError('Invalid transfer.')
    cleanup()
    with db() as c:r=c.execute('SELECT * FROM transfers WHERE id=?',(id,)).fetchone()
    if not r:raise ValueError('Transfer not found.')
    return dict(r)

def set_transfer(id,status,detail):
    with db() as c:c.execute('UPDATE transfers SET status=?,detail=? WHERE id=?',(status,detail,id))

def derive(password,salt):
    return Scrypt(salt=salt,length=32,n=2**15,r=8,p=1).derive(password.encode())

def encrypt(source,dest,password):
    salt=secrets.token_bytes(16);nonce=secrets.token_bytes(12)
    enc=Cipher(algorithms.AES(derive(password,salt)),modes.GCM(nonce)).encryptor()
    enc.authenticate_additional_data(MAGIC)
    with open(source,'rb') as src,open(dest,'wb') as out:
        os.chmod(dest,0o600);out.write(MAGIC+salt+nonce)
        while chunk:=src.read(1024*1024):out.write(enc.update(chunk))
        out.write(enc.finalize());out.write(enc.tag)

def decrypt(source,dest,password):
    size=Path(source).stat().st_size
    if size<52 or size>MAX_BACKUP:raise ValueError('Invalid backup size.')
    with open(source,'rb') as src,open(dest,'wb') as out:
        os.chmod(dest,0o600)
        if src.read(8)!=MAGIC:raise ValueError('Choose a Trade Lord backup file.')
        salt=src.read(16);nonce=src.read(12);src.seek(-16,2);tag=src.read(16);src.seek(36)
        dec=Cipher(algorithms.AES(derive(password,salt)),modes.GCM(nonce,tag)).decryptor();dec.authenticate_additional_data(MAGIC)
        left=size-52
        while left:
            chunk=src.read(min(left,1024*1024));left-=len(chunk);out.write(dec.update(chunk))
        try:out.write(dec.finalize())
        except Exception:raise ValueError('Incorrect backup password or damaged file.')

def export_work(id,password):
    try:
        # Model files are reinstalled by model name; no trained adapters exist in this version.
        with db() as c:
            jobs=[dict(r) for r in c.execute('SELECT * FROM jobs')]
            topics=[dict(r) for r in c.execute('SELECT * FROM topics')]
        files=[store.ROOT/(j['id']+'.video') for j in jobs if (store.ROOT/(j['id']+'.video')).exists()]
        required=sum(p.stat().st_size for p in files)+sum(len(json.dumps(j).encode()) for j in jobs)+1024**2
        if required>20*1024**3 or shutil.disk_usage(store.ROOT).free<required*2+1024**3:raise ValueError('Not enough free space to create a complete backup.')
        manifest={'version':1,'model':os.getenv('QWEN_MODEL','qwen3:8b-q4_K_M'),'jobs':jobs,'topics':topics,'brain_link':store.brain_link(),'videos':[p.name for p in files]}
        with tempfile.TemporaryDirectory(dir=transfer_dir()) as tmp:
            manifest_file=Path(tmp)/'manifest.json';manifest_file.write_text(json.dumps(manifest));os.chmod(manifest_file,0o600)
            plain=Path(tmp)/'backup.tar'
            with tarfile.open(plain,'w') as tar:
                tar.add(manifest_file,arcname='manifest.json')
                for p in files:tar.add(p,arcname=p.name)
            output=transfer_dir()/(id+'.tlbackup')
            encrypt(plain,output,password)
        set_transfer(id,'ready','Encrypted backup ready. Download within one hour. Keep its password separately.')
    except Exception as e:
        (transfer_dir()/(id+'.tlbackup')).unlink(missing_ok=True)
        set_transfer(id,'failed',str(e) if isinstance(e,ValueError) else 'Backup could not finish; original data is unchanged.')
    finally:EXPORT_LOCK.release()

def start_export():
    cleanup()
    if not EXPORT_LOCK.acquire(blocking=False):raise ValueError('A transfer is already running.')
    try:
        id=str(uuid.uuid4());password=secrets.token_urlsafe(24)
        with db() as c:c.execute('INSERT INTO transfers VALUES (?,?,?,?)',(id,'building','Preparing encrypted backup',time.time()+3600))
        threading.Thread(target=export_work,args=(id,password),daemon=True).start()
        return {'id':id,'password':password}
    except Exception:EXPORT_LOCK.release();raise

def restore(source,password):
    """Restore only into an empty destination. Never overwrite or delete the source."""
    with db() as c:
        if c.execute('SELECT count(*) FROM jobs').fetchone()[0] or c.execute('SELECT count(*) FROM topics').fetchone()[0]:raise ValueError('Import into a new, empty Trade Lord installation to protect existing knowledge.')
    if shutil.disk_usage(store.ROOT).free<Path(source).stat().st_size*2+1024**3:raise ValueError('Not enough free storage to restore this backup.')
    copied=[]
    try:
        with tempfile.TemporaryDirectory(dir=transfer_dir()) as tmp:
            plain=Path(tmp)/'backup.tar';decrypt(source,plain,password)
            with tarfile.open(plain,'r:') as tar:
                members=tar.getmembers()
                if len(members)>1001 or any(not m.isfile() for m in members):raise ValueError('Invalid backup contents.')
                names=[m.name for m in members]
                if len(names)!=len(set(names)) or 'manifest.json' not in names:raise ValueError('Invalid backup manifest.')
                m=tar.getmember('manifest.json')
                if m.size>64*1024**2:raise ValueError('Backup manifest is too large.')
                manifest=json.load(tar.extractfile(m))
                if manifest.get('version')!=1:raise ValueError('Unsupported backup version.')
                if manifest.get('model')!=os.getenv('QWEN_MODEL','qwen3:8b-q4_K_M'):raise ValueError('Install the same Qwen model on the new server before import: '+str(manifest.get('model'))[:80])
                jobs=manifest['jobs'];topics=manifest['topics'];videos=manifest['videos']
                if len(jobs)>1000 or len(topics)>100 or len({j['id'] for j in jobs})!=len(jobs):raise ValueError('Invalid record count.')
                ids=set()
                for j in jobs:
                    if str(uuid.UUID(j['id']))!=j['id']:raise ValueError('Invalid record ID.')
                    ids.add(j['id'])
                    if j['url']:j['url']=store.canonical(j['url'])
                    for field in ('title','transcript','lessons'):
                        if not isinstance(j[field],str):raise ValueError('Invalid lesson record.')
                allowed={id+'.video' for id in ids}
                if not isinstance(videos,list) or not set(videos)<=allowed or set(names)!={'manifest.json',*videos}:raise ValueError('Unexpected backup file.')
                if sum(m.size for m in members)>20*1024**3:raise ValueError('Backup exceeds storage allowance.')
                for name in videos:
                    target=store.ROOT/name
                    if target.exists():raise ValueError('A destination file already exists.')
                    with tar.extractfile(name) as src,target.open('xb') as out:shutil.copyfileobj(src,out,1024*1024)
                    copied.append(target)
                with db() as c:
                    c.execute('BEGIN IMMEDIATE')
                    if c.execute('SELECT count(*) FROM jobs').fetchone()[0] or c.execute('SELECT count(*) FROM topics').fetchone()[0]:raise ValueError('Destination changed. Import cancelled.')
                    for j in jobs:
                        status='ready' if j['lessons'] else 'needs_lessons' if j['transcript'] else 'failed'
                        c.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)',(j['id'],j['title'],j['url'],status,'Imported. Review source; retry unfinished work when ready.',j['created'],time.time(),j['transcript'],j['lessons']))
                    for t in topics:c.execute('INSERT INTO topics VALUES (?,?,?,?,?)',(str(uuid.uuid4()),str(t['topic'])[:200],'imported','Imported history; search is not restarted automatically.',time.time()))
                return {'ok':True,'lessons':sum(bool(j['lessons']) for j in jobs),'sources':len(jobs),'videos':len(videos),'model':manifest['model']}
    except Exception:
        for p in copied:p.unlink(missing_ok=True)
        raise
