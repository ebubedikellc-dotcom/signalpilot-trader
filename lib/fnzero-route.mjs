import { PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { AccountCacheSnapshot, PoolTradeHint } from '../vendor/fnzero/builders.mjs';
import { base58 } from './swap-signature.mjs';

export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PROGRAMS = new Set([
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
]);
const raw = x => { if (!/^[1-9]\d*$/.test(String(x)) || BigInt(x) >= 1n << 64n) throw Error('Invalid exact input amount'); return BigInt(x); };

// No keys or signers enter the SDK. Pool identities are only hints: fresh account
// owners, vaults, mints and fees are validated by the pinned FnZero builders.
export function routeHint(order, query) {
  if (query.inputMint !== USDC && query.outputMint !== USDC) throw Error('FnZero trial requires a USDC endpoint');
  const plan = order.routePlan;
  if (!Array.isArray(plan) || plan.length !== 1) throw Error('FnZero currently supports direct USDC pools; this route needs Jupiter');
  const leg = plan[0], swap = leg.swapInfo;
  if (!swap || (leg.percent !== undefined && leg.percent !== 100) || (leg.bps !== undefined && leg.bps !== 10000) ||
      swap.inputMint !== query.inputMint || swap.outputMint !== query.outputMint || String(order.inAmount) !== String(query.amount)) {
    throw Error('Route does not match the authorized exact input');
  }
  return new PoolTradeHint(new PublicKey(swap.ammKey), new PublicKey(query.inputMint), new PublicKey(query.outputMint));
}

export async function prepareFnzeroOrder({ connection, hint, query, knownKeys = [], discover = false, now = Date.now }) {
  const started = now(), amount = raw(query.amount), payer = new PublicKey(query.taker);
  if (hint.inputMint.toBase58() !== query.inputMint || hint.outputMint.toBase58() !== query.outputMint) throw Error('FnZero route direction mismatch');
  const addresses = new Set([hint.pool.toBase58(), query.inputMint, query.outputMint, CLOCK, ...knownKeys]);
  if (addresses.size > 64) throw Error('FnZero account limit exceeded');
  let prepared, contextSlot, dependencyReads = 0;
  // Discovery is only done by the owner's read-only test. Live execution uses
  // one fresh batch and fails back before signing when dependencies change.
  for (let attempt = 0; attempt < (discover ? 16 : 1); attempt++) {
    if (now() - started > 30000) throw Error('FnZero preparation timed out');
    const keys = [...addresses];
    const batch = await connection.getMultipleAccountsInfoAndContext(keys.map(k => new PublicKey(k)), {commitment:'confirmed'});
    dependencyReads++;
    if (!Number.isSafeInteger(batch.context?.slot) || batch.value?.length !== keys.length) throw Error('Incomplete FnZero account snapshot');
    const accounts = new Map(keys.map((key, i) => [key, {
      owner: batch.value[i]?.owner || PublicKey.default,
      data: batch.value[i]?.data || Buffer.alloc(0), slot: BigInt(batch.context.slot), writeVersion: 0n
    }]));
    if (!PROGRAMS.has(accounts.get(hint.pool.toBase58()).owner.toBase58())) throw Error('This pool is not supported by the FnZero trial');
    for (const mint of [query.inputMint, query.outputMint]) {
      if (accounts.get(mint).owner.toBase58() !== TOKEN) throw Error('This token program needs Jupiter; FnZero trial supports standard SPL tokens');
    }
    const clock = accounts.get(CLOCK).data;
    if (clock.length < 40) throw Error('Current chain clock unavailable');
    const unix = clock.readBigInt64LE(32);
    if (Math.abs(Number(unix) * 1000 - now()) > 60000) throw Error('RPC chain clock is stale');
    const ctx = {slot:BigInt(batch.context.slot),epoch:clock.readBigUInt64LE(16),maximumSlotAge:0n};
    try {
      prepared = new AccountCacheSnapshot(accounts).prepareRoute([hint], ctx, unix, payer, amount, 100);
      contextSlot = batch.context.slot;
      break;
    } catch (error) {
      const missing = /^Missing cached account: ([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(error.message);
      if (!discover || !missing || addresses.has(missing[1]) || addresses.size >= 64) throw error;
      addresses.add(missing[1]);
    }
  }
  if (!prepared) throw Error('FnZero pool needs too many account reads');
  const leg = prepared.legs[0];
  if (prepared.legs.length !== 1 || leg.amountIn !== amount || typeof leg.estimatedNetAmountOut !== 'bigint' || leg.estimatedNetAmountOut <= 0n || prepared.minimumNetAmountOut <= 0n) throw Error('FnZero exact input validation failed');
  const hash = await connection.getLatestBlockhash({commitment:'confirmed', minContextSlot:contextSlot});
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({units:300000}),
    ComputeBudgetProgram.setComputeUnitPrice({microLamports:33333}), // at most 10,000 lamports priority fee
    ...prepared.setupInstructions, ...prepared.swapInstructions
  ];
  const tx = new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:hash.blockhash,instructions}).compileToV0Message());
  if (tx.message.header.numRequiredSignatures !== 1 || !tx.message.staticAccountKeys[0].equals(payer)) throw Error('Unexpected FnZero signer');
  const bytes = tx.serialize();
  if (bytes.length > 1232) throw Error('FnZero transaction too large; Jupiter required');
  return {
    order: {transaction:Buffer.from(bytes).toString('base64'), inAmount:String(amount),
      outAmount:String(leg.estimatedNetAmountOut), otherAmountThreshold:String(prepared.minimumNetAmountOut),
      inputMint:query.inputMint, outputMint:query.outputMint, lastValidBlockHeight:hash.lastValidBlockHeight,
      executionEngine:'fnzero', preparedAt:now(), contextSlot, slippageBps:100,
      requestId:`fnzero:${hint.pool.toBase58()}:${hash.blockhash}:${amount}`},
    knownKeys:[...addresses], preparationMs:now()-started, dependencyReads
  };
}

