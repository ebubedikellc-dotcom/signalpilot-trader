// Cached cash never credits unobserved sells. Pending buys remain reserved
// until a fresh balance and journal can be sampled without intervening changes.
export function availableCachedCash(sample, journal) {
  if (!sample || !Number.isFinite(sample.cash) || sample.cash < 0) return 0;
  let debit = 0;
  for (const pending of Object.values(journal.pending || {})) {
    if (pending.wallet !== sample.wallet || pending.side !== 'buy') continue;
    if (!Number.isFinite(pending.reservedUsd) || pending.reservedUsd <= 0) return 0;
    debit += Math.ceil(pending.reservedUsd * 1e6);
  }
  for (const fill of journal.fills || []) {
    if (fill.wallet !== sample.wallet || fill.side !== 'buy' || sample.fillIds.has(fill.txid)) continue;
    if (!Number.isFinite(fill.usd) || fill.usd <= 0) return 0;
    debit += Math.ceil(fill.usd * 1e6);
  }
  return Math.max(0, (Math.floor(sample.cash * 1e6) - debit) / 1e6);
}
