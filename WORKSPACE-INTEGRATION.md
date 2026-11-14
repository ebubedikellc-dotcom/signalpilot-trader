# Trade Lord + SignalPilot workspace — staged integration

This branch adds one owner workspace at `/workspace` (also `/`) and shared navigation on SignalPilot, the existing server's Trade Lord page and its training page. SignalPilot remains at `/control-panel`. The copy engine, provider selection, signing, profit reserves, position journal, and funding rules are not replaced.

## Implemented here

- Owner workspace with links to existing SignalPilot and server-side Trade Lord pages.
- Exact decimal scenario calculator and input checker: existing and added units, long/short stop direction, point value, unit increments, fixed and per-unit exit costs, maximum additional quantity and budget comparison. It uses integer arithmetic scaled to eight decimal places and rounds displayed risk upward.
- Separate owner-only normal-chat and Vane web-research endpoints. Normal chat sends only recent conversation; research returns HTTP(S) source links. Neither receives a trading executor, signing material or messaging tools.
- One active workspace AI request at a time, bounded inputs, outputs and timeout. This is not a global lock across the separate laptop PDF/video/question workers; that requires their current source.
- Configuration status reports missing services honestly. Configured is not a health check.
- Password-based owner login. Set `OWNER_PASSWORD` privately before deploying, using 16–256 characters. Existing email-only owner sessions are rejected; password changes invalidate owner sessions. Customer session formats are preserved, with server-side expiry now checked. Five failed password attempts in a minute block more attempts in that window.
- Same-origin mutation checks and a static-file allowlist. The application's program files and data directories are not downloadable through the static handler.
- Optional, isolated Vane Docker Compose definition pinned to source commit `348feca3e378fb4157b217724ed508dc707f853f`.

## What is not connected or claimed

The Python Trade Lord running on the owner's laptop is a different implementation from the Node Trade Lord in this repository. Its current source, lesson database, PDFs and container mounts have not been migrated. Do not replace or point its data volume at this application.

The calculator is an owner scenario tool, not yet a universal pre-order gate. SignalPilot retains its existing execution checks. The new formula is only for a linear, same-instrument current-price-to-stop scenario with supplied costs; it does not model portfolio correlation, options, liquidation, price gaps, changing exchange fees or nonlinear contracts. It cannot guarantee a stop fill or actual maximum loss. Wiring laptop natural-language questions into this calculator requires verifying how that service extracts inputs and handles missing values.

The scheduled morning-to-copy handover is not enabled. It needs authoritative account state, ongoing exit management, one shared risk ledger, protection against duplicate starts, and tests for pending or uncertain transactions. One dashboard alone does not implement those controls.

No production balances, stored account records, credentials, wallets or orders were accessed or changed while preparing this branch. Render deployment metadata was inspected read-only; environment values remained hidden. No actual research service, model speed or live copy latency was benchmarked here. The local tests use mocked AI services and an isolated server with no trading credentials.

## Deployment review and validation — 14 November 2026

Render shows `signalpilot-trader` on the Starter plan in Oregon, linked to this repository's `main` branch. The last successfully deployed commit is `442dc5c4b20f109d37717447f39885cbad44fc1e`, matching this branch's base. Auto-deploy is disabled. A 1 GB persistent disk is mounted at `/var/data`. The build command is `npm install --omit=dev` and the start command is `npm start`.

The environment key list includes `DATA_DIR`, `ENABLE_LIVE_TRADING`, `EXECUTE_REAL_SWAPS`, `GMGN_API_KEY` and `NODE_ENV`; values were not revealed. There is no visible `OWNER_PASSWORD`, Ollama or Vane setting in that list. Configure owner authentication before deploying this branch; do not deploy an owner-login change without providing the owner a working sign-in path. The disk's contents and restore procedure have not been verified.

Validation: all 307 Node tests passed. An isolated full-server HTTP smoke check passed owner login/logout, the 11-versus-10 calculation regression, navigation asset delivery, owner-only access, source-file protection, cross-origin rejection and missing-service errors. Automated browser rendering could not run because Chromium's required local socket was denied by this execution environment; desktop/mobile visual verification remains outstanding.

