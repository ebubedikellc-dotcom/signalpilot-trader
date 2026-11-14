#!/usr/bin/env python3
"""Restore an owner's private SignalPilot data backup. Never transfer funds."""
import datetime
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile

def restore(archive, target):
    target=Path(target).resolve()
    with tempfile.TemporaryDirectory(prefix='copytrade-import-',dir=target.parent) as temporary:
        stage=Path(temporary)/'data';stage.mkdir(mode=0o700)
        with tarfile.open(archive,'r:*') as tar:
            members=tar.getmembers()
            states=[m for m in members if m.isfile() and PurePosixPath(m.name).name=='signalpilot-state.json']
            if len(states)!=1:raise ValueError('Backup must contain exactly one signalpilot-state.json.')
            root=PurePosixPath(states[0].name).parent
            total=0
            for member in members:
                name=PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts:raise ValueError('Unsafe backup path.')
                if not name.is_relative_to(root):continue
                relative=name.relative_to(root)
                if str(relative)=='.':continue
                if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):raise ValueError('Backup contains a link or special file.')
                total+=member.size
                if total>2_000_000_000 or len(members)>20000:raise ValueError('Backup is larger than this importer supports.')
                dest=stage.joinpath(*relative.parts)
                if member.isdir():dest.mkdir(parents=True,exist_ok=True,mode=0o700)
                else:
                    dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                    with tar.extractfile(member) as src, dest.open('wb') as output:shutil.copyfileobj(src,output)
                    dest.chmod(0o600)
        for name in ['signalpilot-state.json','profit-reserves.json','execution-journal.json']:
            file=stage/name
            if not file.is_file():raise ValueError(f'Backup is missing {name}; no data was replaced.')
            value=json.loads(file.read_text())
            if not isinstance(value,dict):raise ValueError(f'{name} is invalid.')
        state_file=stage/'signalpilot-state.json';state=json.loads(state_file.read_text())
        for profile in state.get('profiles',{}).values():profile['running']=False
        state['sessions']={}
        state.setdefault('settings',{})['copyConnection']='public'
        state['settings']['modesConfirmed']='no'
        state['settings']['gmgnRepairReleaseVersion']='v1'
        state['settings']['manualModesVersion']='v1'
        # The imported choices are authoritative. Do not reapply the historical
        # migration that replaced owner-selected wallets and caps with defaults.
        state['settings']['protectedCapStrategyVersion']='decu-50-cap-v1'
        state.setdefault('strategy',{})['paused']=True
        state['strategy']['pauseReason']='Imported account: reconcile holdings and pending orders before starting.'
        state_file.write_text(json.dumps(state))
        backup=None
        if target.exists():
            stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f')
            backup=target.with_name(target.name+'-before-import-'+stamp)
            target.rename(backup)
        try:shutil.move(str(stage),str(target))
        except Exception:
            if backup and not target.exists():backup.rename(target)
            raise
        target.chmod(0o700)
    return backup

if __name__=='__main__':
    os.umask(0o077)
    if len(sys.argv)!=3:raise SystemExit('Usage: python3 deploy/import-backup.py BACKUP.tar.gz TARGET_DIRECTORY')
    try:
        backup=restore(sys.argv[1],sys.argv[2])
        print('Private data restored. Previous local data retained. Trading remains stopped. No funds were transferred.')
    except Exception as error:raise SystemExit(f'Import stopped: {error}')
