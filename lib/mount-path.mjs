export function createMount(value='',home='') {
  const base=String(value||'').replace(/\/$/,'');
  if(base && !/^\/[a-zA-Z0-9_-]+$/.test(base))throw Error('APP_BASE_PATH must be one path segment.');
  if(home && !/^\/[a-zA-Z0-9_/-]*$/.test(home))throw Error('COPYTRADE_HOME_URL must be a local path.');
  const link=path=>home && ['/trade-lord','/control-panel/trade-lord'].includes(path)?path:base+path;
  return {
    base,
    strip:path=>!base?path:path===base?'/' : path.startsWith(base+'/')?path.slice(base.length):null,
    script:()=>`window.copytradeBase=${JSON.stringify(base)};window.copytradeHome=${JSON.stringify(home)};window.appPath=p=>typeof p==='string'&&p.startsWith('/')&&!p.startsWith('//')?window.copytradeBase+p:p;window.appRoute=p=>window.copytradeBase&&p.startsWith(window.copytradeBase+'/')?p.slice(window.copytradeBase.length):p;`,
    html:html=>html.replace(/(href|src)="(\/(?!\/)[^"]*)"/g,(_,attr,url)=>`${attr}="${link(url)}"`)
      .replace('</head>',`<script src="${base}/mount-config.js"></script></head>`)
  };
}
