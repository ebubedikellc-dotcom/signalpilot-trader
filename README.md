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