export function createFnzeroRouter({ now = Date.now } = {}) {
  const tested = new Map();
  let lastTest = null;
  const key = q => `${q.taker}:${q.inputMint}:${q.outputMint}`;
  return {
    status: () => ({ supported:'Tested direct USDC pools (Raydium CPMM, AMM v4, PumpSwap, PumpFun bonding curves); standard SPL tokens',
      testedRoutes:[...tested.values()].filter(v => now()-v.testedAt < 3600000).length, lastTest }),
    async test({connection, order, query}) {
      const started = now();
      try {
        const hint = routeHint(order, query);
        const result = await prepareFnzeroOrder({connection,hint,query,discover:true,now});
        const tx = VersionedTransaction.deserialize(Buffer.from(result.order.transaction,'base64'));
        const simulationStart = now();
        const simulation = await connection.simulateTransaction(tx,{sigVerify:false,commitment:'confirmed',minContextSlot:result.order.contextSlot});
        if (!simulation?.value || simulation.value.err) throw Error(`FnZero simulation failed: ${JSON.stringify(simulation?.value?.err || 'No result')}`);
        if (!(simulation.value.unitsConsumed > 0) || simulation.value.unitsConsumed > 300000) throw Error('FnZero compute limit not verified');
        tested.set(key(query),{hint,knownKeys:result.knownKeys,testedAt:now()});
        if(tested.size>32)tested.delete(tested.keys().next().value);
        lastTest = {ok:true,at:new Date(now()).toISOString(), inputMint:query.inputMint,outputMint:query.outputMint,
          amount:query.amount, preparationMs:result.preparationMs, simulationMs:now()-simulationStart,
          totalMs:now()-started, dependencyReads:result.dependencyReads, unitsConsumed:simulation.value.unitsConsumed,
          submitted:false, message:'Simulation passed. No trade sent. This measures preparation and simulation, not copy-trade execution.'};
      } catch(error) {
        tested.delete(key(query));
        lastTest = {ok:false,at:new Date(now()).toISOString(),submitted:false,totalMs:now()-started,message:error.message};
      }
      return lastTest;
    },
    async learn({connection, order, query}) {
      const started = now();
      const hint = routeHint(order, query);
      const result = await prepareFnzeroOrder({connection,hint,query,discover:true,now});
      tested.set(key(query),{hint,knownKeys:result.knownKeys,testedAt:now()});
      if(tested.size>32)tested.delete(tested.keys().next().value);
      lastTest = {ok:true,at:new Date(now()).toISOString(), inputMint:query.inputMint,outputMint:query.outputMint,
        amount:query.amount, preparationMs:result.preparationMs,totalMs:now()-started,
        dependencyReads:result.dependencyReads, submitted:false,
        message:'Direct route learned automatically from the real Jupiter route. No simulation or trade was sent.'};
      return {...result.order,fnzeroPreparationMs:result.preparationMs,fnzeroAutoLearned:true};
    },
    async prepare({connection,query}) {
      const entry = tested.get(key(query));
      if(!entry || now()-entry.testedAt>=3600000) throw Error('No recent successful FnZero test for this wallet and direction');
      const result = await prepareFnzeroOrder({connection,hint:entry.hint,knownKeys:entry.knownKeys,query,now});
      return {...result.order,fnzeroPreparationMs:result.preparationMs};
    }
  };
}

// Never retry through Jupiter after an uncertain RPC submission. The caller
// persists the signed identity first and reconciles the same transaction on-chain.
export async function submitFnzeroOrder(connection, signedBase64, order, now = Date.now) {
  if (order.executionEngine !== 'fnzero' || !Number.isFinite(order.preparedAt) || now()-order.preparedAt > 15000) throw Error('FnZero order expired; build a new order');
  const wire = Buffer.from(signedBase64,'base64');
  const tx = VersionedTransaction.deserialize(wire);
  const original = VersionedTransaction.deserialize(Buffer.from(order.transaction,'base64'));
  if(!Buffer.from(tx.message.serialize()).equals(Buffer.from(original.message.serialize()))) throw Error('FnZero signed message changed');
  const expected = base58(tx.signatures[0]);
  const signature = await connection.sendRawTransaction(wire,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0,minContextSlot:order.contextSlot});
  if(signature!==expected) throw Error('FnZero RPC signature mismatch; check chain before retrying');
  return {signature, status:'Success', confirmed:false};
}
