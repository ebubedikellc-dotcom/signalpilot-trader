import http from 'node:http';
import { Transform } from 'node:stream';
import { pathToFileURL } from 'node:url';

// One local origin. The original Python app keeps all of its routes and data.
const bar='<nav id="copytrade-laptop-nav" style="background:#09161f;color:#fff;padding:16px 24px;display:flex;gap:24px;font:600 15px system-ui;position:relative;z-index:9999"><a style="color:#fff;text-decoration:none" href="/trade-lord">TRADE LORD</a><a style="color:#7ef1c6;text-decoration:none" href="/copytrade/">CopyTrade · SignalPilot</a></nav>';
function injectNavigation() {
  let buffer=Buffer.alloc(0),done=false;
  return new Transform({transform(chunk,_encoding,next){
    if(done){this.push(chunk);next();return;}
    buffer=Buffer.concat([buffer,chunk]);
    const text=buffer.toString('utf8'),match=/<body\b[^>]*>/i.exec(text);
    if(match){const end=Buffer.byteLength(text.slice(0,match.index+match[0].length));this.push(buffer.subarray(0,end));this.push(bar);this.push(buffer.subarray(end));done=true;buffer=Buffer.alloc(0);}
    else if(buffer.length>131072){this.push(buffer);done=true;buffer=Buffer.alloc(0);}
    next();
  },flush(next){if(buffer.length)this.push(buffer);next();}});
}
export function createGateway({tradeLord,copyTrade}) {
  const targets=[new URL(tradeLord),new URL(copyTrade)];
  if(targets.some(u=>u.protocol!=='http:'))throw Error('Gateway upstreams must be local HTTP services.');
  return http.createServer((req,res)=>{
    if(req.url==='/_copytrade/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
    const path=new URL(req.url,'http://local').pathname;
    const copy=path==='/copytrade'||path.startsWith('/copytrade/');
    const target=targets[copy?1:0];
    // Keep the browser's Host so same-origin checks remain meaningful.
    const headers={...req.headers,'accept-encoding':'identity'};
    const upstream=http.request({hostname:target.hostname,port:target.port,method:req.method,path:req.url,headers},incoming=>{
      const responseHeaders={...incoming.headers};
      const html=!copy && /text\/html/i.test(responseHeaders['content-type']||'') && !responseHeaders['content-encoding'];
      if(html){delete responseHeaders['content-length'];delete responseHeaders.etag;responseHeaders['cache-control']='no-store';}
      res.writeHead(incoming.statusCode,responseHeaders);
      if(html)incoming.pipe(injectNavigation()).pipe(res);else incoming.pipe(res);
    });
    upstream.setTimeout(120000,()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain'});res.end(copy?'CopyTrade is starting or unavailable.':'Trade Lord is unavailable. Start the existing Trade Lord container.');});
    res.on('close',()=>upstream.destroy());req.pipe(upstream);
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  createGateway({tradeLord:process.env.TRADE_LORD_UPSTREAM,copyTrade:process.env.COPYTRADE_UPSTREAM||'http://copytrade:3000'})
    .listen(Number(process.env.PORT||8088),process.env.HOST||'127.0.0.1');
}
