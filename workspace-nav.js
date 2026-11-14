const nav=document.createElement('nav');nav.className='ws-nav';nav.setAttribute('aria-label','Main workspace');
const brand=document.createElement('a');brand.className='ws-brand';brand.href='/workspace';brand.textContent='TRADELOG';nav.append(brand);
const current=location.pathname==='/'?'/workspace':location.pathname==='/control-panel'?'/copytrade':location.pathname;
for(const [label,href] of [['Home','/workspace'],['CopyTrade','/copytrade'],['Lessons','/trade-lord'],['Chat','/chat'],['Research','/research'],['Calculator','/calculator'],['WhatsApp','/whatsapp']]){
 const a=document.createElement('a');a.href=href;a.textContent=label;if(current===href)a.setAttribute('aria-current','page');nav.append(a);
}
document.body.prepend(nav);
