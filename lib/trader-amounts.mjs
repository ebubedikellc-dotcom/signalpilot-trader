const quotes=new Set(['So11111111111111111111111111111111111111112','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
export function sourceAmountsFromSwap(transaction={}) {
 const swap=transaction.events?.swap;
 if(swap?.tokenInputs?.length!==1 || swap?.tokenOutputs?.length!==1)return null;
 const part=item=>{
  const mint=item.mint || item.rawTokenAmount?.mint, raw=String(item.rawTokenAmount?.tokenAmount || ''),decimals=item.rawTokenAmount?.decimals;
  if(!mint || !/^[1-9]\d*$/.test(raw) || !Number.isInteger(decimals) || decimals<0 || decimals>30)return null;
  return {mint,raw,decimals};
 };
 const paid=part(swap.tokenInputs[0]),received=part(swap.tokenOutputs[0]);
 if(!paid || !received || quotes.has(paid.mint)===quotes.has(received.mint))return null;
 // GMGN's execution adapter can synthesize a quote when a feed omits it.
 // Never present that fallback as the trader's actual payment.
 if(transaction.source==='GMGN') {
  const report=transaction.gmgn || {},quote=quotes.has(paid.mint)?paid:received;
  const amount=Number(report.quote_amount || report.quoteAmount || 0),raw=Math.round(amount*10**quote.decimals);
  if(report.quote_address!==quote.mint || !(amount>0) || !Number.isSafeInteger(raw) || raw<=0)return null;
  quote.raw=String(raw);
 }
 return {side:quotes.has(paid.mint)?'buy':'sell',paid,received,verified:transaction.source==='SOLANA_DIRECT'};
}
