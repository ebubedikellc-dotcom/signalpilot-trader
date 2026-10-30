#!/bin/bash
set -eu
cd /opt/trade-lord/training-hub
: "${1:?Pass the GitHub commit for this fix}"
fix_base="https://raw.githubusercontent.com/ebubedikellc-dotcom/signalpilot-trader/$1/training-hub"
fix_dir=$(mktemp -d)
curl -fsSL "$fix_base/install_processing_fix.py" -o "$fix_dir/install.py"
curl -fsSL "$fix_base/requeue_lesson_repair.py" -o "$fix_dir/requeue_lesson_repair.py"
python3 "$fix_dir/install.py" /opt/trade-lord/training-hub
cp server.py worker.py model_requests.py "$fix_dir/"
docker build -t trade-lord-hub:latest -f - "$fix_dir" <<'DOCKER'
FROM trade-lord-hub:latest
COPY server.py worker.py model_requests.py requeue_lesson_repair.py /app/hub/
DOCKER
docker compose --env-file .env -f compose.yaml -f compose.vps.yaml stop worker
docker compose --env-file .env -f compose.yaml -f compose.vps.yaml up -d --no-deps --no-build --force-recreate web
docker exec training-hub-web-1 python requeue_lesson_repair.py
docker compose --env-file .env -f compose.yaml -f compose.vps.yaml up -d --no-deps --no-build --force-recreate worker
docker compose --env-file .env -f compose.yaml -f compose.vps.yaml ps
echo 'Lesson-processing fix installed.'
