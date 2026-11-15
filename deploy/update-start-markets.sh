#!/usr/bin/env bash
set -euo pipefail
umask 077
COPYTRADE_UPDATE_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COPYTRADE_UPDATE_TARGET="${COPYTRADE_UPDATE_TARGET:-$HOME/tradelord-copytrade}"
command -v python3 >/dev/null || { echo 'Python 3 is required in Ubuntu/WSL.'; exit 1; }
python3 "$COPYTRADE_UPDATE_SOURCE/deploy/apply-start-markets.py" check "$COPYTRADE_UPDATE_SOURCE" "$COPYTRADE_UPDATE_TARGET"
COPYTRADE_DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  echo 'Enter your Ubuntu administrator password if requested.'
  COPYTRADE_DOCKER=(sudo docker)
  "${COPYTRADE_DOCKER[@]}" info >/dev/null
fi
cd -- "$COPYTRADE_UPDATE_TARGET"
COPYTRADE_COMPOSE=("${COPYTRADE_DOCKER[@]}" compose --env-file deploy/.laptop.env -f deploy/compose.laptop.yaml)
"${COPYTRADE_COMPOSE[@]}" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin);e=c["services"]["copytrade"].get("environment",{})
observation=all(str(e.get(k,"")).lower()=="false" for k in ("ENABLE_LIVE_TRADING","EXECUTE_REAL_SWAPS"))
if not observation and str(e.get("COPYTRADE_REQUIRE_OWNER_START","")).lower()!="true":
    raise SystemExit("Unknown live startup configuration. Nothing changed; request a matching update.")
'
echo 'Updating the existing CopyTrade. Account data and password will be retained.'
echo 'Start will become available. Copying will stay stopped until you click Start yourself.'
"${COPYTRADE_COMPOSE[@]}" stop copytrade gateway
COPYTRADE_UPDATE_BACKUP="$(python3 "$COPYTRADE_UPDATE_SOURCE/deploy/apply-start-markets.py" apply "$COPYTRADE_UPDATE_SOURCE" "$COPYTRADE_UPDATE_TARGET")"
if ! "${COPYTRADE_COMPOSE[@]}" build copytrade; then
  python3 "$COPYTRADE_UPDATE_SOURCE/deploy/apply-start-markets.py" rollback "$COPYTRADE_UPDATE_BACKUP" "$COPYTRADE_UPDATE_TARGET"
  echo 'Build failed. Previous code and configuration were restored. Services remain stopped.'
  echo 'Share the build error; do not reinstall or import your account again.'
  exit 1
fi
if ! "${COPYTRADE_COMPOSE[@]}" up -d --no-build --force-recreate --wait copytrade gateway; then
  "${COPYTRADE_COMPOSE[@]}" stop copytrade gateway || true
  echo "Services did not become healthy. CopyTrade is stopped. Backup: $COPYTRADE_UPDATE_BACKUP"
  echo 'Share the error above; account data is retained.'
  exit 1
fi
echo 'CopyTrade update installed, including trader amounts. Copying is STOPPED.'
echo 'Open http://localhost:8088/trade-lord and click CopyTrade. Refresh with Ctrl+F5.'
echo 'Sign in. Choose Solana and your trader. Review your saved budget and purchase limit.'
echo 'Use Check trader amounts to compare recent buys and visible wallet balances.'
echo 'Both sizing choices remain: My Purchase Limit or Trader’s Full Amount. Matching their balance is optional.'
echo 'Open Trading options, Save trading mode, then Check free connection.'
echo 'Only click Start Trading yourself when you want real copying to begin.'
echo 'Gold and Forex have setup pages; a broker connection is still required.'
