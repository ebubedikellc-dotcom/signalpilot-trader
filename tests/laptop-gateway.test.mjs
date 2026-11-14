import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {createGateway} from '../tools/laptop-gateway.mjs';
import {createMount} from '../lib/mount-path.mjs';
async function serve(t,server){await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}
test('mount keeps CopyTrade APIs separate and rejects lookalike prefixes',()=>{
 const m=createMount('/copytrade','/trade-lord');assert.equal(m.strip('/copytrade/api/status'),'/api/status');assert.equal(m.strip('/copytrade-other/api/status'),null);
 const html=m.html('<head><link href="/styles.css"></head><a href="/trade-lord">Lessons</a>');assert.match(html,/\/copytrade\/styles.css/);assert.match(html,/href="\/trade-lord"/);
 const c={window:{}};vm.runInNewContext(m.script(),c);assert.equal(c.window.appPath('/api/status'),'/copytrade/api/status');assert.equal(c.window.appPath('https://outside.test'),'https://outside.test');
 assert.throws(()=>createMount('/x?evil'));assert.throws(()=>createMount('/copytrade','https://outside.test'));
});
test('gateway preserves Python routes, uploads, cookies and adds CopyTrade navigation',async t=>{
 const paths=[];
 const python=await serve(t,http.createServer((req,res)=>{paths.push(req.url);res.setHeader('Set-Cookie','python=ok; HttpOnly');if(req.method==='POST'){req.pipe(res);return;}res.setHeader('Content-Type','text/html');res.end('<html><head><title>Lessons</title></head><body><p>Saved lessons</p></body></html>');}));
 const copy=await serve(t,http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,host:req.headers.host}));}));
 const gateway=await serve(t,createGateway({tradeLord:python,copyTrade:copy}));
 const page=await fetch(gateway+'/trade-lord');assert.match(page.headers.get('set-cookie'),/python=ok/);assert.match(await page.text(),/CopyTrade · SignalPilot/);
 assert.equal(await (await fetch(gateway+'/api/upload',{method:'POST',body:'pdf bytes'})).text(),'pdf bytes');
 const result=await (await fetch(gateway+'/copytrade/api/status')).json();assert.equal(result.path,'/copytrade/api/status');assert.equal(result.host,new URL(gateway).host);
 await fetch(gateway+'/copytrade-other');assert(paths.includes('/copytrade-other'));
});
