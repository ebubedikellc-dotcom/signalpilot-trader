# CopyTrade speed: focused work

The current priority is SignalPilot's copy-trading path. Keep its existing
accounts, signer connections, FnZero builders, direct Solana notifications and
Jupiter fallback when bringing it into Trade Lord's CopyTrade page.

## Verified scheduling fix

The shared RPC queue could be waiting for a transaction-specific pacing timer
when a different, urgent sell balance check arrived. The new check could not
wake the queue, even when the provider's global spacing had already elapsed.

The queue now re-evaluates pending work when a new request arrives, an existing
request is promoted, or a rate-limit response changes its state. Superseded
timers are cancelled. Global spacing, method-specific pacing, Retry-After,
concurrency limits and fresh balance checks remain enforced.

A controlled-clock regression reproduced the failure before the change:
the transaction timer ran until 62,001 ms, while an eligible sell check arrived
at 60,251 ms. After the change, that sell check starts at 60,251 ms and the next
transaction read still waits until 62,001 ms. This removes a 1,750 ms scheduling
delay in that specific simulated case. It is not a live copy-to-fill benchmark.

This change does not modify trading permissions, signing, source verification,
position sizing, transaction submission or the selected RPC provider.

## Free-connection laptop package — 14 November 2026

`README-LAPTOP.md` contains the installation and private-import instructions.
The laptop package includes the existing pinned FnZero builders and uses public
Solana WebSocket notifications plus durable confirmed-history recovery. It does
not require Helius or GMGN. Keyless Jupiter fallback is paced to its published
allowance; the public connection is not a guaranteed low-latency service.

The gateway adds `/copytrade/` beside the existing Python Trade Lord without
replacing its container, lesson data or installed Qwen model. Both live execution
switches are off. The owner-only connection check observes public activity for
two minutes and measures a read request; it is not a copied-fill benchmark.

Validation: 334 Node checks passed, followed by 17 targeted rechecks after the
final importer/preview adjustments, plus two Python backup-import checks. HTTP
checks cover the mounted UI, owner login, preservation of source wallet/cap,
private-route protection and rejection of live starts. The Docker image and
actual laptop connection have not been tested here. The cloud browser could not
open the local preview, so this update has no completed visual browser check.

## Remaining work

1. Measure the existing live path without signing or submitting trades: source
   notification, confirmed source decode, route preparation and signing readiness.
2. Measure the free public connection on the laptop before considering any
   different feed. Yellowstone is not included and does not itself provide a
   free, low-latency mainnet data service.
3. Keep the source confirmation policy explicit. A faster feed does not by itself
   remove confirmation time, network delay, route preparation or on-chain inclusion.
4. Install and validate on the target machine. Code on the review branch is not
   evidence that the laptop or the funded Render instance has been updated.

No live trade or money movement was used to validate this change.
