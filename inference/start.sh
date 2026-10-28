#!/bin/sh
set -eu
: "${TRADE_LORD_MODEL:=qwen3:4b-q4_K_M}"
ollama serve &
server_pid=$!
cleanup() { kill "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
attempt=0
until OLLAMA_HOST=127.0.0.1:11434 ollama list >/dev/null 2>&1; do
  kill -0 "$server_pid" 2>/dev/null || { echo 'Model server stopped before becoming ready.' >&2; exit 1; }
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || { echo 'Model server startup timed out.' >&2; exit 1; }
  sleep 1
done
# Pull is resumable; the persistent disk retains weights between deployments.
# A failed download fails this process instead of reporting the model as ready.
OLLAMA_HOST=127.0.0.1:11434 ollama pull "$TRADE_LORD_MODEL"
echo 'Model downloaded. Application connection checks can now verify it.'
wait "$server_pid"
