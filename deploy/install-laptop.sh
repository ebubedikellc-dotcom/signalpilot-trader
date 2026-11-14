#!/usr/bin/env bash
set -euo pipefail
umask 077
COPYTRADE_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v python3 >/dev/null || { echo 'Python 3 is required in Ubuntu/WSL.'; exit 1; }
# Keep credentials on the Linux filesystem, away from a shared Downloads folder.
if [[ "$COPYTRADE_SOURCE" == /mnt/* ]]; then
  COPYTRADE_DEST="$HOME/tradelord-copytrade"
  if [[ -e "$COPYTRADE_DEST" ]]; then
    echo "An installation already exists at $COPYTRADE_DEST. Open its README-LAPTOP.md before updating."
    exit 1
  fi
  python3 - "$COPYTRADE_SOURCE" "$COPYTRADE_DEST" <<'PY'
import shutil,sys
shutil.copytree(sys.argv[1],sys.argv[2],ignore=shutil.ignore_patterns('.git','node_modules','.laptop*','private-data','private-data-*'))
PY
  exec bash "$COPYTRADE_DEST/deploy/install-laptop.sh"
fi
cd -- "$COPYTRADE_SOURCE"
command -v docker >/dev/null || { echo 'Open Docker/WSL first. Docker is not available in this Ubuntu terminal.'; exit 1; }
COPYTRADE_DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  echo 'Docker needs your Ubuntu administrator password. Typed characters will not appear.'
  COPYTRADE_DOCKER=(sudo docker)
  "${COPYTRADE_DOCKER[@]}" info >/dev/null
fi
"${COPYTRADE_DOCKER[@]}" compose version >/dev/null
COPYTRADE_CONTAINER="${TRADE_LORD_CONTAINER:-tradelord-local-web}"
COPYTRADE_INSPECT="$(mktemp)"
trap 'rm -f -- "$COPYTRADE_INSPECT"' EXIT
"${COPYTRADE_DOCKER[@]}" inspect "$COPYTRADE_CONTAINER" > "$COPYTRADE_INSPECT"
python3 - "$COPYTRADE_INSPECT" "$COPYTRADE_CONTAINER" <<'PY'
import json,os,pathlib,sys
c=json.loads(pathlib.Path(sys.argv[1]).read_text())[0]
if not c.get('State',{}).get('Running'):raise SystemExit('Start your existing Trade Lord container, then run this installer again.')
networks=[n for n in c['NetworkSettings']['Networks'] if n not in ('host','bridge','none')]
if not networks:raise SystemExit('Trade Lord has no named Docker network. Setup stopped without changing it.')
network='tradelord-local' if 'tradelord-local' in networks else networks[0]
ports=c['NetworkSettings'].get('Ports') or {}
preferred=[p.split('/')[0] for p,v in ports.items() if v and any(x.get('HostPort')=='8080' for x in v)]
choices=preferred or [p.split('/')[0] for p,v in ports.items() if v]
if not choices:choices=[p.split('/')[0] for p in (c.get('Config',{}).get('ExposedPorts') or {})]
choices=list(dict.fromkeys(choices))
if len(choices)!=1 or not choices[0].isdigit():raise SystemExit('Could not determine the existing Trade Lord web port. Setup stopped without changing it.')
pathlib.Path('deploy/.laptop.env').write_text(f'TRADE_LORD_NETWORK={network}\nTRADE_LORD_UPSTREAM=http://{sys.argv[2]}:{choices[0]}\nCOPYTRADE_UID={os.getuid()}\nCOPYTRADE_GID={os.getgid()}\nCOPYTRADE_PORT=8088\n')
print('Existing Trade Lord detected. Its code, lessons and Ollama will be kept.')
PY
if [[ ! -f deploy/.laptop.private.env ]]; then
  echo 'Choose a NEW CopyTrade sign-in password with at least 16 characters.'
  read -r -s -p 'New password (typing is hidden): ' COPYTRADE_PASSWORD
  echo
  read -r -s -p 'Repeat new password: ' COPYTRADE_PASSWORD_REPEAT
  echo
  if [[ "$COPYTRADE_PASSWORD" != "$COPYTRADE_PASSWORD_REPEAT" || ${#COPYTRADE_PASSWORD} -lt 16 || ${#COPYTRADE_PASSWORD} -gt 256 ]]; then
    echo 'Passwords must match and contain 16–256 characters. No service was started.'; exit 1
  fi
  { printf 'OWNER_PASSWORD_B64='; printf '%s' "$COPYTRADE_PASSWORD" | base64 -w0; printf '\n'; } > deploy/.laptop.private.env
  unset COPYTRADE_PASSWORD COPYTRADE_PASSWORD_REPEAT
fi
mkdir -p deploy/private-data
chmod 700 deploy/private-data
chmod 600 deploy/.laptop.env deploy/.laptop.private.env
# This package always starts with both real-execution switches OFF.
"${COPYTRADE_DOCKER[@]}" compose --env-file deploy/.laptop.env -f deploy/compose.laptop.yaml up -d --build --wait
echo
echo 'Installed. Open http://localhost:8088/trade-lord and click CopyTrade.'
echo 'Sign in with your owner email and the NEW CopyTrade password.'
echo 'Click Check free connection. No trades will be sent by this installation.'
echo 'Your funded account/history require your private SignalPilot backup; they are not in the code download.'
