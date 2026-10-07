// Compare integer token units at the source fill and the copy quote. This is
// an entry check, not a promise about later prices or a replacement for exits.
export function copyBuyPriceCheck({sourceRaw, sourceUsd, inputRaw, order, maxWorseBps=500}) {
  const blocked=message=>({allowed:false,message:`Buy blocked: ${message}`});
  const positive=value=>typeof value==='string' && /^[0-9]+$/.test(value) && BigInt(value)>0n;
  const usdRaw=Math.floor(Number(sourceUsd)*1e6);
  if(!positive(String(sourceRaw)) || !Number.isSafeInteger(usdRaw) || usdRaw<=0 || !positive(inputRaw))
    return blocked('source entry price cannot be verified');
  if(order.inAmount!==inputRaw || !positive(order.outAmount))return blocked('copy quote amounts cannot be verified');
  const output=BigInt(order.outAmount);
  let minimum;
  if(positive(order.otherAmountThreshold)) {
    minimum=BigInt(order.otherAmountThreshold);
    if(minimum>output)return blocked('copy quote minimum exceeds its output');
  } else {
    const slip=order.slippageBps;
    if(!Number.isInteger(slip) || slip<0 || slip>=10000)return blocked('copy quote slippage cannot be verified');
    minimum=output*BigInt(10000-slip)/10000n;
  }
  if(minimum<=0n)return blocked('copy quote minimum is zero');
  const source=BigInt(String(sourceRaw)), spend=BigInt(inputRaw), usd=BigInt(usdRaw);
  const costRatioNumerator=source*spend*10000n;
  const costRatioDenominator=minimum*usd;
  const worseBps=Number(costRatioNumerator/costRatioDenominator)-10000;
  if(costRatioNumerator>costRatioDenominator*BigInt(10000+maxWorseBps))
    return {...blocked(`copy entry can cost ${(worseBps/100).toFixed(2)}% more than the trader's verified fill; maximum ${(maxWorseBps/100).toFixed(2)}%`),worseBps};
  return {allowed:true,worseBps,minimumOutputRaw:String(minimum),maxWorseBps};
}
