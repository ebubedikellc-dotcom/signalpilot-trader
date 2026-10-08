// Only bounds dashboard waiting. The shared read continues for the next refresh;
// trade verification and transaction submissions keep their existing checks.
export async function dashboardWalletBalances(read, fallback, timeoutMs = 2000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read).catch(() => fallback),
      new Promise(resolve => {timer=setTimeout(()=>resolve(fallback),timeoutMs);})
    ]);
  } finally { clearTimeout(timer); }
}
