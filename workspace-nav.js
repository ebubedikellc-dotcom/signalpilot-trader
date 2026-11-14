const nav=document.createElement('nav');nav.className='ws-nav';nav.setAttribute('aria-label','Main workspace');
const brand=document.createElement('a');brand.className='ws-brand';brand.href=window.copytradeHome || window.appPath('/workspace');brand.textContent='TRADE LORD';nav.append(brand);
const currentPath=window.appRoute(location.pathname);
const current=currentPath==='/'?(window.copytradeBase?'/copytrade':'/workspace'):currentPath==='/control-panel'?'/copytrade':currentPath;
for(const [label,href] of [['Home','/workspace'],['CopyTrade','/copytrade'],['Lessons','/trade-lord'],['Chat','/chat'],['Research','/research'],['Calculator','/calculator'],['WhatsApp','/whatsapp']]){
 const a=document.createElement('a');a.href=window.copytradeHome && (href==='/trade-lord'||href==='/workspace')?window.copytradeHome:window.appPath(window.copytradeBase&&href==='/copytrade'?'/':href);a.textContent=label;if(current===href)a.setAttribute('aria-current','page');nav.append(a);
}
document.body.prepend(nav);
