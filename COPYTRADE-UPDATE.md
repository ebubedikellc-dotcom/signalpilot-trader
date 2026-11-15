# Frog copy preparation update — 15 November 2026

This updates the CopyTrade already installed on your laptop. FnZero is already
included there; it does not need another installation. Your existing account,
password, selected trader, purchase limit, locked profit and history are retained.

## Install this update

1. Extract **CopyTrade-Frog-Update.zip** into a new folder.
2. Open that folder and double-click **Update-CopyTrade.cmd**.
3. Enter your Ubuntu administrator password if requested. Wait for
   **CopyTrade update complete**.
4. Open **http://localhost:8088/trade-lord**, click **CopyTrade**, and press
   **Ctrl+F5** to load the updated screen. Sign in normally.
5. Confirm **Frog** is selected. Click **Check free connection**, then
   **Test speed**, once each. Share the results, with private credentials hidden.

Do not run Install-CopyTrade or import the account again for this update.
It changes two application files and rebuilds the existing local services.
It checks the installed code before changing it and saves the previous files.
If a build fails, the updater restores those source files without restarting
the services. If service startup fails, it reports that separately.
The updater requires the existing observation-mode configuration; it does not
enable trading, sign a transaction, or transfer money.

## What changed

- The buy/sell preparation test now uses public Solana history in free mode.
  Previously it still tried GMGN despite free mode being selected.
- The result names the actual source connection and trader wallet.
- The test rejects requests while trading is already running and prevents two
  preparation tests from running together.
- The display distinguishes preparation, an unheld coin's hypothetical sell
  quote, and actual trade submission. An old signal replay is not a live speed
  measurement.

## What copying currently means

With **Exact Copy — My Purchase Limit**, each buy is limited by the saved
purchase ceiling and available trading funds. A source partial sell applies
the same fraction to the verified copied holding; a source full exit closes
that copied holding. A pending or uncertain transaction must be reconciled
before another order for the same coin is sent. Unsupported source swaps or
unavailable routes may be rejected; not every Frog transaction is guaranteed
to be copyable.

FnZero prepares supported direct routes. Other routes use Jupiter before signing.
Qwen is not required to answer a question before a copy trade can be prepared.
Public RPC, source confirmation, quote availability, wallet signing and network
inclusion all affect actual speed. No 0.5-second fill or matching source price
has been verified on this laptop.

The next result needed is the laptop's connection and preparation report. A
successful preparation test still does not prove a live buy or sell completed.

## Validation of this update

329 Node checks and 7 Python checks passed. These include source decoding,
duplicate handling, proportional exits, FnZero routing safeguards, protected
funds, HTTP access controls and account-preserving update behavior. The separate
WhatsApp test suite is outside this CopyTrade change. The updater's Docker
commands were tested with a substitute; an actual Docker rebuild and free
connection test still need to run on the laptop. No real trade was used.

Upstream references:
- https://github.com/0xfnzero/sol-trade-sdk-nodejs
- https://github.com/0xfnzero/sol-trade-sdk/blob/main/docs/LOW_LATENCY_BOTS.md
- https://solana.com/docs/references/clusters
