#!/bin/bash
set -euo pipefail
files_version=${1:?Supply the installer commit SHA}
[[ "$files_version" =~ ^[a-f0-9]{40}$ ]] || { echo 'Use a full commit SHA.'; exit 1; }
cd /opt/trade-lord/training-hub
compose=(docker compose --env-file .env -f compose.yaml -f compose.vps.yaml)
"${compose[@]}" config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); assert c["services"]["web"]["image"]=="trade-lord-hub:latest", "Unexpected web image; deployment stopped."'
files_worker_before=$(docker inspect -f '{{.Id}}' training-hub-worker-1)
files_web_image=$(docker inspect -f '{{.Image}}' training-hub-web-1)
files_base_image=$(docker image inspect -f '{{.Id}}' trade-lord-hub:latest)
files_build=$(mktemp -d)
files_source="https://raw.githubusercontent.com/ebubedikellc-dotcom/signalpilot-trader/$files_version/training-hub"
for name in file_lessons.py install_file_lessons.py file_lessons_smoke.py; do
  curl --fail --silent --show-error --location --connect-timeout 20 --max-time 120 "$files_source/$name" -o "$files_build/$name"
done
# Patch the actual running web source, retaining all earlier repairs.
docker cp training-hub-web-1:/app/hub/server.py "$files_build/server.py"
docker cp training-hub-web-1:/app/hub/training.html "$files_build/training.html"
python3 "$files_build/install_file_lessons.py" "$files_build"
python3 -m py_compile "$files_build/server.py" "$files_build/file_lessons.py" "$files_build/file_lessons_smoke.py"
files_stamp=$(date +%s%N)
files_candidate="trade-lord-hub:file-candidate-$files_stamp"
docker build -t "$files_candidate" --build-arg "FILES_BASE=$files_base_image" -f - "$files_build" <<'DOCKER'
ARG FILES_BASE
FROM ${FILES_BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY server.py training.html file_lessons.py file_lessons_smoke.py /app/hub/
USER hub
DOCKER
echo 'Testing the new image with a temporary database; videos continue running.'
docker run --rm --network none --memory=512m --cpus=1 --entrypoint python "$files_candidate" /app/hub/file_lessons_smoke.py
files_backup="file-lessons-backup-$files_stamp"
mkdir "$files_backup"
for name in server.py training.html file_lessons.py; do
  if [ -f "$name" ]; then cp -p "$name" "$files_backup/$name"; fi
done
docker tag "$files_base_image" "trade-lord-hub:$files_backup-base"
docker tag "$files_web_image" "trade-lord-hub:$files_backup-web"
printf 'services:\n  web:\n    image: trade-lord-hub:%s-web\n' "$files_backup" > "$files_backup/rollback.yaml"
rollback() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    echo 'Installation check failed. Restoring the previous web service.' >&2
    docker tag "trade-lord-hub:$files_backup-base" trade-lord-hub:latest || true
    for name in server.py training.html file_lessons.py; do
      if [ -f "$files_backup/$name" ]; then cp -p "$files_backup/$name" "$name"; else rm -f "$name"; fi
    done
    "${compose[@]}" -f "$files_backup/rollback.yaml" up -d --no-deps --no-build --force-recreate web || echo 'Web restore failed; retain the backup for diagnosis.' >&2
  fi
  exit "$status"
}
trap rollback EXIT
docker tag "$files_candidate" trade-lord-hub:latest
"${compose[@]}" up -d --no-deps --no-build --force-recreate web
docker exec -i training-hub-web-1 python - <<'PY'
import json,time,urllib.request
for attempt in range(15):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8080/control-panel/trade-lord',timeout=3) as response:
            assert b'id="lesson-file-form"' in response.read(), 'File form is missing'
        with urllib.request.urlopen('http://127.0.0.1:8080/api/jobs',timeout=3) as response:
            assert isinstance(json.load(response)['jobs'],list)
        print('Installed web page and existing lesson database are readable.')
        break
    except Exception:
        if attempt == 14: raise
        time.sleep(1)
PY
test "$(docker inspect -f '{{.Id}}' training-hub-worker-1)" = "$files_worker_before"
cp "$files_build/server.py" "$files_build/training.html" "$files_build/file_lessons.py" .
trap - EXIT
rm -rf "$files_build"
echo "File lessons installed. Previous web image and source backup: $files_backup"
echo 'Video worker was not restarted. Refresh the control panel and find Upload a lesson file.'
echo 'PDF/DOCX/TXT/MD readable text is supported; scanned pages need OCR and images are not interpreted.'
