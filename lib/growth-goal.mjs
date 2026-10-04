import { buildPositions } from './position-accounting.mjs';

const micros = value => Math.round(Number(value) * 1e6);
export function validateGrowthSettings(mode, principal, target) {
  if (!['save', 'target'].includes(mode)) throw new Error('Choose Save profits or Grow to target.');
  if (mode === 'save') return;
  if (![principal, target].every(n => Number.isFinite(Number(n)) && Number(n) > 0 && Number(n) <= 1e9)) {
    throw new Error('Enter positive starting and target amounts.');
  }
  if (micros(target) <= micros(principal)) throw new Error('The target must be greater than the starting amount.');
}

// The campaign owns only its tagged fills, never the whole wallet or deposits.
// Pending amounts reserve cash before submission; unpriced costs block new buys.
export function growthSnapshot(journal) {
  const goal = journal.growthGoal;
  if (!goal) return null;
  const fills = journal.fills.filter(f => f.goalId === goal.id && f.wallet === goal.wallet);
  const charges = (journal.charges || []).filter(f => f.goalId === goal.id && f.wallet === goal.wallet);
  const pending = Object.values(journal.pending).filter(p => p.goalId === goal.id);
  const report = buildPositions(fills);
  const positions = Object.values(report.positions).filter(p => BigInt(p.raw) > 0n);
  const priced = [...fills, ...charges].every(f => Number.isFinite(f.feeUsd) && f.feeUsd >= 0);
  const verified = Object.values(report.positions).every(p => p.verified);
  const fees = [...fills, ...charges].reduce((n,f) => n + (Number.isFinite(f.feeUsd) ? micros(f.feeUsd) : 0), 0);
  const cash = micros(goal.principal) + fills.reduce((n,f) => n + (f.side === 'buy' ? -1 : 1) * micros(f.usd), 0);
  const pendingBuys = pending.filter(p => p.side === 'buy');
  const reservationsKnown = pendingBuys.every(p => Number.isFinite(p.reservedUsd) && p.reservedUsd > 0);
  const reserved = pendingBuys.reduce((n,p) => n + micros(p.reservedUsd || 0), 0);
  const netCash = (cash - fees) / 1e6;
  const valid = priced && verified && reservationsKnown;
  const targetReached = valid && !positions.length && !pending.length && micros(netCash) >= micros(goal.target);
  return {
    ...goal, positions, pendingCount: pending.length,
    cashUsd: cash / 1e6, feesUsd: fees / 1e6, costsPriced: priced, verified,
    netCashUsd: priced ? netCash : null,
    openCostUsd: positions.reduce((n,p) => n + p.cost, 0),
    realizedProfitUsd: priced ? report.closed.reduce((n,f) => n + f.pnl, 0) - fees / 1e6 : null,
    availableUsd: goal.status === 'active' && valid && netCash < goal.target && !pending.some(p => p.side === 'sell')
      ? Math.max(0, (cash - fees - reserved) / 1e6) : 0,
    targetReached,
    canChange: !positions.length && !pending.length && verified && priced
  };
}

export function growthTradeable(snapshot, walletCash, locked) {
  if (!snapshot || snapshot.status !== 'active' || !Number.isFinite(walletCash) || !Number.isFinite(locked)) return 0;
  return Math.max(0, Math.min(snapshot.availableUsd, walletCash - Math.max(locked, snapshot.excludedCash)));
}

export function growthTransition(snapshot, estimatedSaleUsd) {
  if (!snapshot || snapshot.status === 'completed') return snapshot?.status;
  if (snapshot.targetReached) return 'completed';
  if (snapshot.status === 'closing') {
    // Slippage or fees can leave the final cash below target: continue compounding.
    return snapshot.canChange ? 'active' : 'closing';
  }
  if (snapshot.costsPriced && snapshot.verified && !snapshot.pendingCount && snapshot.positions.length &&
      Number.isFinite(estimatedSaleUsd) && snapshot.netCashUsd + estimatedSaleUsd >= snapshot.target) return 'closing';
  return 'active';
}
