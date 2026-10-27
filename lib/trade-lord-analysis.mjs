// Trade Lord only studies public wallet observations. No execution dependencies.
export const QUOTES = Object.freeze({
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT'
});
export const CURRICULUM = [
  { id:'foundation-evidence', title:'Evidence before conviction', category:'Research', body:'Separate observed facts, explanations to test, and missing information. A wallet trade reveals an action, not its private reason. Never turn a few wins into a proven strategy.' },
  { id:'foundation-risk', title:'Capital and position sizing', category:'Risk', body:'A position can lose its entire value. Compare trade size, concentration, liquidity and drawdown. Study losses as carefully as wins. A larger position after a loss does not prove that doubling down works.' },
  { id:'foundation-costs', title:'Fees, slippage and copy delay', category:'Execution', body:'A copied trade can receive a different price. Network costs, venue fees, price impact and delayed entry reduce results. Gross wallet returns are not net copy-trading profits.' },
  { id:'foundation-exits', title:'Entries, adds and exits', category:'Strategy', body:'Study initial entries, repeated buys, partial sells and final exits separately. Match only quantities observed in the same token and quote currency. Unknown earlier inventory makes cost basis incomplete.' },
  { id:'foundation-testing', title:'Test on later observations', category:'Research', body:'Form a hypothesis on earlier observations, freeze it, then evaluate it on later data. Include failures, missing data and costs. A historical replay cannot prove future profitability.' },
  { id:'foundation-context', title:'Market context is required', category:'Market', body:'Liquidity, volume, token age, concentration, volatility and market direction can change a result. If these were not captured at the decision time, mark them unknown; do not invent a reason from the price afterward.' },
  { id:'foundation-access', title:'Permitted sources and honest learning', category:'Research', body:'Use public blockchain observations and knowledge the owner has rights to use. Do not scrape protected accounts, bypass limits or collect private reasoning. This notebook builds an evidence memory; it does not retrain model weights.' }
];
export function median(values) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y), n=a.length;
  return n ? n%2 ? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2 : null;
}
export function observationFromSwap(wallet, transaction, source='existing-feed') {
  const swap=transaction?.events?.swap;
  if(!swap || swap.tokenInputs?.length!==1 || swap.tokenOutputs?.length!==1)return null;
  const input=swap.tokenInputs[0], output=swap.tokenOutputs[0];
  const buy=Boolean(QUOTES[input.mint]), sell=Boolean(QUOTES[output.mint]);
  if(buy===sell)return null;
  const token=buy?output:input, quote=buy?input:output;
  const tokenAmount=Number(token.tokenAmount),quoteAmount=Number(quote.tokenAmount);
  const time=Number(transaction.timestamp)*1000;
  if(!transaction.signature || !Number.isFinite(time) || time<=0 || !Number.isFinite(tokenAmount) || tokenAmount<=0 || !Number.isFinite(quoteAmount) || quoteAmount<=0)return null;
  return {id:`${wallet}:${transaction.signature}`,wallet,signature:String(transaction.signature),time,
    observedAt:transaction.detectedAt || new Date().toISOString(),side:buy?'buy':'sell',
    mint:token.mint,tokenAmount,quoteAmount,quote:QUOTES[quote.mint],source,
    marketContext:null,marketContextStatus:'Not captured',feesIncluded:false};
}
export function analyzeTrader(observations=[], wallet) {
  const rows=observations.filter(r=>r.wallet===wallet).sort((a,b)=>a.time-b.time || a.id.localeCompare(b.id));
  const buys=rows.filter(r=>r.side==='buy'),sells=rows.filter(r=>r.side==='sell');
  const lots=new Map(),matches=[],buyCounts=new Map(),sizes={};
  let unmatched=0;
  for(const row of rows){
    const key=row.mint;
    if(row.side==='buy'){
      buyCounts.set(key,(buyCounts.get(key)||0)+1);
      (sizes[row.quote] ||= []).push(row.quoteAmount);
      const bucket=lots.get(key)||[];bucket.push({...row,remaining:row.tokenAmount});lots.set(key,bucket);
    }else{
      const bucket=lots.get(key)||[],available=bucket.reduce((n,l)=>n+l.remaining,0);
      if(available+Math.max(1e-9,available*1e-8)<row.tokenAmount || bucket.some(l=>l.quote!==row.quote)){
        unmatched++;lots.delete(key);continue;
      }
      let remaining=row.tokenAmount,cost=0,holding=0;const evidence=[];
      for(const lot of bucket){
        const qty=Math.min(remaining,lot.remaining);
        if(qty<=0)continue;
        cost+=lot.quoteAmount*qty/lot.tokenAmount;
        holding+=Math.max(0,row.time-lot.time)*qty/row.tokenAmount;
        lot.remaining-=qty;remaining-=qty;evidence.push(lot.signature);
      }
      lots.set(key,bucket.filter(l=>l.remaining>1e-9));
      if(cost>0)matches.push({time:row.time,mint:key,quote:row.quote,cost,received:row.quoteAmount,
        grossReturnPct:(row.quoteAmount/cost-1)*100,holdingMinutes:holding/60000,
        evidence:[...new Set([...evidence,row.signature])]});
    }
  }
  const total=rows.length;
  return {wallet,observations:total,buys:buys.length,sells:sells.length,tokens:new Set(rows.map(r=>r.mint)).size,
    firstAt:rows[0]?.time||null,lastAt:rows.at(-1)?.time||null,
    sizeByQuote:Object.fromEntries(Object.entries(sizes).map(([unit,v])=>[unit,{count:v.length,median:median(v)}])),
    repeatBuyTokens:[...buyCounts.values()].filter(v=>v>1).length,
    matchedExits:matches.length,unmatchedSells:unmatched,medianHoldMinutes:median(matches.map(m=>m.holdingMinutes)),
    medianGrossReturnPct:median(matches.map(m=>m.grossReturnPct)),matches,
    evidenceLevel:total<20?'Early observations':matches.length<10?'More exits needed':'Patterns to test',
    gaps:['Private trading reasons are unknown.','Market conditions at entry were not captured.','Matched exits cover observed inventory only; fees and prior holdings are excluded.']};
}
export function replayTrader(observations,wallet,costBps=100) {
  const a=analyzeTrader(observations,wallet),matches=a.matches;
  if(matches.length<10)return {available:false,message:'Collect at least 10 matched exits before a chronological holdout replay.',sample:matches.length};
  const split=Math.floor(matches.length*.7),train=matches.slice(0,split),test=matches.slice(split);
  // Deliberately fixed baseline, no search for a flattering rule on the holdout.
  const returns=test.map(m=>((m.received*(1-costBps/10000))/(m.cost*(1+costBps/10000))-1)*100);
  return {available:true,baseline:'Follow the observed buys and sells',trainingExits:train.length,testExits:test.length,
    testFrom:test[0].time,testTo:test.at(-1).time,costBpsPerSide:costBps,
    medianReturnPct:median(returns),positiveExits:returns.filter(v=>v>0).length,
    caveat:'Historical price replay, not executable fills. Assumed cost per side includes fees and slippage; actual copy delay and liquidity are not modeled. This does not train or validate a predictive model.'};
}
const fmt=n=>n===null?'unknown':Number(n.toFixed(3)).toLocaleString('en-US');
export function evidenceAnswer(question,summary,knowledge=[]) {
  const q=question.toLowerCase(),teachers=summary.teachers||[];
  if(/\b(accent|intonation|pronunciation|nigerian|igbo|british|speech|youtube)\b/i.test(q)){
    const notes=knowledge.filter(n=>n.category==='Speech');
    return {text:[`The speech library contains ${summary.speechSources?.length||0} reference links. No videos or audio have been imported, and no speech model has been trained. The microphone uses your browser’s speech service with your saved language preference; device support varies.`,...notes.slice(-5).map(n=>`${n.title}: ${n.body}`)].join('\n\n'),sources:notes.slice(-5).map(n=>({label:n.title,noteId:n.id}))};
  }
  const selected=teachers.filter(t=>q.includes(t.name.toLowerCase()));
  const targets=selected.length?selected:teachers;
  if(/\b(buy now|sell now|start trading|place.*trade|send money|withdraw)\b/.test(q))return {text:'I only observe and analyze. I cannot sign transactions, move funds or start trading. Ask me to study an entry, an exit or a risk instead.',sources:[]};
  const relevant=knowledge.map(n=>({...n,score:question.toLowerCase().split(/\W+/).filter(w=>w.length>3 && `${n.title} ${n.body}`.toLowerCase().includes(w)).length})).filter(n=>n.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
  const blocks=[],sources=[];
  if(/learn|pattern|frog|strategy|trader|monitor|doing|summary|watch|buy|sell|compare|hold|size|profit|loss|risk/.test(q)){
    for(const t of targets){const a=t.analysis;
      if(!a.observations){blocks.push(`${t.name}: no verified swaps are saved yet. ${t.health?.error||'I am waiting for the monitor to collect evidence.'}`);continue;}
      blocks.push(`${t.name}: ${a.buys} buys and ${a.sells} sells across ${a.tokens} tokens. ${a.repeatBuyTokens} tokens had repeated buys. ${a.matchedExits} exits match previously observed purchases. Median observed holding time: ${fmt(a.medianHoldMinutes)} minutes. ${Object.entries(a.sizeByQuote).map(([unit,v])=>`Median buy: ${fmt(v.median)} ${unit} (${v.count} buys).`).join(' ')} ${a.unmatchedSells?`${a.unmatchedSells} sells have an incomplete cost basis.`:''}`);
      sources.push({label:`${t.name} observed trades`,wallet:t.wallet});
    }
    blocks.push('Interpretation: repeated buys can suggest adding to a position, but do not prove why the trader bought. These are observed patterns, not a proven profitable strategy. Market context and later tests are still needed.');
  }
  for(const n of relevant){blocks.push(`${n.title}: ${n.body}`);sources.push({label:n.title,noteId:n.id});}
  if(!blocks.length)blocks.push('I can summarize the traders being watched, compare their buy sizes and holding times, explain trading risks, and find your saved lessons. Try “What have you learned about Frog?” or “Explain slippage.” Open-ended conversation needs a connected language model.');
  return {text:blocks.join('\n\n'),sources};
}
