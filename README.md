# SignalPilot Trader

Private trading control panel for Decu Win and Risk Win profiles.

## Direct copy execution

The selected trader and traders with open/pending copied positions receive confirmed
Solana log subscriptions. GMGN remains the recovery feed. Each buy or sell verifies
the source signer's net token balances before an order is built; intermediate swap
route tokens and unsupported/ambiguous transactions cannot authorize a copy.

Set the optional **Alchemy API key** in the owner control panel, or set
`ALCHEMY_API_KEY` on Render, to use Alchemy for both direct alerts and wallet reads.
Without it, direct alerts use public Solana; existing Helius wallet verification
keeps its controlled public fallback. No paid Helius streaming is enabled.
Public endpoints have rate limits and do not guarantee production availability.
Alchemy streams and HTTP reads consume the account's plan allowance.

Read requests share provider pacing and Retry-After limits. Sell checks have
priority over queued buy and dashboard reads. Required balance checks, profit
reserves, pending-order checks, and owner start/stop controls remain enforced.
`POST /api/monitor/observe` is an owner-only 45-second read-only connection test
while trading is stopped; it cannot start trading or submit orders.

Execution records include source block time/slot, receipt time, verification time,
and submission time. Compare matching confirmed source/copy transactions to measure
landing delay. A successful subscription or a test passing is not evidence of a
particular live trading latency or profit.

Validation: `node --test tests/*.test.mjs` and `npm run check`.

## FnZero trial

The owner dashboard offers a read-only FnZero test and an execution selector.
Jupiter remains the default. `/api/fnzero/test` requires owner login, stopped
trading, a valid wallet and token, and a buy amount within the purchase/budget
limits (or a held token for sell tests). Tests are rate-limited to once a minute.
They request a Jupiter route, build an unsigned FnZero transaction, and simulate
it without signing or broadcasting. RPC/API usage still counts toward provider
allowances. Test metrics separate route discovery, preparation and simulation;
none is source-trade-to-copy landing latency.

Initial scope: single direct USDC pool, standard SPL tokens, Raydium CPMM,
Raydium AMM v4, PumpSwap or PumpFun bonding curves. Multihop, split routes,
native SOL settlement and Token-2022 remain on Jupiter. This avoids spending
fee-reserve SOL or introducing unaccounted intermediate tokens. No new gRPC
provider is configured.

When FnZero is selected, only successfully simulated wallet/mint/direction routes
are eligible for one hour, in memory (retest after a restart). Each live order
reads fresh pool state, validates exact input and minimum output, and uses Turnkey
and the existing pending-trade journal. Slippage is 100 bps, compute limit 300,000,
and priority fee at most 10,000 lamports, plus network/ATA rent. Orders expire for
submission after 15 seconds. Read or preparation failures fall back to Jupiter
**before signing**; uncertain submitted transactions never fall back or duplicate.
Existing copy sells and risk exits use the selector; manually reviewed emergency
sales retain their original Jupiter quote. Start/Stop, limits, profit reserves,
position ownership and confirmation-based accounting remain in force.

FnZero can also auto-learn a supported direct route from the real Jupiter route
when the owner has selected FnZero. The first unseen coin may still pay the
Jupiter discovery cost, but the learned wallet/mint/direction stays warm in
memory for subsequent copies and exits. Unsupported routes still fall back to
Jupiter before signing.

The SDK builders are vendored and pinned; see `vendor/fnzero/README.md`.
