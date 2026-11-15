import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReplayUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / 'update'
        self.target = self.root / 'installed'
        for folder in (self.bundle / 'deploy', self.target / 'deploy/private-data', self.root / 'bin'):
            folder.mkdir(parents=True)
        shutil.copy2(ROOT / 'deploy/update-copytrade-replay.sh', self.bundle / 'deploy')
        manifest = {}
        for name in ('server.js', 'script.js'):
            old, new = ('old ' + name).encode(), ('new ' + name).encode()
            (self.target / name).write_bytes(old)
            (self.bundle / name).write_bytes(new)
            manifest[name] = {'old': hashlib.sha256(old).hexdigest(), 'new': hashlib.sha256(new).hexdigest()}
        (self.bundle / 'deploy/replay-update-manifest.json').write_text(json.dumps(manifest))
        for name in ('.laptop.env', '.laptop.private.env', 'private-data/signalpilot-state.json', 'private-data/execution-journal.json'):
            (self.target / 'deploy' / name).write_text('synthetic retained account fixture')
        docker = self.root / 'bin/docker'
        docker.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['DOCKER_CALLS'],'a') as f:f.write(' '.join(args)+'\\n')
if 'config' in args:
    live=os.environ.get('TEST_LIVE','false')
    print(json.dumps({'services':{'copytrade':{'environment':{'ENABLE_LIVE_TRADING':live,'EXECUTE_REAL_SWAPS':live}}}}))
if 'build' in args and os.environ.get('TEST_BUILD_FAIL')=='yes':sys.exit(1)
''')
        docker.chmod(0o700)
        self.log = self.root / 'docker.log'
        self.env = {**os.environ, 'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'],
                    'COPYTRADE_UPDATE_TARGET': str(self.target), 'DOCKER_CALLS': str(self.log)}

    def run_update(self):
        return subprocess.run(['bash', str(self.bundle / 'deploy/update-copytrade-replay.sh')],
                              env=self.env, text=True, capture_output=True, timeout=10)

    def assert_private_retained(self):
        for file in (self.target / 'deploy').rglob('*'):
            if file.is_file():self.assertEqual(file.read_text(), 'synthetic retained account fixture')

    def test_update_and_repeat_preserve_accounts_and_password(self):
        for _ in range(2):
            result = self.run_update()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('CopyTrade update complete', result.stdout)
            self.assert_private_retained()
        self.assertEqual((self.target / 'server.js').read_text(), 'new server.js')
        self.assertIn('up -d --no-build --force-recreate --wait copytrade gateway', self.log.read_text())
        backups = list((self.target / '.code-updates').glob('*/server.js'))
        self.assertTrue(any(p.read_text() == 'old server.js' for p in backups))

    def test_unrecognized_code_stops_before_changes_or_build(self):
        (self.target / 'script.js').write_text('a different version')
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.target / 'server.js').read_text(), 'old server.js')
        self.assertNotIn('build copytrade', self.log.read_text())
        self.assert_private_retained()

    def test_live_configuration_stops_before_changes(self):
        self.env['TEST_LIVE'] = 'true'
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.target / 'server.js').read_text(), 'old server.js')
        self.assertNotIn('build copytrade', self.log.read_text())
        self.assert_private_retained()

    def test_failed_build_restores_code_without_restart(self):
        self.env['TEST_BUILD_FAIL'] = 'yes'
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.target / 'server.js').read_text(), 'old server.js')
        self.assertEqual((self.target / 'script.js').read_text(), 'old script.js')
        self.assertNotIn(' up ', self.log.read_text())
        self.assert_private_retained()

    def test_corrupt_download_cannot_change_code(self):
        (self.bundle / 'server.js').write_text('corrupt payload')
        self.assertNotEqual(self.run_update().returncode, 0)
        self.assertEqual((self.target / 'server.js').read_text(), 'old server.js')
        self.assert_private_retained()


if __name__ == '__main__':
    unittest.main()
