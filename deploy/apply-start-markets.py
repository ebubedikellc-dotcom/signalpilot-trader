"""Update only the listed code files and one laptop configuration flag."""
import hashlib
import json
import pathlib
import shutil
import sys
import tempfile

FILES = {'server.js','script.js','control-panel.html','copy-markets.js','copy-markets.css','trader-sizing.js','lib/copy-directory.mjs','lib/trader-sizing.mjs','deploy/compose.laptop.yaml'}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def check(source, target):
    if source == target:
        raise ValueError('Extract the update in a separate folder. Nothing changed.')
    manifest = json.loads((source/'deploy/start-markets-manifest.json').read_text())
    if set(manifest) != FILES:
        raise ValueError('Unexpected update manifest. Nothing changed.')
    for name, entry in manifest.items():
        src, dst = source/name, target/name
        if any(p.is_symlink() for p in (src,dst,*dst.parents)):
            raise ValueError('Linked code paths are not supported. Nothing changed.')
        if digest(src) != entry['new']:
            raise ValueError('Downloaded file check failed: '+name)
        if digest(dst) not in [*entry['old'],entry['new']]:
            raise ValueError('Installed '+name+' differs. Request a matching update; nothing changed.')
    for name in ('.laptop.env','.laptop.private.env','private-data/signalpilot-state.json'):
        p=target/'deploy'/name
        if not p.is_file() or p.is_symlink():
            raise ValueError('Existing laptop account/configuration not found. Nothing changed.')
    state=json.loads((target/'deploy/private-data/signalpilot-state.json').read_text())
    if any(p.get('running') for p in state.get('profiles',{}).values()):
        raise ValueError('Press Stop Trading in CopyTrade, then run this update again.')
    return manifest

def apply(source, target):
    manifest=check(source,target)
    root=target/'.code-updates';root.mkdir(mode=0o700,exist_ok=True)
    backup=pathlib.Path(tempfile.mkdtemp(prefix='before-start-markets-',dir=root));backup.chmod(0o700)
    existing=[]
    for name in [*manifest,'deploy/.laptop.env']:
        if (target/name).exists():
            (backup/name).parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(target/name,backup/name);existing.append(name)
    (backup/'restore.json').write_text(json.dumps(existing))
    try:
        for name in manifest:
            (target/name).parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source/name,target/name)
        env=target/'deploy/.laptop.env'
        lines=[line for line in env.read_text().splitlines() if not line.startswith('COPYTRADE_LIVE_TRADING=')]
        env.write_text('\n'.join(lines)+'\nCOPYTRADE_LIVE_TRADING=true\n');env.chmod(0o600)
    except BaseException:
        rollback(backup,target)
        raise
    return backup

def rollback(backup,target):
    existing=json.loads((backup/'restore.json').read_text())
    allowed=FILES|{'deploy/.laptop.env'}
    if not set(existing)<=allowed:
        raise ValueError('Invalid rollback list.')
    for name in allowed:
        if name in existing:
            shutil.copy2(backup/name,target/name)
        elif name in FILES:
            (target/name).unlink(missing_ok=True)

if __name__=='__main__':
    try:
        action,source,target=sys.argv[1:]
        source,target=pathlib.Path(source).resolve(),pathlib.Path(target).resolve()
        if action=='check':check(source,target)
        elif action=='apply':print(apply(source,target))
        elif action=='rollback':rollback(source,target)
        else:raise ValueError('Unknown update action.')
    except Exception as error:
        raise SystemExit(str(error))
