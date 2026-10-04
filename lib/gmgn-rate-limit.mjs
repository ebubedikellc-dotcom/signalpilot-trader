// All official read-only requests share one queue and one provider cooldown.
export function gmgnRetryAt(headers, body, now = Date.now()) {
  let payload = {};
  try { payload = JSON.parse(body); } catch {}
  const times = [];
  for (const value of [headers.get('x-ratelimit-reset'), payload.reset_at, payload.data?.reset_at]) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) times.push(seconds * 1000);
  }
  const retry = headers.get('retry-after');
  if (retry) {
    const seconds = Number(retry);
    times.push(Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retry));
  }
  return Math.max(now, ...times.filter(t => Number.isFinite(t) && t < 8.64e15));
}

export function createGmgnRequestGate({ now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), intervalMs = 1500, load = async () => ({}), save = async () => {} } = {}) {
  intervalMs = Math.max(1500, Number(intervalMs) || 1500);
  let nextRequestAt = 0;
  let blockedUntil = 0;
  let failures = 0;
  let reason = '';
  let status = null;
  let permanent = false;
  const pending = new Map();
  const ready = Promise.resolve().then(load).then(saved => {
    blockedUntil = Number(saved.blockedUntil) || 0;
    failures = Number(saved.failures) || 0;
    reason = String(saved.reason || '');
    status = saved.status || null;
    permanent = saved.permanent === true;
  });
  ready.catch(() => {}); // Hold the failure for callers without an unhandled rejection.
  let tail = Promise.resolve();
  const snapshot = () => ({blockedUntil, failures, reason, status, permanent});
  function blockedError() {
    const message = permanent ? reason : `${reason} Requests paused until ${new Date(blockedUntil).toISOString()}.`;
    return Object.assign(new Error(message), {httpStatus: status, retryAt: blockedUntil, feedPaused: true});
  }
  return {
    snapshot,
    run(key, request) {
      if (pending.has(key)) return pending.get(key);
      const job = tail.then(async () => {
        await ready;
        if (permanent || now() < blockedUntil) throw blockedError();
        const delay = Math.max(0, nextRequestAt - now());
        if (delay) await sleep(delay);
        nextRequestAt = now() + intervalMs;
        try {
          const result = await request();
          if (reason) {
            blockedUntil = 0; failures = 0; reason = ''; status = null;
            await save(snapshot());
          }
          return result;
        } catch (error) {
          status = error.httpStatus || null;
          failures += 1;
          reason = error.message;
          permanent = status === 401 || status === 403;
          const backoff = status === 429 ? Math.min(3600000, 300000 * 2 ** Math.min(failures - 1, 4)) : 30000;
          blockedUntil = Math.max(now() + backoff, Number(error.retryAt) || 0) + 1000;
          await save(snapshot());
          throw blockedError();
        }
      });
      // Keep the queue alive after request failure; a cooldown gates queued work.
      tail = job.catch(() => {});
      const result = job.finally(() => pending.delete(key));
      pending.set(key, result);
      return result;
    }
  };
}