## Existing copy-speed components to retain

- `lib/direct-signals.mjs`: direct Solana notifications and source-swap verification.
- `lib/rpc-read-pool.mjs`: paced, coalesced RPC reads and priority for urgent trading work.
- `lib/monitor-sleep.mjs`: event-driven wakeups.
- `lib/fnzero-route.mjs` and pinned `vendor/fnzero`: supported direct route preparation, with Jupiter fallback before signing.
- `lib/trading-journal.mjs`: pending-order recovery and confirmation-based records.
- Existing owner speed test and observation endpoints: read-only measurement, not proof of 500 ms copied fills.

Installing another copy engine is not needed for these features. Next speed work should measure source receipt, source verification, route preparation, signing, submission and confirmation separately. Provider limits and the network still affect time. Do not bypass balance checks or pending-order deduplication to improve a displayed number.

## Staging deployment

1. Use a separate staging instance/data directory, no production credentials, `ENABLE_LIVE_TRADING=false`, `EXECUTE_REAL_SWAPS=false`, `DISABLE_BACKGROUND_WORKERS=true`, and `TRADE_LORD_DISABLED=true`. Set a unique `OWNER_PASSWORD`. Configure variables through the host; the Node application does not automatically load `.env` files.
2. Run `npm ci`, `npm run check`, and `node --test tests/*.test.mjs`, then `npm start`.
3. Open `/workspace`, sign in, and verify the supplied example: 3 held + 2 added, price 105, stop 103, point value 1, fixed exit costs 1, budget 10. The result must be 11, rejected, maximum addition 1. Replace example values with confirmed inputs for any real scenario.
4. Confirm the existing SignalPilot controls and owner session work. Keep execution disabled while testing the UI.
5. On the laptop, optionally build Vane using `docker compose -f deploy/compose.research.yaml up -d --build`. This requires the existing `tradelord-local` network, internet access for the build, and spare memory. The 1 CPU / 2 GB settings are initial service limits, not demonstrated sizing. Ollama's model memory is additional. The file starts only Vane and its bundled SearXNG; it never imports wallets or starts SignalPilot.
6. Configure Vane at `http://127.0.0.1:3030` to use the existing Ollama service and an installed embedding model. When Vane shares the existing Docker network, Ollama is `http://tradelord-local-ollama:11434`. Verify the exact installed model names. A model such as `nomic-embed-text` must be downloaded separately if absent; no model is pulled by this branch.
7. Set `WORKSPACE_OLLAMA_URL` and `VANE_URL` to addresses reachable from the workspace process. On the same Docker network these can be `http://tradelord-local-ollama:11434` and `http://research:3000`. A service on Render cannot reach the laptop's `localhost` or Docker aliases. A deployment/topology decision is still required; do not expose an unauthenticated Ollama or Vane port to the internet.
8. Test one normal chat and one sourced research request, then record latency and resource usage. Compare source relevance and dates. Keep heavy research outside the latency-sensitive trading work and measure contention.

## Before any production move

Obtain the current laptop Python source and deployment configuration, and verify the actual production host/branch. Back up and test restoration of SignalPilot's persistent state, execution journal, profit reserves, customer records and uploads on the existing host. Keep credentials on the host. A GitHub checkout contains code, not the current account state.

Use one active execution owner. Do not run a copied live data directory on a second host while the first can still execute. Reconcile holdings and all pending transactions before any controlled cutover. There is no wallet transfer, data migration or automated cutover script in this branch.

## Official research source

Vane (formerly Perplexica): https://github.com/ItzCrazyKns/Vane

Search API: https://github.com/ItzCrazyKns/Vane/blob/master/docs/API/SEARCH.md

It supports local Ollama models, SearXNG, source citations, and a search API. Existing workspace integration uses the documented provider IDs and model keys, speed mode and bounded recent history. It is an external dependency whose runtime compatibility and research quality still require testing on the target machine.
