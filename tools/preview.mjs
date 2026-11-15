// Isolated layout preview. This does not import the server or any trading engine.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {calculateTradingRisk} from '../lib/trading-calculator.mjs';
import {createMount} from '../lib/mount-path.mjs';
const mount=createMount();
const root=fileURLToPath(new URL('../',import.meta.url));
const pages=new Set(['/','/workspace','/chat','/research','/calculator','/whatsapp']);
const assets=new Map([['/trader-sizing.js','text/javascript'],['/workspace.css','text/css'],['/workspace-nav.js','text/javascript'],['/workspace.js','text/javascript'],['/whatsapp.js','text/javascript'],['/copy-markets.css','text/css'],['/copy-markets.js','text/javascript'],['/styles.css','text/css'],['/script.js','text/javascript']]);
const state={chat:{configured:false,model:'Not connected'},research:{configured:false,engine:'Vane'},calculator:{available:true,executionConnected:false},laptopLessons:{connected:false,message:'Laptop lessons not yet connected'},handover:{enabled:false,message:'Automatic morning-to-copy handover is not enabled.'},busy:false,whatsapp:{configured:false}};
const copyState={auth:{role:'owner'},settings:{copyConnection:'public',frogBuyMode:'exact',frogSurviveMax:'10',modesConfirmed:'yes',profitMode:'save'},profiles:{safe:{running:false},frog:{running:false},truenest:{running:false}},strategy:{activeProfile:'safe'},trades:[],activity:[],copyDirectory:{accounts:[],traders:[]},backend:{freeConnection:true,paidHeliusEnabled:false,productionExecution:false,connectionLocked:true,startReadiness:{canStart:false,code:'preview',message:'Design preview — Start is unavailable. No wallet or signer is connected.'}}};
createServer(async(req,res)=>{
 const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(typeof body==='string'?body:JSON.stringify(body));};
 try{
  const p=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&p==='/mount-config.js'){send(200,mount.script(),'text/javascript');return;}
  if(req.method==='GET'&&p==='/api/business'){send(200,{role:'owner',owner:{email:'preview@example.test'},customers:[],deposits:[],withdrawals:[],settings:copyState.settings});return;}
  if(req.method==='GET'&&p==='/api/auth/me'){send(200,{user:{role:'owner',email:'preview@example.test'}});return;}
  if(req.method==='GET'&&p==='/api/workspace/status'){send(200,state);return;}
  if(p==='/api/workspace/calculate'&&req.method==='POST'){
   let raw='';for await(const c of req){raw+=c;if(raw.length>10000)throw Error('Request too large.');}
   send(200,calculateTradingRisk(JSON.parse(raw)));return;
  }
  if(req.method==='GET'&&p==='/api/state'){send(200,copyState);return;}
  if(req.method==='GET'&&p==='/api/status'){send(200,copyState);return;}
  if(req.method==='GET'&&p==='/api/trader-sizing'){
    send(200,{checkedAt:new Date().toISOString(),status:'available',message:'Illustrative amounts only — not the trader’s actual wallet data.',latestBuy:{value:'12',symbol:'USDC',timestamp:Math.floor(Date.now()/1000)-180,signature:''},typical:[{value:'10',symbol:'USDC',count:4}],buyCount:4,transactionsScanned:8,balances:{sol:{value:'1.23',symbol:'SOL'},usdc:{value:'150',symbol:'USDC'}},startingCapital:null});return;
  }
  if(p.startsWith('/api/')){send(503,{error:'Design preview only. No account or external service is connected.'});return;}
  const html=pages.has(p)?'workspace.html':['/copytrade','/copytrade/'].includes(p)?'control-panel.html':null;
  if(html){let content=mount.html(await readFile(join(root,html),'utf8'));content=content.replace(/(<body[^>]*>)/,'$1<div style="padding:8px 20px;background:#fff3cd;color:#594307;font:13px system-ui;text-align:center">Design preview · No accounts connected · Trading and sending are unavailable</div>');send(200,content,'text/html');return;}
  if(assets.has(p)){send(200,await readFile(join(root,p.slice(1)),'utf8'),assets.get(p));return;}
  send(404,'Preview page not available.','text/plain');
 }catch(e){send(400,{error:e.message});}
}).listen(Number((process.argv.includes('--port')?process.argv[process.argv.indexOf('--port')+1]:undefined)||process.env.PORT||3000),(process.argv.includes('--host')?process.argv[process.argv.indexOf('--host')+1]:undefined)||'127.0.0.1',()=>console.log('Isolated TradeLog design preview ready.'));
