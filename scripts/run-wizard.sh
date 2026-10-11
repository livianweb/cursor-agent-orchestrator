#!/usr/bin/env bash
# Arranca el servidor HTTP del wizard (setup/ + POST /api/install).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${CONFIGURE_HOST:-0.0.0.0}"
PORT="${CONFIGURE_PORT:-8765}"

if [ ! -f "$ROOT/setup/index.html" ]; then
  echo "ERROR: no se encuentra $ROOT/setup/index.html" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 requerido para el wizard (API /api/install)." >&2
  echo "Alternativa: ./configure --open-file" >&2
  exit 1
fi

echo "cursor-agent-orchestrator — panel de control"
echo "  Repo:  $ROOT"
echo "  Abre:  http://127.0.0.1:$PORT/"
echo "  Gestiona instalaciones en el navegador (lista, nueva, desinstalar)."
echo

if [ "${ORCHESTRATOR_IN_DOCKER:-}" != "1" ]; then
  if command -v xdg-open >/dev/null 2>&1; then
    (sleep 0.4 && xdg-open "http://127.0.0.1:$PORT/") >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    (sleep 0.4 && open "http://127.0.0.1:$PORT/") >/dev/null 2>&1 &
  fi
fi

export CONFIGURE_HOST="$HOST"
export CONFIGURE_PORT="$PORT"
exec python3 "$ROOT/scripts/setup_server.py"
