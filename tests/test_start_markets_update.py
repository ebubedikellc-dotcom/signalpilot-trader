import hashlib,json,os,pathlib,shutil,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
FILES=['server.js','script.js','control-panel.html','copy-markets.js','copy-markets.css','lib/copy-directory.mjs','deploy/compose.laptop.yaml']
class StartMarketsUpdate(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.source=self.root/'source';self.target=self.root/'target'
  for p in [self.source/'deploy',self.target/'deploy/private-data',self.root/'bin']:p.mkdir(parents=True)
  for n in ['apply-start-markets.py','update-start-markets.sh']:shutil.copy2(ROOT/'deploy'/n,self.source/'deploy'/n)
  manifest={}
  for i,name in enumerate(FILES):
   dst=self.target/name;src=self.source/name;src.parent.mkdir(parents=True,exist_ok=True);src.write_text('new '+name)
   old=None
   if i not in [3,4,5]:dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text('old '+name);old=hashlib.sha256(dst.read_bytes()).hexdigest()
   manifest[name]={'old':[old],'new':hashlib.sha256(src.read_bytes()).hexdigest()}
  (self.source/'deploy/start-markets-manifest.json').write_text(json.dumps(manifest))
  (self.target/'deploy/.laptop.env').write_text('COPYTRADE_PORT=8088\nTRADE_LORD_NETWORK=retained\n')
  (self.target/'deploy/.laptop.private.env').write_text('synthetic-password-retained')
  self.account=json.dumps({'profiles':{'safe':{'running':False}},'settings':{'syntheticKey':'retained','budget':100},'history':[1,2]})
  (self.target/'deploy/private-data/signalpilot-state.json').write_text(self.account)
  docker=self.root/'bin/docker';docker.write_text('''#!/usr/bin/env python3
import os,sys,json
with open(os.environ['DOCKER_CALLS'],'a') as f:f.write(' '.join(sys.argv[1:])+'\\n')
if 'config' in sys.argv:print(json.dumps({'services':{'copytrade':{'environment':{'ENABLE_LIVE_TRADING':'false','EXECUTE_REAL_SWAPS':'false'}}}}))
if 'build' in sys.argv and os.environ.get('TEST_FAIL')=='yes':sys.exit(1)
''');docker.chmod(0o700)
  self.env={**os.environ,'PATH':str(self.root/'bin')+':'+os.environ['PATH'],'COPYTRADE_UPDATE_TARGET':str(self.target),'DOCKER_CALLS':str(self.root/'docker.log')}
 def run_update(self):return subprocess.run(['bash',str(self.source/'deploy/update-start-markets.sh')],env=self.env,text=True,capture_output=True,timeout=10)
 def retained(self):
  self.assertEqual((self.target/'deploy/.laptop.private.env').read_text(),'synthetic-password-retained')
  self.assertEqual((self.target/'deploy/private-data/signalpilot-state.json').read_text(),self.account)
 def test_update_and_repeat_keep_private_data_and_make_start_configurable(self):
  for _ in range(2):
   r=self.run_update();self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.retained()
  env=(self.target/'deploy/.laptop.env').read_text();self.assertIn('TRADE_LORD_NETWORK=retained',env);self.assertEqual(env.count('COPYTRADE_LIVE_TRADING=true'),1)
  log=(self.root/'docker.log').read_text();self.assertLess(log.index(' stop '),log.index(' build '));self.assertIn('up -d --no-build --force-recreate --wait copytrade gateway',log)
 def test_unknown_local_changes_are_not_overwritten(self):
  (self.target/'server.js').write_text('local changes');r=self.run_update();self.assertNotEqual(r.returncode,0);self.assertEqual((self.target/'server.js').read_text(),'local changes');self.retained()
 def test_running_copy_is_not_updated(self):
  self.account=json.dumps({'profiles':{'safe':{'running':True}}});(self.target/'deploy/private-data/signalpilot-state.json').write_text(self.account)
  r=self.run_update();self.assertNotEqual(r.returncode,0);self.assertIn('Stop Trading',r.stderr);self.assertFalse((self.root/'docker.log').exists());self.retained()
 def test_build_failure_restores_code_and_config_and_stays_stopped(self):
  self.env['TEST_FAIL']='yes';r=self.run_update();self.assertNotEqual(r.returncode,0);self.assertEqual((self.target/'server.js').read_text(),'old server.js');self.assertFalse((self.target/'copy-markets.js').exists());self.assertNotIn('COPYTRADE_LIVE_TRADING',(self.target/'deploy/.laptop.env').read_text());self.assertNotIn(' up ',(self.root/'docker.log').read_text());self.retained()
 def test_corrupt_payload_is_rejected(self):
  (self.source/'script.js').write_text('corrupt');self.assertNotEqual(self.run_update().returncode,0);self.assertEqual((self.target/'script.js').read_text(),'old script.js');self.retained()
if __name__=='__main__':unittest.main()
