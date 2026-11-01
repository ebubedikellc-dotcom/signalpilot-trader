#!/bin/bash
set -euo pipefail
cd /opt/trade-lord/training-hub
: "${1:?Supply the full repair commit SHA}"
[[ "$1" =~ ^[a-f0-9]{40}$ ]] || { echo 'Use a full commit SHA.' >&2; exit 1; }
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
base="https://raw.githubusercontent.com/ebubedikellc-dotcom/signalpilot-trader/$1/training-hub"
for name in question_answers.py question_queue.py question_ui.js install_answer_fix.py test_answer_fix.py; do
 curl -fsSL "$base/$name" -o "$build/$name"
done
# Preserve the actually running web version, including PDF and connection code.
for name in server.py training.html; do docker cp "training-hub-web-1:/app/hub/$name" "$build/$name"; done
python3 "$build/install_answer_fix.py" "$build"
web_image=$(docker inspect --format '{{.Image}}' training-hub-web-1)
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' training-hub-web-1)
config_list=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' training-hub-web-1)
[[ -n "$project" && -n "$config_list" && "$config_list" != '<no value>' ]] || { echo 'Cannot identify the running Compose configuration.' >&2; exit 1; }
IFS=',' read -r -a config_files <<< "$config_list"
compose=(docker compose --project-name "$project" --env-file .env)
for config in "${config_files[@]}"; do
 [[ -f "$config" ]] || { echo "Missing existing Compose file: $config" >&2; exit 1; }
 compose+=(-f "$config")
done
backup="answer-backup-$(date +%s)"
mkdir -m 700 "$backup"
docker tag "$web_image" "trade-lord-hub:$backup"
docker build --build-arg BASE_IMAGE="$web_image" -t trade-lord-hub:answer-candidate -f - "$build" <<'DOCKER'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY server.py training.html question_answers.py question_queue.py question_ui.js install_answer_fix.py test_answer_fix.py /app/hub/
DOCKER
# Stub transport tests use isolated temporary data and no network/model calls.
docker run --rm --network none --memory=512m --cpus=1 --entrypoint python trade-lord-hub:answer-candidate -m unittest -v test_answer_fix
docker run --rm --network none --entrypoint python trade-lord-hub:answer-candidate -c 'import server, question_answers, question_queue; assert server.ask is question_answers.ask; print("Question modules loaded")'
cp -a "$build/server.py" "$build/training.html" "$backup/"
if [[ -f compose.answer-fix.yaml ]]; then cp compose.answer-fix.yaml "$backup/previous-override.yaml"; fi
cat > compose.answer-fix.yaml <<'YAML'
services:
  web:
    image: trade-lord-hub:answer-candidate
YAML
compose+=(-f "$PWD/compose.answer-fix.yaml")
rollback(){
 trap - ERR
 cat > compose.answer-fix.yaml <<YAML
services:
  web:
    image: trade-lord-hub:$backup
YAML
 "${compose[@]}" up -d --no-deps --no-build --force-recreate web
 echo "Answer repair failed; restored the prior web image. Backup: $backup" >&2
}
trap rollback ERR
"${compose[@]}" up -d --no-deps --no-build --force-recreate web
for attempt in $(seq 1 30); do
 if docker exec training-hub-web-1 python -c 'import json,urllib.request; j=json.load(urllib.request.urlopen("http://127.0.0.1:8080/api/question/current",timeout=5)); assert "job" in j; p=urllib.request.urlopen("http://127.0.0.1:8080/control-panel/trade-lord",timeout=5).read(); assert b"questionMessage" in p; print("Question endpoint and form verified")'; then break; fi
 [[ "$attempt" != 30 ]] || false
 sleep 1
done
trap - ERR
echo "Answer repair installed. Backup image: trade-lord-hub:$backup"
echo 'Only the web service was recreated. Saved lessons and video/PDF workers were preserved.'
echo 'Reload the panel and ask one question. A real model answer still needs verification.'
echo 'Include -f compose.answer-fix.yaml LAST in future Compose commands.'
