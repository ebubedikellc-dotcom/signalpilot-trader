// Protocol identities: pump-fun/pump-public-docs and jup-ag/instruction-parser.
const swapPrograms = new Set([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
]);
const swapInstructions = new Set(['Buy','Sell','BuyV2','SellV2','BuyExactSolInV2','BuyExactQuoteInV2','BuyExactQuoteInV3','BuyExactSolIn','BuyExactQuoteIn','Swap','SwapBaseInput','SwapBaseOutput','Route','RouteV2','SharedAccountsRoute','ExactOutRoute','SharedAccountsExactOutRoute']);
const SOL='So11111111111111111111111111111111111111112';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT='Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const address=value=>String(value?.pubkey ?? value ?? '');

export function canonicalSignalId(value) {
  const id=String(value || '');
  return /^gmgn:[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(id) ? id.slice(5) : id;
}

function hasTrustedSwap(logs=[]) {
  const stack=[];
  for(const log of logs) {
    const enter=/^Program (\w+) invoke \[\d+\]$/.exec(log);
    if(enter){stack.push(enter[1]);continue;}
    const exit=/^Program (\w+) (?:success|failed:.*)$/.exec(log);
    if(exit){if(stack.at(-1)===exit[1])stack.pop();continue;}
    const instruction=/^Program log: Instruction: (\w+)$/.exec(log);
    if(instruction && swapPrograms.has(stack.at(-1)) && swapInstructions.has(instruction[1])) return true;
  }
  return false;
}

// A feed can describe an intermediate hop. Verify the signer's actual net change.
export function verifySourceSignal(tx, wallet, signature, expected, observedAt) {
  const decoded = decodeDirectSwap(tx, wallet, signature, observedAt);
  if (!decoded) throw Object.assign(new Error('Source trade could not be verified as an unambiguous wallet swap; no order sent'), {code:tx?.meta ? 'SOURCE_UNSUPPORTED' : 'SOURCE_UNAVAILABLE'});
  const { tokenInputs: [input], tokenOutputs: [output] } = decoded.events.swap;
  const action = [SOL, USDC, USDT].includes(input.mint) ? 'buy' : 'sell';
  const mint = action === 'buy' ? output.mint : input.mint;
  const expectedMint = expected?.action === 'buy' ? expected.outputMint : expected?.inputMint;
  if (expected?.action !== action || expectedMint !== mint) {
    throw Object.assign(new Error('Source token mismatch: feed signal differs from the trader wallet balance change; no order sent'), {code:'SOURCE_SIGNAL_MISMATCH'});
  }
  return decoded;
}

// Decode only unambiguous confirmed swaps. Unsupported transactions use the existing feeds.
// All amounts stay in integer base units until display/USDC valuation.
export function decodeDirectSwap(tx, wallet, signature, observedAt=new Date().toISOString()) {
  if(!tx?.meta || tx.meta.err || !Number(tx.blockTime) || !hasTrustedSwap(tx.meta.logMessages))return null;
  const keys=tx.transaction?.message?.accountKeys || [];
  const walletIndex=keys.findIndex(k=>address(k)===wallet && k.signer===true);
  if(walletIndex<0)return null;
  const byAccount=new Map();
  for(const [side,balances] of [['pre',tx.meta.preTokenBalances],['post',tx.meta.postTokenBalances]]) {
    for(const balance of balances || []) {
      const item=byAccount.get(balance.accountIndex)||{};item[side]=balance;byAccount.set(balance.accountIndex,item);
    }
  }
  const changes=new Map();const owned=new Set([walletIndex]);
  for(const [index,{pre,post}] of byAccount) {
    if((pre?.owner && post?.owner && pre.owner!==post.owner) || (pre?.mint && post?.mint && pre.mint!==post.mint))return null;
    if((post?.owner || pre?.owner)!==wallet)continue;
    owned.add(index);
    const balance=post||pre, mint=balance.mint,decimals=balance.uiTokenAmount?.decimals;
    if(!mint || !Number.isInteger(decimals))return null;
    const raw=BigInt(post?.uiTokenAmount?.amount || '0')-BigInt(pre?.uiTokenAmount?.amount || '0');
    const previous=changes.get(mint);
    if(previous && previous.decimals!==decimals)return null;
    changes.set(mint,{mint,decimals,raw:(previous?.raw||0n)+raw});
  }
  const base=[...changes.values()].filter(x=>x.raw!==0n && ![SOL,USDC,USDT].includes(x.mint));
  if(base.length!==1)return null;
  const token=base[0];
  let quotes=[...changes.values()].filter(x=>[USDC,USDT].includes(x.mint) && x.raw!==0n);
  if(quotes.length>1)return null;
  if(!quotes.length) {
    // Sum wallet + owned token-account lamports to exclude ATA rent movements and include WSOL.
    let delta=walletIndex===0 ? BigInt(tx.meta.fee || 0) : 0n;
    for(const index of owned) {
      const before=tx.meta.preBalances?.[index],after=tx.meta.postBalances?.[index];
      if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after))return null;
      delta+=BigInt(after)-BigInt(before);
    }
    quotes=[{mint:SOL,decimals:9,raw:delta}];
  }
  const quote=quotes[0];
  if(!quote.raw || (quote.raw>0n)===(token.raw>0n))return null;
  const transfer=x=>({mint:x.mint,tokenAmount:Number(x.raw<0n?-x.raw:x.raw)/(10**x.decimals),
    rawTokenAmount:{tokenAmount:String(x.raw<0n?-x.raw:x.raw),decimals:x.decimals,mint:x.mint}});
  const buy=token.raw>0n,input=transfer(buy?quote:token),output=transfer(buy?token:quote);
  return {signature,timestamp:tx.blockTime,slot:tx.slot,type:'SWAP',source:'SOLANA_DIRECT',detectedAt:observedAt,
    decodedAt:new Date().toISOString(),events:{swap:{tokenInputs:[input],tokenOutputs:[output]}},
    tokenTransfers:[{...input,fromUserAccount:wallet},{...output,toUserAccount:wallet}]};
}
