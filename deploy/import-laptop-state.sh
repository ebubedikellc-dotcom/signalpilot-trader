#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ $# == 1 && -f "$1" ]] || { echo 'Usage: bash deploy/import-laptop-state.sh /path/to/private-backup.tar.gz'; exit 1; }
[[ -f deploy/.laptop.env ]] || { echo 'Run the laptop installer first.'; exit 1; }
COPYTRADE_DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then COPYTRADE_DOCKER=(sudo docker); fi
"${COPYTRADE_DOCKER[@]}" compose --env-file deploy/.laptop.env -f deploy/compose.laptop.yaml stop
python3 deploy/import-backup.py "$1" deploy/private-data
"${COPYTRADE_DOCKER[@]}" compose --env-file deploy/.laptop.env -f deploy/compose.laptop.yaml up -d --wait
echo 'Open CopyTrade, sign in, then check balances and pending orders. Live execution stays disabled.'
