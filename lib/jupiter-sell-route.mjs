import {PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount, ComputeBudgetProgram} from '@solana/web3.js';
import {base58, inspectSwapSignature} from './swap-signature.mjs';

const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const positiveRaw=value=>/^[1-9]\d*$/.test(String(value));
export const gaslessMinimumError=error=>/minimum.*gasless|gasless.*minimum/i.test(String(error?.message || error?.errorMessage || ''));
const instruction=x=>new TransactionInstruction({programId:new PublicKey(x.programId),
  keys:x.accounts.map(a=>({pubkey:new PublicKey(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable})),data:Buffer.from(x.data,'base64')});

// Only an unsigned, rejected sponsored SELL can enter this path. It uses the
// same amount and wallet, pays network fees from SOL and simulates before signing.
export async function prepareWalletPaidSell({connection,query,request,now=Date.now}) {
  if(query.outputMint!==USDC || query.inputMint===USDC || !query.taker || !positiveRaw(query.amount))throw Error('Wallet-paid fallback requires an exact token sale to USDC');
  const build=await request('/swap/v2/build',{...query,slippageBps:100,transactionVersion:'0'});
  if(build.inputMint!==query.inputMint || build.outputMint!==USDC || String(build.inAmount)!==String(query.amount) ||
     !positiveRaw(build.outAmount) || !positiveRaw(build.otherAmountThreshold) || BigInt(build.otherAmountThreshold)>BigInt(build.outAmount) ||
     build.swapMode!=='ExactIn' || Number(build.slippageBps)!==100 ||
     BigInt(build.otherAmountThreshold)<BigInt(build.outAmount)*99n/100n)throw Error('Wallet-paid sale quote does not match the requested amount or 1% slippage limit');
  if(build.transactionVersion!==undefined && String(build.transactionVersion)!=='0')throw Error('Unsupported wallet-paid transaction version');
  const payer=new PublicKey(query.taker), meta=build.blockhashWithMetadata;
  if(!Array.isArray(meta?.blockhash) || meta.blockhash.length!==32 || !meta.blockhash.every(n=>Number.isInteger(n)&&n>=0&&n<=255) ||
     !Number.isSafeInteger(meta.lastValidBlockHeight) || meta.lastValidBlockHeight<=0)throw Error('Wallet-paid sale blockhash unavailable');
  const lookup=Object.entries(build.addressesByLookupTableAddress || {}).map(([key,addresses])=>new AddressLookupTableAccount({key:new PublicKey(key),
    state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,addresses:addresses.map(a=>new PublicKey(a))}}));
  if(build.tipInstruction)throw Error('Unexpected tip in wallet-paid sale');
  const instructions=[...(build.setupInstructions||[]),build.swapInstruction,...(build.cleanupInstruction?[build.cleanupInstruction]:[]),...(build.otherInstructions||[])].map(instruction);
  let quotedPrice=0n;
  for(const encoded of build.computeBudgetInstructions || []) {
    const ix=instruction(encoded);
    if(!ix.programId.equals(ComputeBudgetProgram.programId) || ix.data[0]!==3 || ix.data.length!==9)throw Error('Unexpected sale compute budget instruction');
    quotedPrice=ix.data.readBigUInt64LE(1);
  }
  const compile=(units,price)=>{
    const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:base58(Buffer.from(meta.blockhash)),
      instructions:[ComputeBudgetProgram.setComputeUnitLimit({units}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:price}),...instructions]}).compileToV0Message(lookup));
    if(tx.message.header.numRequiredSignatures!==1 || !tx.message.staticAccountKeys[0].equals(payer))throw Error('Unexpected signer in wallet-paid sale');
    if(tx.serialize().length>1232)throw Error('Wallet-paid sale transaction is too large');
    return tx;
  };
  const simulation=await connection.simulateTransaction(compile(1400000,0n),{sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed'});
  if(simulation.value?.err)throw Error(`Wallet-paid sale simulation failed: ${JSON.stringify(simulation.value.err)}. Check SOL for fees and account rent.`);
  const consumed=simulation.value?.unitsConsumed;
  if(!Number.isSafeInteger(consumed) || consumed<=0 || consumed>1400000)throw Error('Wallet-paid sale compute usage unavailable');
  const units=Math.min(1400000,Math.ceil(consumed*1.2));
  // Same 10,000-lamport priority cap used by the existing direct route.
  const maxPrice=10000n*1000000n/BigInt(units), price=quotedPrice<maxPrice?quotedPrice:maxPrice;
  const tx=compile(units,price);
  const fee=await connection.getFeeForMessage(tx.message,'confirmed');
  const balance=await connection.getBalance(payer,'confirmed');
  if(!Number.isSafeInteger(fee.value) || fee.value<0 || !Number.isSafeInteger(balance) || balance<fee.value)throw Error('Not enough verified SOL for wallet-paid sale fees');
  return {...build,transaction:Buffer.from(tx.serialize()).toString('base64'),executionEngine:'jupiter-rpc',
    signatureFeePayer:query.taker,lastValidBlockHeight:meta.lastValidBlockHeight,preparedAt:now(),contextSlot:simulation.context?.slot,
    networkFeeLamports:fee.value,requestId:`jupiter-rpc:${base58(Buffer.from(meta.blockhash))}:${query.amount}`,
    routeNote:'Wallet-paid sale: gasless minimum avoided; SOL pays network fees (1% slippage limit)'};
}

export async function submitWalletPaidSell(connection,signedBase64,order,now=Date.now) {
  if(order.executionEngine!=='jupiter-rpc' || !Number.isFinite(order.preparedAt) || now()-order.preparedAt>15000)throw Error('Wallet-paid sale expired; build a fresh route');
  const wire=Buffer.from(signedBase64,'base64'), tx=VersionedTransaction.deserialize(wire);
  const original=VersionedTransaction.deserialize(Buffer.from(order.transaction,'base64'));
  const expected=inspectSwapSignature(tx,original,order.signatureFeePayer,order);
  const signature=await connection.sendRawTransaction(wire,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0,
    ...(Number.isSafeInteger(order.contextSlot)?{minContextSlot:order.contextSlot}:{})});
  if(signature!==expected)throw Error('Wallet-paid sale signature mismatch; verify the receipt before retrying');
  return {signature,status:'Success',confirmed:false};
}
