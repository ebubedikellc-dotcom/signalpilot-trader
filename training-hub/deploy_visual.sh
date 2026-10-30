#!/bin/bash
set -eu
cd /opt/trade-lord/training-hub
: "${1:?Supply the upgrade commit}"
vision_build=$(mktemp -d)
vision_base="https://raw.githubusercontent.com/ebubedikellc-dotcom/signalpilot-trader/$1/training-hub"
for name in visual_lessons.py visual_smoke.py install_visual.py; do
  curl -fsSL "$vision_base/$name" -o "$vision_build/$name"
done
# Copy the running installation, preserving earlier repairs.
cp worker.py "$vision_build/worker.py"
python3 "$vision_build/install_visual.py" "$vision_build"
python3 -m py_compile "$vision_build/worker.py" "$vision_build/visual_lessons.py" "$vision_build/visual_smoke.py"
docker build -t trade-lord-hub:visual-candidate -f - "$vision_build" <<'DOCKER'
FROM trade-lord-hub:latest
COPY worker.py visual_lessons.py visual_smoke.py /app/hub/
DOCKER
docker exec training-hub-ollama-1 ollama pull qwen3-vl:4b-instruct-q4_K_M
compose=(docker compose --env-file .env -f compose.yaml -f compose.vps.yaml)
vision_backup="visual-backup-$(date +%s)"
mkdir "$vision_backup"
cp worker.py "$vision_backup/"
docker tag trade-lord-hub:latest "trade-lord-hub:$vision_backup"
"${compose[@]}" stop worker
rollback() {
  docker tag "trade-lord-hub:$vision_backup" trade-lord-hub:latest
  cp "$vision_backup/worker.py" worker.py
  "${compose[@]}" up -d --no-deps --no-build --force-recreate worker
}
trap rollback EXIT
# Use the same model lock and data mount as the existing web and worker.
echo 'Testing two chart images; this may take several minutes on CPU.'
docker run --rm --network training-hub_private --volumes-from training-hub-web-1 \
  --memory=512m --cpus=1 --entrypoint python trade-lord-hub:visual-candidate /app/hub/visual_smoke.py
docker tag trade-lord-hub:visual-candidate trade-lord-hub:latest
cp "$vision_build/worker.py" "$vision_build/visual_lessons.py" "$vision_build/visual_smoke.py" .
"${compose[@]}" up -d --no-deps --no-build --force-recreate worker
trap - EXIT
echo "Visual review installed for pending and future videos. Existing ready lessons preserved. Backup: $vision_backup"
echo 'Samples one image per minute, not every frame. No trading execution added.'
docker stats --no-stream training-hub-ollama-1 training-hub-worker-1
