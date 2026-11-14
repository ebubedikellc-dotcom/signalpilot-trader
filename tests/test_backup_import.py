import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('backup',Path(__file__).parents[1]/'deploy/import-backup.py')
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)

class BackupTests(unittest.TestCase):
    def pack(self,path,unsafe=False,missing=False):
        state={'settings':{'frogTradeWallet':'same-address','heliusKey':'synthetic-secret','frogMax':'17'},'customers':[{'id':'account'}],'profiles':{'frog':{'running':True}},'sessions':{'old':'session'}}
        files={'signalpilot-state.json':state,'profit-reserves.json':{'same-address':{'lockedUsd':35}},'execution-journal.json':{'pending':{'pending-id':{'txid':'unchanged'}}}}
        if missing:files.pop('execution-journal.json')
        with tarfile.open(path,'w:gz') as tar:
            for name,value in files.items():
                data=json.dumps(value).encode();info=tarfile.TarInfo('./'+name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
            if unsafe:
                info=tarfile.TarInfo('../escape');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
    def test_preserves_account_journal_and_reserves_stops_profiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);archive=root/'backup.tgz';target=root/'data';target.mkdir();(target/'old').write_text('keep')
            self.pack(archive);previous=backup.restore(archive,target)
            state=json.loads((target/'signalpilot-state.json').read_text())
            self.assertEqual(state['settings']['frogTradeWallet'],'same-address');self.assertEqual(state['settings']['frogMax'],'17')
            self.assertEqual(state['settings']['protectedCapStrategyVersion'],'decu-50-cap-v1')
            self.assertEqual(state['customers'][0]['id'],'account');self.assertFalse(state['profiles']['frog']['running']);self.assertEqual(state['sessions'],{})
            self.assertEqual(json.loads((target/'execution-journal.json').read_text())['pending']['pending-id']['txid'],'unchanged')
            self.assertEqual(json.loads((target/'profit-reserves.json').read_text())['same-address']['lockedUsd'],35)
            self.assertEqual((previous/'old').read_text(),'keep')
    def test_unsafe_or_incomplete_backup_keeps_target(self):
        for unsafe,missing in [(True,False),(False,True)]:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);target=root/'data';target.mkdir();(target/'old').write_text('keep');archive=root/'backup.tgz';self.pack(archive,unsafe,missing)
                with self.assertRaises(ValueError):backup.restore(archive,target)
                self.assertEqual((target/'old').read_text(),'keep');self.assertFalse((root/'escape').exists())

if __name__=='__main__':unittest.main()
