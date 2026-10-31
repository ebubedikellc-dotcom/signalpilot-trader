#!/bin/bash
set -euo pipefail
cd /opt/trade-lord/training-hub
: "${1:?Supply the reviewed full commit SHA}"
[[ "$1" =~ ^[a-f0-9]{40}$ ]] || { echo 'Use a full commit SHA.' >&2; exit 1; }
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
base="https://raw.githubusercontent.com/ebubedikellc-dotcom/signalpilot-trader/$1/training-hub"
for name in pdf_learning.py install_pdf_learning.py test_pdf_learning.py; do
 curl -fsSL "$base/$name" -o "$build/$name"
done
for name in server.py training.html file_lessons.py; do docker cp "training-hub-web-1:/app/hub/$name" "$build/$name"; done
docker cp training-hub-worker-1:/app/hub/visual_lessons.py "$build/visual_lessons.py"
# Sharing the question-aware model gate is required; do not add competing models.
grep -q 'with turn()' "$build/visual_lessons.py"
python3 "$build/install_pdf_learning.py" "$build"
backup="pdf-learning-backup-$(date +%s)"
mkdir "$backup"
web_image=$(docker inspect --format '{{.Image}}' training-hub-web-1)
worker_id=$(docker inspect --format '{{.Id}}' training-hub-worker-1)
docker tag "$web_image" "trade-lord-hub:$backup"
cp -a "$build" "$backup/build"
docker build --build-arg BASE_IMAGE="$web_image" -t trade-lord-hub:pdf-learning -f - "$build" <<'DOCKER'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY pdf_learning.py visual_lessons.py server.py training.html file_lessons.py test_pdf_learning.py /app/hub/
DOCKER
# Isolated temporary database and stub vision model. No real lesson writes or downloads.
docker run --rm --network none --entrypoint python trade-lord-hub:pdf-learning -m unittest -v test_pdf_learning
compose=(docker compose --env-file .env -f compose.yaml -f compose.vps.yaml)
if [ -f compose.question-repair.yaml ]; then compose+=(-f compose.question-repair.yaml); fi
if [ -f compose.pdf-learning.yaml ]; then echo 'Existing PDF override: inspect before redeploying.' >&2; exit 1; fi
cat > compose.pdf-learning.yaml <<'YAML'
services:
  web:
    image: trade-lord-hub:pdf-learning
  pdf-worker:
    image: trade-lord-hub:pdf-learning
    command: [python, pdf_learning.py]
    restart: unless-stopped
    volumes: [hub-data:/data]
    environment:
      OLLAMA_URL: http://ollama:11434
    networks: [private, outbound]
    mem_limit: 512m
    cpus: 0.5
YAML
compose+=(-f compose.pdf-learning.yaml)
rollback(){
 "${compose[@]}" stop pdf-worker || true
 "${compose[@]}" rm -f pdf-worker || true
 cat > compose.pdf-learning.yaml <<YAML
services:
  web:
    image: trade-lord-hub:$backup
YAML
 "${compose[@]}" up -d --no-deps --no-build --force-recreate web
 echo "Upgrade failed; previous web image restored. Backup: $backup" >&2
}
trap rollback ERR
"${compose[@]}" up -d --no-deps --no-build web pdf-worker
docker exec training-hub-web-1 python -c 'import pdf_learning, model_gate, visual_lessons, server; print("PDF modules loaded")'
test "$(docker inspect --format '{{.Id}}' training-hub-worker-1)" = "$worker_id"
for attempt in $(seq 1 30); do
 if curl -fsS https://trade-lord.162-35-180-123.sslip.io/control-panel/trade-lord | grep -q 'PDF page and link progress'; then break; fi
 if [ "$attempt" = 30 ]; then false; fi
 sleep 1
done
test "$(docker inspect --format '{{.State.Running}}' training-hub-pdf-worker-1)" = true
"${compose[@]}" ps web pdf-worker
trap - ERR
echo "PDF page/link processing installed. Backup: $backup. Video worker unchanged."
echo 'Reload the panel and upload a permitted PDF. Real visual accuracy and live link access still require verification.'
echo 'Include -f compose.pdf-learning.yaml LAST in future Compose commands.'
