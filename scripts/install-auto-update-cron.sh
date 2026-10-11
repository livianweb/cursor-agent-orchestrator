#!/usr/bin/env bash
# install-auto-update-cron.sh — registra (o quita) una entrada de crontab de usuario para
# scripts/auto-update-kit.sh. Cada clone del kit en cada máquina debe ejecutar esto una vez
# (o usar el wizard / systemd timer en docs/).
#
# Uso:
#   ./scripts/install-auto-update-cron.sh              # instala cron diario 06:00
#   ./scripts/install-auto-update-cron.sh --remove
#   ./scripts/install-auto-update-cron.sh --print-line
#   ORCHESTRATOR_AUTO_UPDATE_CRON_SCHEDULE='0 3 * * *' ./scripts/install-auto-update-cron.sh
#
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATE_SCRIPT="$KIT_ROOT/scripts/auto-update-kit.sh"
STATE_FILE="$KIT_ROOT/.askbox/auto-update.state"
LOG_FILE="$KIT_ROOT/.askbox/auto-update.log"
MARKER="# cursor-agent-orchestrator-auto-update"
SCHEDULE="${ORCHESTRATOR_AUTO_UPDATE_CRON_SCHEDULE:-0 6 * * *}"

REMOVE=0
PRINT_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --remove) REMOVE=1 ;;
    --print-line) PRINT_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --*) echo "Opción desconocida: $arg" >&2; exit 1 ;;
  esac
done

chmod +x "$UPDATE_SCRIPT" 2>/dev/null || true
mkdir -p "$KIT_ROOT/.askbox"

build_cron_line() {
  printf '%s ORCHESTRATOR_AUTO_UPDATE=1 %s >> %s 2>&1 %s\n' \
    "$SCHEDULE" "$UPDATE_SCRIPT" "$LOG_FILE" "$MARKER"
}

CRON_LINE="$(build_cron_line)"

if [ "$PRINT_ONLY" = "1" ]; then
  echo "$CRON_LINE"
  exit 0
fi

if ! command -v crontab >/dev/null 2>&1; then
  echo "ERROR: crontab no disponible. Copia esta línea manualmente:" >&2
  echo "$CRON_LINE" >&2
  exit 1
fi

existing="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$existing" | grep -v "$MARKER" | sed '/^[[:space:]]*$/d' || true)"

if [ "$REMOVE" = "1" ]; then
  if [ -n "$filtered" ]; then
    printf '%s\n' "$filtered" | crontab -
  else
    crontab -r 2>/dev/null || true
  fi
  ISO_NOW="$(date -Iseconds)"
  python3 - "$STATE_FILE" "$SCHEDULE" "$ISO_NOW" <<'PY'
import json
import sys
from pathlib import Path

path, schedule, disabled_at = sys.argv[1:4]
path = Path(path)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(
    json.dumps(
        {
            "enabled": False,
            "schedule": schedule,
            "disabled_at": disabled_at,
        },
        indent=2,
        ensure_ascii=False,
    )
    + "\n",
    encoding="utf-8",
)
PY
  echo "Cron de auto-update eliminado."
  exit 0
fi

{
  if [ -n "$filtered" ]; then
    printf '%s\n' "$filtered"
  fi
  printf '%s\n' "$CRON_LINE"
} | crontab -

ISO_NOW="$(date -Iseconds)"
python3 - "$STATE_FILE" "$SCHEDULE" "$CRON_LINE" "$LOG_FILE" "$ISO_NOW" <<'PY'
import json
import sys
from pathlib import Path

path, schedule, cron_line, log_file, installed_at = sys.argv[1:6]
path = Path(path)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(
    json.dumps(
        {
            "enabled": True,
            "schedule": schedule,
            "cron_line": cron_line.rstrip("\n"),
            "log_file": log_file,
            "installed_at": installed_at,
        },
        indent=2,
        ensure_ascii=False,
    )
    + "\n",
    encoding="utf-8",
)
PY

echo "Cron instalado ($SCHEDULE). Log: $LOG_FILE"
echo "Desactivar sin quitar la línea: ORCHESTRATOR_AUTO_UPDATE=0 en la entrada, o ./scripts/install-auto-update-cron.sh --remove"
echo "Línea:"
echo "  $CRON_LINE"
