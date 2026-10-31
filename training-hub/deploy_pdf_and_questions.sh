#!/bin/bash
set -euo pipefail
cd /opt/trade-lord/training-hub
: "${1:?Supply repair commit}"
build=$(mktemp -d)
base="https://raw.githubusercontent.com/ebubedikellc-dotcom/signalpilot-trader/$1/training-hub"
curl -fsSL "$base/install_question_repair.py" -o "$build/install_question_repair.py"
# Read the running containers, not potentially older host copies.
for name in server.py training.html; do docker cp "training-hub-web-1:/app/hub/$name" "$build/$name"; done
for name in model_requests.py visual_lessons.py; do docker cp "training-hub-worker-1:/app/hub/$name" "$build/$name"; done
for name in file_lessons.py install_file_lessons.py file_lessons_smoke.py; do
 curl -fsSL "$base/$name" -o "$build/$name"
done
python3 "$build/install_file_lessons.py" "$build"
if grep -q '^import question_queue' "$build/server.py"; then
 for name in question_queue.py model_gate.py; do docker cp "training-hub-web-1:/app/hub/$name" "$build/$name"; done
else
 python3 "$build/install_question_repair.py" "$build"
fi
backup="pdf-question-backup-$(date +%s)"
mkdir "$backup"
cp -a "$build" "$backup/build"
web_image=$(docker inspect --format '{{.Image}}' training-hub-web-1)
worker_image=$(docker inspect --format '{{.Image}}' training-hub-worker-1)
docker tag "$web_image" "trade-lord-hub:$backup-web"
docker tag "$worker_image" "trade-lord-hub:$backup-worker"
for service in web worker; do
 if [ "$service" = web ]; then base_image=$web_image; else base_image=$worker_image; fi
 docker build --build-arg BASE_IMAGE="$base_image" -t "trade-lord-hub:question-repair-$service" -f - "$build" <<'DOCKER'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY model_requests.py model_gate.py question_queue.py /app/hub/
DOCKER
 if [ "$service" = web ]; then
  docker build -t trade-lord-hub:question-repair-web -f - "$build" <<'DOCKER'
FROM trade-lord-hub:question-repair-web
USER root
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY server.py training.html file_lessons.py file_lessons_smoke.py /app/hub/
USER hub
DOCKER
 else
  docker build -t trade-lord-hub:question-repair-worker -f - "$build" <<'DOCKER'
FROM trade-lord-hub:question-repair-worker
COPY visual_lessons.py /app/hub/
DOCKER
 fi
done
echo 'Testing PDF extraction and lesson saving in a temporary database.'
docker run --rm --network none --memory=512m --cpus=1 --entrypoint python trade-lord-hub:question-repair-web /app/hub/file_lessons_smoke.py
cat > "$backup/rollback.yaml" <<YAML
services:
  web:
    image: trade-lord-hub:$backup-web
  worker:
    image: trade-lord-hub:$backup-worker
YAML
if [ -f compose.question-repair.yaml ]; then cp compose.question-repair.yaml "$backup/previous-override.yaml"; fi
cat > compose.question-repair.yaml <<'YAML'
services:
  web:
    image: trade-lord-hub:question-repair-web
  worker:
    image: trade-lord-hub:question-repair-worker
YAML
compose=(docker compose --env-file .env -f compose.yaml -f compose.vps.yaml -f compose.question-repair.yaml)
rollback(){
 cp "$backup/rollback.yaml" compose.question-repair.yaml
 "${compose[@]}" up -d --no-deps --no-build --force-recreate web worker
 echo "Repair failed; restored previous images. Backup: $backup" >&2
}
trap rollback ERR
# Worker startup resumes interrupted jobs from saved checkpoints. No database clearing.
"${compose[@]}" up -d --no-deps --no-build --force-recreate web worker
docker exec training-hub-web-1 python -c 'import model_gate, question_queue, file_lessons, server; print("Question queue modules loaded")'
for attempt in $(seq 1 30); do
 if curl -fsS "https://trade-lord.162-35-180-123.sslip.io/control-panel/trade-lord" | grep -q '/api/question'; then break; fi
 if [ "$attempt" = 30 ]; then false; fi
 sleep 1
done
docker exec training-hub-web-1 python -c 'import urllib.request; p=urllib.request.urlopen("http://127.0.0.1:8080/control-panel/trade-lord",timeout=10).read(); assert b"lesson-file-form" in p and b"/api/question" in p; print("PDF form and question queue present")'
trap - ERR
echo "Question repair installed. Backup: $backup"
echo 'PDF uploader installed. Reload the control panel. Questions now wait for a model turn; actual understanding still needs testing.'
echo 'For future Compose commands include: -f compose.question-repair.yaml'
