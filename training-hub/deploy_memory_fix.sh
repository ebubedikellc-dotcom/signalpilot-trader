#!/bin/bash
set -eu
cd /opt/trade-lord/training-hub
: "${1:?Supply the fix commit}"
repair_build=$(mktemp -d)
repair_base="https://raw.githubusercontent.com/ebubedikellc-dotcom/signalpilot-trader/$1/training-hub"
for name in model_requests.py resume_memory_failures.py; do
  curl -fsSL "$repair_base/$name" -o "$repair_build/$name"
done
python3 -m py_compile "$repair_build/model_requests.py" "$repair_build/resume_memory_failures.py"
test -f model_requests.py
repair_backup="memory-backup-$(date +%s)"
mkdir "$repair_backup"
cp model_requests.py "$repair_backup/"
docker tag trade-lord-hub:latest "trade-lord-hub:$repair_backup"
docker build -t trade-lord-hub:memory-repair -f - "$repair_build" <<'DOCKER'
FROM trade-lord-hub:latest
COPY model_requests.py resume_memory_failures.py /app/hub/
DOCKER
compose=(docker compose --env-file .env -f compose.yaml -f compose.vps.yaml)
# Existing volumes and configuration are preserved.
"${compose[@]}" stop worker web
trap '"${compose[@]}" up -d --no-deps --no-build web worker' EXIT
cp "$repair_build/model_requests.py" model_requests.py
docker tag trade-lord-hub:memory-repair trade-lord-hub:latest
"${compose[@]}" up -d --no-deps --no-build --force-recreate ollama web
docker exec -i training-hub-web-1 python - <<'VERIFY'
import time,urllib.request
for attempt in range(30):
    try:
        urllib.request.urlopen('http://ollama:11434/api/tags',timeout=2).close()
        break
    except Exception:
        if attempt==29: raise
        time.sleep(1)
from model_requests import ask
print('Testing Qwen; allow a few minutes...',flush=True)
answer=ask('Reference note: the verification phrase is green notebook 47. What is the verification phrase? Reply with only that phrase.',timeout=300)
if 'green notebook 47' not in answer.lower():
    raise SystemExit('Qwen responded, but the reference check failed. Keep the output for review.')
print('Qwen reference check passed.',flush=True)
VERIFY
docker exec training-hub-web-1 python resume_memory_failures.py
"${compose[@]}" up -d --no-deps --no-build --force-recreate worker
trap - EXIT
docker inspect --format 'OOMKilled={{.State.OOMKilled}} Restarts={{.RestartCount}}' training-hub-ollama-1
"${compose[@]}" ps
echo "Memory repair installed. Backup image: trade-lord-hub:$repair_backup"
echo 'Saved lessons preserved. Long-running stability still needs monitoring.'
