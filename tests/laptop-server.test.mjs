import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
test('mounted observation server keeps accounts and blocks paid-provider checks and real starts',async t=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'copytrade-server-test-'));t.after(()=>rm(data,{recursive:true,force:true}));
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const password='test-only-password-no-live-account';
 await writeFile(path.join(data,'signalpilot-state.json'),JSON.stringify({settings:{heliusKey:'test-stored-secret',gmgnApiKey:'test-gmgn-secret',modesConfirmed:'no',frogMax:'17',frogWallet:'preserved-source-wallet',protectedCapStrategyVersion:'decu-50-cap-v1',manualModesVersion:'v1',gmgnRepairReleaseVersion:'v1'},customers:[{id:'test-customer',name:'Synthetic account',email:'test@example.invalid'}],profiles:{safe:{running:false},frog:{running:false},truenest:{running:false}},owner:{email:'test@example.invalid'}}));
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:data,OWNER_EMAIL:'test@example.invalid',OWNER_PASSWORD:'',OWNER_PASSWORD_B64:Buffer.from(password).toString('base64'),APP_BASE_PATH:'/copytrade',COPYTRADE_HOME_URL:'/trade-lord',COPYTRADE_CONNECTION:'public',COPYTRADE_KEYLESS_QUOTES:'true',DISABLE_BACKGROUND_WORKERS:'true',TRADE_LORD_DISABLED:'true',ENABLE_LIVE_TRADING:'false',EXECUTE_REAL_SWAPS:'false',NODE_ENV:'development'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}});
 let logs='';child.stderr.on('data',chunk=>{logs+=chunk;});
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server failed: '+logs);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);timer.unref();})]);
 const base=`http://127.0.0.1:${port}`;
 const page=await fetch(base+'/copytrade/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/\/copytrade\/mount-config.js/);assert.match(html,/Check free connection/);
 assert.equal((await fetch(base+'/api/health')).status,404);
 assert.equal((await fetch(base+'/copytrade/api/health')).status,200);
 assert.equal((await fetch(base+'/copytrade/server.js')).status,403);
 const login=await fetch(base+'/copytrade/api/auth/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.invalid',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,'Content-Type':'application/json'};
 const settings=await fetch(base+'/copytrade/api/settings',{method:'POST',headers,body:'{}'});assert.equal(settings.status,200);
 const body=await settings.json();assert.equal(body.backend.freeConnection,true);assert.equal(body.backend.paidHeliusEnabled,false);assert.equal(body.backend.productionExecution,false);assert.equal(body.customers[0].id,'test-customer');
 assert.equal(body.settings.heliusKey,'test-stored-secret');assert.equal(body.settings.gmgnApiKey,'test-gmgn-secret'); // Owner retains settings, but public mode does not use them.
 assert.equal(body.settings.frogMax,'17');assert.equal(body.settings.frogWallet,'preserved-source-wallet');
 for(const route of ['gmgn/check','owner/helius-check','queue/start']) {
   const response=await fetch(base+'/copytrade/api/'+route,{method:'POST',headers,body:'{}'});assert.equal(response.status,409,route);
 }
 for(const route of ['public/check','simple-speed-test']) {
   const noOwner=await fetch(base+'/copytrade/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noOwner.status,401);
 }
 const switchBack=await fetch(base+'/copytrade/api/settings',{method:'POST',headers,body:'{"copyConnection":"legacy"}'});assert.equal(switchBack.status,409);
});
