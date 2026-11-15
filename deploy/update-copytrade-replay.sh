#!/usr/bin/env bash
set -euo pipefail
umask 077
COPYTRADE_UPDATE_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COPYTRADE_UPDATE_TARGET="${COPYTRADE_UPDATE_TARGET:-$HOME/tradelord-copytrade}"
command -v python3 >/dev/null || { echo 'Python 3 is required in Ubuntu/WSL.'; exit 1; }
[[ -f "$COPYTRADE_UPDATE_TARGET/deploy/.laptop.env" && -f "$COPYTRADE_UPDATE_TARGET/deploy/.laptop.private.env" ]] || {
  echo 'Existing laptop installation was not found. Nothing changed.'; exit 1;
}
COPYTRADE_DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  echo 'Enter your Ubuntu administrator password if requested.'
  COPYTRADE_DOCKER=(sudo docker)
  "${COPYTRADE_DOCKER[@]}" info >/dev/null
fi
cd -- "$COPYTRADE_UPDATE_TARGET"
COPYTRADE_COMPOSE=("${COPYTRADE_DOCKER[@]}" compose --env-file deploy/.laptop.env -f deploy/compose.laptop.yaml)
# Inspect configuration without printing its private environment values.
"${COPYTRADE_COMPOSE[@]}" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)
e=c["services"]["copytrade"].get("environment",{})
if any(str(e.get(k,"")).lower()!="false" for k in ("ENABLE_LIVE_TRADING","EXECUTE_REAL_SWAPS")):
    raise SystemExit("This updater requires the existing observation-mode installation. Nothing changed.")
'
COPYTRADE_UPDATE_BACKUP="$(python3 - "$COPYTRADE_UPDATE_SOURCE" "$COPYTRADE_UPDATE_TARGET" <<'PY'
import hashlib,json,pathlib,shutil,sys,tempfile
source,target=map(lambda s:pathlib.Path(s).resolve(),sys.argv[1:])
if source==target:raise SystemExit('Extract the update into a separate folder before running it. Nothing changed.')
manifest=json.loads((source/'deploy/replay-update-manifest.json').read_text())
if set(manifest)!=set(('server.js','script.js')):raise SystemExit('Unexpected update files. Nothing changed.')
for name,entry in manifest.items():
    src,dst=source/name,target/name
    if src.is_symlink() or dst.is_symlink():raise SystemExit('Unexpected linked code file. Nothing changed.')
    if hashlib.sha256(src.read_bytes()).hexdigest()!=entry['new']:raise SystemExit('Update file check failed. Download the update again.')
    if hashlib.sha256(dst.read_bytes()).hexdigest() not in (entry['old'],entry['new']):
        raise SystemExit('Your installed '+name+' differs from this update. Nothing changed; ask for a matching update.')
root=target/'.code-updates'
root.mkdir(mode=0o700,exist_ok=True)
backup=pathlib.Path(tempfile.mkdtemp(prefix='before-public-replay-',dir=root))
for name in manifest:shutil.copy2(target/name,backup/name)
try:
    for name in manifest:shutil.copy2(source/name,target/name)
except BaseException:
    for name in manifest:shutil.copy2(backup/name,target/name)
    raise
print(backup)
PY
)"
if ! "${COPYTRADE_COMPOSE[@]}" build copytrade; then
  cp -- "$COPYTRADE_UPDATE_BACKUP/server.js" server.js
  cp -- "$COPYTRADE_UPDATE_BACKUP/script.js" script.js
  echo 'Build failed. Previous code was restored; services were not restarted.'
  exit 1
fi
if ! "${COPYTRADE_COMPOSE[@]}" up -d --no-build --force-recreate --wait copytrade gateway; then
  echo "The updated services did not become healthy. Previous code is saved in $COPYTRADE_UPDATE_BACKUP."
  echo 'Keep trading stopped and share the error above.'
  exit 1
fi
echo 'CopyTrade update complete. Your account data and login settings were retained.'
echo 'Open http://localhost:8088/trade-lord and click CopyTrade. Refresh with Ctrl+F5.'
echo 'Select Frog, click Check free connection, then Test speed. Trading remains disabled.'
