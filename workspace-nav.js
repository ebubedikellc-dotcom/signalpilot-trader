const nav=document.createElement('nav');nav.className='ws-nav';nav.setAttribute('aria-label','Main workspace');
const brand=document.createElement('a');brand.className='ws-brand';brand.href='/workspace';brand.textContent='TRADE LORD';nav.append(brand);
for(const [label,href] of [['Workspace','/workspace'],['SignalPilot','/control-panel'],['Trade Lord','/trade-lord'],['Calculator','/workspace#calculator'],['Research & Chat','/workspace#conversation']]){
  const a=document.createElement('a');a.href=href;a.textContent=label;
  if((location.pathname==='/'?'/workspace':location.pathname)===href)a.setAttribute('aria-current','page');nav.append(a);
}
document.body.prepend(nav);
