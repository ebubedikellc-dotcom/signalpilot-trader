export function profitLockFloor(cash, principal, releasedUsd = 0) {
  return Math.max(0, cash - principal - Math.max(0, Number(releasedUsd) || 0));
}

export function releaseProfitReserve(reserve, {amountUsd, requestId, cash, now}) {
  if (typeof amountUsd !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amountUsd) || !(Number(amountUsd) > 0))
    throw new Error('Enter a positive amount with at most two decimal places.');
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
    throw new Error('Refresh the page and review the release again.');
  const prior = (reserve?.releases || []).find(r => r.requestId === requestId);
  if (prior) {
    if (prior.amountUsd !== Number(amountUsd)) throw new Error('This release request was already used for another amount.');
    return {reserve, duplicate:true};
  }
  const locked = Number(reserve?.lockedUsd);
  if (!Number.isFinite(cash) || cash < 0 || !Number.isFinite(locked) || locked < 0)
    throw new Error('Cannot verify the locked profit and wallet cash.');
  const amount = Number(amountUsd);
  if (amount > locked || amount > cash) throw new Error('Release exceeds the locked profit or current USDC cash.');
  const remaining = Math.round((locked - amount) * 1e6) / 1e6;
  return {duplicate:false, reserve:{...reserve, lockedUsd:remaining,
    releasedUsd:Math.round(((Number(reserve.releasedUsd) || 0) + amount) * 1e6) / 1e6,
    updatedAt:now, releases:[...(reserve.releases || []), {requestId,amountUsd:amount,time:now}],
    history:[...(reserve.history || []), {time:now,released:amount,total:remaining}]}};
}
