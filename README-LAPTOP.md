# Trade Lord + CopyTrade laptop package

This adds SignalPilot, named **CopyTrade**, to the existing Trade Lord website
through a local gateway. It includes the pinned FnZero open-source builders,
public Solana notifications, confirmed history recovery, and the existing
SignalPilot interface. It does not install another Qwen or replace your lessons.

## Install on your Windows laptop

1. Start Docker and your existing Trade Lord. Confirm it still opens normally.
2. Extract the downloaded ZIP. Open the folder containing `Install-CopyTrade.cmd`.
3. Double-click **Install-CopyTrade.cmd**. It opens your existing Ubuntu/WSL.
4. If Docker asks, enter your Ubuntu administrator password. Then choose a **new
   CopyTrade password**, at least 16 characters. Typing passwords is invisible.
5. Wait for **Installed**. Open **http://localhost:8088/trade-lord** and click
   **CopyTrade**. Sign in using your owner email and the new password.
6. Click **Check free connection**. It reads public history and listens for up
   to two minutes. It does not sign or send a trade.

If the Windows launcher is unavailable, open the extracted folder in Ubuntu and run:

```bash
bash deploy/install-laptop.sh
```

When started from Windows Downloads, the installer copies code to
`~/tradelord-copytrade` before storing private files. It discovers the existing
`tradelord-local-web` Docker network and published web port. If it cannot identify
them, it stops with an explanation instead of guessing or altering Trade Lord.
You can specify another known container with `TRADE_LORD_CONTAINER=NAME`.

The original Trade Lord URL/port continues working. The combined site is on
localhost port 8088. It is accessible only on this laptop. No cloud hosting is
required for this installation, and no Render service is changed.

## Exactly what is included

- **FnZero** MIT-licensed source, pinned at commit
  `287dd67bd37b6e3084b253674c58cf1b9dbe3f34`; attribution and license are in
  `vendor/fnzero`. The extracted code prepares supported routes; it is not a new
  wallet, a free data provider, or a guarantee of half-second fills.
- **Free connection mode:** ignores old Helius/Alchemy keys and does not request
  GMGN. Confirmed public history fills missed WebSocket events, with durable
  checkpoints, duplicate protection and bounded recovery. Missing history or
  delayed recovery blocks new buys while verified exits remain eligible under
  the existing trading controls.
- **FnZero first:** supported, recently prepared direct USDC pools can use FnZero.
  Other routes retain the existing Jupiter fallback before signing. The initial
  local settings use FnZero; imported settings retain the owner's chosen engine.
- **Keyless Jupiter quotes:** no subscription/API key is required by this package.
  Its published keyless limit is 0.5 requests/second; requests are paced. Jupiter
  is an external service, not part of the open-source FnZero code. Trading/DEX
  and blockchain fees still apply.
- **Existing Turnkey signing/account connection:** preserved in private account
  data, not replaced with another wallet. Turnkey is an external service; this
  package does not claim its service is open source or change its account plan.
- The existing calculator and other workspace pages remain in the code. New
  research, WhatsApp, voice, and automated trading handover services are not
  installed or activated by this CopyTrade installer.

## Account migration is separate from downloading code

GitHub/this ZIP contains **no funded account, live balance, API keys, customer
records or order history**. Funds remain at the same wallet address. Never move
money just to make the local dashboard show the account.

Settings saved only in the old host's environment are not part of a data-directory
backup. Any required signing credentials must be restored privately and checked
against the same account before a later live cutover; never paste them into chat.

Use a private, complete backup of the existing SignalPilot data directory from
the old host. It must include `signalpilot-state.json`, `profit-reserves.json`
and `execution-journal.json`, with all other data files kept. Download it through
your own secure host connection; do not paste keys or the backup into chat.

After you have that backup locally:

```bash
cd ~/tradelord-copytrade
bash deploy/import-laptop-state.sh /path/to/private-backup.tar.gz
```

The importer stops the local services, checks the archive, keeps a rollback copy
of existing local data, restores all data files, invalidates copied sessions and
stops all profiles. Trading settings, accounts, reserves and the pending-order
journal are retained. No transaction is signed or sent. If the archive is
incomplete, it refuses to replace data.

**Live execution is disabled in this package.** Before enabling it, stop the old
executor, reconcile every held token and pending transaction against the chain,
verify reserves and withdrawal permissions, and test source detection plus route
preparation on the laptop. Do not run two executors for the same account. The
package does not automate that production cutover or claim that it has happened.

## Operation and rollback

From the installed folder:

```bash
# Stop only these new services; original Trade Lord/Ollama stay running.
docker compose --env-file deploy/.laptop.env -f deploy/compose.laptop.yaml stop

# Restart this observation installation.
docker compose --env-file deploy/.laptop.env -f deploy/compose.laptop.yaml up -d --wait
```

Use `sudo docker` if your Ubuntu account needs it. Private data lives in
`deploy/private-data`; the new login password is encoded in
`deploy/.laptop.private.env` (encoding is not encryption). These files are
permission-restricted and excluded from Git and the Docker image. Do not share
them. Back them up privately. Reinstallation never imports the cloud account
automatically. To update an existing installation, stop it and review changes
before replacing its code; preserve its private files.

## Evidence and limits

Automated tests exercise recovery gaps, missing transactions, durable cursors,
source verification, queue ordering, held balances, pending-order protection,
profit reserves, routing and the local gateway. These are software checks, not
live trading benchmarks. Docker installation and network speed still need to be
verified on the owner's laptop. No live trade was used to prepare this package.

Free public RPC endpoints are rate-limited and provide no guaranteed copying
latency or availability. The laptop needs internet, power and awake services for
monitoring. No 500 ms copy-to-fill promise is made.

Official references checked 14 November 2026:
- https://github.com/0xfnzero/sol-trade-sdk-nodejs
- https://solana.com/docs/references/clusters
- https://developers.jup.ag/docs/portal/setup
