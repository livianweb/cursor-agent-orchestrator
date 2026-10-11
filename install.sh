#!/usr/bin/env bash
# install.sh — instala el paradigma de orquestación Cursor (Auto + Multitask)
# en un proyecto destino, sin pisar a ciegas lo que ya exista.
#
# Válido para repos NUEVOS (sin .cursor/) y EXISTENTES (con rules/skills/hooks propios).
# Solo copia piezas del orquestador; no borra ni toca archivos fuera de la lista.
#
# Uso principal:
#   ./install.sh                    panel Docker en :8765 (docker compose up -d --build)
#   ./install.sh --down             para el panel Docker
#   ./install.sh --wizard           igual que sin argumentos
#
# Legacy (CLI, sin UI): ./install.sh [RUTA_PROYECTO_DESTINO] [opciones]
# La gestión de instalaciones (lista, nueva, desinstalar) es en el navegador.
#
# Opciones:
#   --force         backup (.bak-FECHA) + sobrescribe si el archivo difiere
#   --merge         ante conflicto (mismo nombre, contenido distinto): propone fusión vía askbox
#                   (POST /v1/ask); escribe *.merge-proposal sin pisar el destino
#   --merge-apply   como --merge y además aplica la fusión al archivo destino (con backup)
#   --dry-run       simula sin escribir
#   --no-template   no copia plantillas de convenciones
#
# Política por defecto: idéntico → sin cambios | distinto → skip + aviso
# Con ASKBOX_API_URL + ASKBOX_ACCESS_TOKEN en el entorno y sin --force/--merge/--merge-apply
# explícitos: equivale a --merge-apply (fusión askbox aplicada con backup).
# Con --merge: askbox analiza kit vs proyecto; sin ASKBOX_* → aviso + side-by-side en .merge-proposal
# Tras --merge/--merge-apply: informe de directivas contradictorias en
#   .cursor/install-merge-policy-report.md (o .merge-proposal si no hay askbox)
#
# Archivos del kit (lista cerrada): auto-orchestrator.mdc, multitask-ownership.mdc,
# skills plan-implement-verify, askbox-first, git-autopilot; plantillas opcionales.
#
# Idempotente: destino idéntico al kit → sin cambios.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$SCRIPT_DIR"
MERGE_HELPER="$SCRIPT_DIR/scripts/install-merge-askbox.py"
WIZARD_HELPER="$SCRIPT_DIR/scripts/run-wizard.sh"

warn_if_root() {
  if [ "$(id -u)" -eq 0 ]; then
    echo "Aviso: no uses sudo; el wizard y la instalación no necesitan root." >&2
  fi
}

run_wizard_foreground() {
  warn_if_root
  if [ ! -x "$WIZARD_HELPER" ]; then
    chmod +x "$WIZARD_HELPER" 2>/dev/null || true
  fi
  exec bash "$WIZARD_HELPER"
}

panel_configure_port() {
  local port="${CONFIGURE_PORT:-8765}"
  if [ -f "$KIT_ROOT/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        \#*) continue ;;
        CONFIGURE_PORT=*) port="${line#CONFIGURE_PORT=}"; port="${port%\"}"; port="${port#\"}" ;;
      esac
    done < "$KIT_ROOT/.env"
  fi
  printf '%s' "$port"
}

open_panel_url() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  fi
}

run_panel_docker() {
  warn_if_root
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker no está instalado. Instálalo o usa ORCHESTRATOR_PANEL_FOREGROUND=1 ./install.sh" >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: docker compose (plugin v2) no disponible." >&2
    exit 1
  fi

  export ORCHESTRATOR_KIT_PATH="$(cd "$KIT_ROOT" && pwd)"
  cd "$KIT_ROOT"

  if [ "${COMPOSE_DOWN:-0}" = "1" ]; then
    docker compose down
    echo "Panel Docker detenido."
    exit 0
  fi

  if [ ! -f .env ] && [ -f .env.docker.example ]; then
    echo "Tip: cp .env.docker.example .env para ORCHESTRATOR_KIT_PATH / HOST_ROOT (opcional)."
  fi

  echo "cursor-agent-orchestrator — panel Docker (restart: unless-stopped)"
  docker compose up -d --build

  local port
  port="$(panel_configure_port)"
  local url_helper="$KIT_ROOT/scripts/panel-print-urls.sh"
  if [ ! -x "$url_helper" ]; then
    chmod +x "$url_helper" 2>/dev/null || true
  fi

  echo
  if [ -x "$url_helper" ]; then
    CONFIGURE_PORT="$port" bash "$url_helper" "$port"
  else
    echo "http://127.0.0.1:${port}/"
  fi
  echo
  echo "Estado: docker compose ps"
  echo "Parar:  ./install.sh --down"
  echo

  open_panel_url "http://127.0.0.1:${port}/"
  exit 0
}

WIZARD=0
COMPOSE_DOWN=0
TARGET_DIR=""
FORCE=0
MERGE=0
MERGE_APPLY=0
MERGE_CONFLICT_EXPLICIT=0
DRY_RUN=0
COPY_TEMPLATE=1

for arg in "$@"; do
  case "$arg" in
    --down) COMPOSE_DOWN=1 ;;
    --wizard) WIZARD=1 ;;
    --force) FORCE=1; MERGE_CONFLICT_EXPLICIT=1 ;;
    --merge) MERGE=1; MERGE_CONFLICT_EXPLICIT=1 ;;
    --merge-apply) MERGE=1; MERGE_APPLY=1; MERGE_CONFLICT_EXPLICIT=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --no-template) COPY_TEMPLATE=0 ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --*) echo "Opción desconocida: $arg (usa --help)" >&2; exit 1 ;;
    *)
      if [ -n "$TARGET_DIR" ]; then
        echo "ERROR: solo una ruta destino; sobra: $arg" >&2
        exit 1
      fi
      TARGET_DIR="$arg"
      ;;
  esac
done

# Sin ruta: panel Docker (o wizard en foreground si ORCHESTRATOR_PANEL_FOREGROUND=1).
if [ $# -eq 0 ]; then
  if [ "${ORCHESTRATOR_PANEL_FOREGROUND:-}" = "1" ]; then
    run_wizard_foreground
  else
    run_panel_docker
  fi
fi

if [ "$COMPOSE_DOWN" = "1" ] && [ -z "$TARGET_DIR" ]; then
  run_panel_docker
fi

if [ "$WIZARD" = "1" ] && [ -z "$TARGET_DIR" ]; then
  if [ "${ORCHESTRATOR_PANEL_FOREGROUND:-}" = "1" ]; then
    run_wizard_foreground
  else
    run_panel_docker
  fi
fi

if [ -z "$TARGET_DIR" ]; then
  echo "ERROR: indica ruta de proyecto: ./install.sh /ruta/proyecto" >&2
  echo "       o ejecuta sin argumentos para abrir el asistente: ./install.sh" >&2
  exit 1
fi

if [ "$MERGE_CONFLICT_EXPLICIT" = "0" ] && [ -n "${ASKBOX_API_URL:-}" ] && [ -n "${ASKBOX_ACCESS_TOKEN:-}" ]; then
  MERGE=1
  MERGE_APPLY=1
  echo "Askbox (ASKBOX_*): modo por defecto --merge-apply (desmarca en Avanzado del wizard o usa --force/--merge explícitos)."
fi

if [ "$FORCE" = "1" ] && [ "$MERGE" = "1" ]; then
  echo "ERROR: --force y --merge/--merge-apply son incompatibles." >&2
  exit 1
fi

TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || { echo "ERROR: no existe el directorio destino: $TARGET_DIR" >&2; exit 1; })"

if [ "$TARGET_DIR" = "$KIT_ROOT" ]; then
  echo "ERROR: no instales el kit sobre sí mismo ($KIT_ROOT)." >&2
  echo "       Usa ./install.sh sin argumentos (asistente en el navegador) o ./install.sh /ruta/a/tu-proyecto." >&2
  exit 1
fi

warn_if_root

echo "Kit origen:      $SCRIPT_DIR"
echo "Proyecto destino: $TARGET_DIR"
echo "Alcance: repos nuevos o existentes — lista cerrada de piezas del orquestador."
if [ "$MERGE" = "1" ]; then
  if [ "$MERGE_APPLY" = "1" ]; then
    echo "Modo: fusión asistida (--merge-apply)"
  else
    echo "Modo: fusión asistida (--merge)"
  fi
  if [ -z "${ASKBOX_API_URL:-}" ] || [ -z "${ASKBOX_ACCESS_TOKEN:-}" ]; then
    echo "Aviso: ASKBOX_API_URL / ASKBOX_ACCESS_TOKEN no configurados — fusión vía askbox no disponible;"
    echo "       se generarán .merge-proposal side-by-side; usa Cursor para fusionar o exporta las variables."
  fi
elif [ "$FORCE" = "1" ]; then
  echo "Modo: --force (backup + sobrescribe si difiere)"
else
  echo "Conflictos: skip (configura ASKBOX_* para --merge-apply por defecto, o usa --merge / --force)."
fi
[ "$DRY_RUN" = "1" ] && echo "Modo: --dry-run (no se escribe nada)"
echo

STAMP="$(date +%Y%m%d-%H%M%S)"
N_COPIED=0
N_SKIPPED=0
N_IDENTICAL=0
N_BACKED_UP=0
N_MERGE_PROPOSALS=0
N_MERGE_APPLIED=0

write_side_by_side_proposal() {
  local src="$1" dest="$2" proposal="$3"
  {
    echo "# Propuesta de fusión (manual / fallback Cursor)"
    echo "# Archivo: $dest"
    echo "# Generado: $STAMP — askbox no disponible o falló; revisa con el agente Cursor."
    echo
    echo "## Proyecto (actual)"
    echo '```'
    cat "$dest"
    echo '```'
    echo
    echo "## Kit (entrante)"
    echo '```'
    cat "$src"
    echo '```'
  } > "$proposal"
}

try_merge_conflict() {
  local src="$1" dest="$2"
  local proposal="${dest}.merge-proposal"

  if [ "$DRY_RUN" = "1" ]; then
    echo "  ~ merge (dry-run): propondría fusión para $dest"
    N_MERGE_PROPOSALS=$((N_MERGE_PROPOSALS + 1))
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  local merged=""
  local rc=0
  if [ -f "$MERGE_HELPER" ] && command -v python3 >/dev/null 2>&1; then
    set +e
    merged="$(python3 "$MERGE_HELPER" file "$src" "$dest" 2>/dev/null)"
    rc=$?
    set -e
  else
    rc=2
  fi

  if [ "$rc" -eq 0 ] && [ -n "$merged" ]; then
    printf '%s' "$merged" > "$proposal"
    echo "  ~ fusión askbox → $proposal"
    N_MERGE_PROPOSALS=$((N_MERGE_PROPOSALS + 1))
    if [ "$MERGE_APPLY" = "1" ]; then
      local backup="${dest}.bak-${STAMP}"
      cp -p "$dest" "$backup"
      printf '%s' "$merged" > "$dest"
      echo "  * aplicada fusión (backup $backup)"
      N_MERGE_APPLIED=$((N_MERGE_APPLIED + 1))
      N_BACKED_UP=$((N_BACKED_UP + 1))
    fi
    return 0
  fi

  echo "  ~ fallback Cursor: side-by-side en $proposal"
  write_side_by_side_proposal "$src" "$dest" "$proposal"
  N_MERGE_PROPOSALS=$((N_MERGE_PROPOSALS + 1))
  return 0
}

# copy_file SRC DEST
copy_file() {
  local src="$1" dest="$2"
  local dest_dir
  dest_dir="$(dirname "$dest")"

  if [ ! -f "$src" ]; then
    echo "  (omitido, no existe en el kit: $src)"
    return
  fi

  if [ -f "$dest" ]; then
    if cmp -s "$src" "$dest"; then
      echo "  = idéntico, sin cambios: $dest"
      N_IDENTICAL=$((N_IDENTICAL + 1))
      return
    fi
    if [ "$MERGE" = "1" ]; then
      try_merge_conflict "$src" "$dest"
      N_SKIPPED=$((N_SKIPPED + 1))
      return
    fi
    if [ "$FORCE" != "1" ]; then
      echo "  ! ya existe y difiere (usa --force, --merge o --merge-apply): $dest"
      N_SKIPPED=$((N_SKIPPED + 1))
      return
    fi
    local backup="${dest}.bak-${STAMP}"
    echo "  * backup: $dest -> $backup"
    if [ "$DRY_RUN" != "1" ]; then
      cp -p "$dest" "$backup"
    fi
    N_BACKED_UP=$((N_BACKED_UP + 1))
  fi

  echo "  + copiando: $dest"
  if [ "$DRY_RUN" != "1" ]; then
    mkdir -p "$dest_dir"
    cp -p "$src" "$dest"
  fi
  N_COPIED=$((N_COPIED + 1))
}

run_policy_analysis() {
  if [ "$MERGE" != "1" ] || [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  local report="$TARGET_DIR/.cursor/install-merge-policy-report.md"
  echo
  echo "## Análisis de directivas (askbox)"
  if [ ! -f "$MERGE_HELPER" ] || ! command -v python3 >/dev/null 2>&1; then
    echo "  (omitido: falta $MERGE_HELPER o python3)"
    return 0
  fi
  mkdir -p "$TARGET_DIR/.cursor"
  local out=""
  local rc=0
  set +e
  out="$(python3 "$MERGE_HELPER" policy "$TARGET_DIR" 2>/dev/null)"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    {
      echo "# Informe de directivas tras install --merge"
      echo "_Generado: $STAMP"
      echo
      printf '%s' "$out"
    } > "$report"
    echo "  + informe: $report"
    return 0
  fi
  local fallback="${report}.merge-proposal"
  {
    echo "# Análisis de directivas (pendiente)"
    echo "askbox no disponible ($rc). Abre este proyecto en Cursor (Auto) y pide revisar"
    echo "contradicciones entre *-conventions.mdc y las rules/skills del orquestador."
  } > "$fallback"
  echo "  ~ fallback: $fallback"
}

echo "## Rules portables"
copy_file "$SCRIPT_DIR/.cursor/rules/auto-orchestrator.mdc" "$TARGET_DIR/.cursor/rules/auto-orchestrator.mdc"
copy_file "$SCRIPT_DIR/.cursor/rules/multitask-ownership.mdc" "$TARGET_DIR/.cursor/rules/multitask-ownership.mdc"

echo
echo "## Skills portables"
copy_file "$SCRIPT_DIR/.cursor/skills/plan-implement-verify/SKILL.md" "$TARGET_DIR/.cursor/skills/plan-implement-verify/SKILL.md"
copy_file "$SCRIPT_DIR/.cursor/skills/askbox-first/SKILL.md" "$TARGET_DIR/.cursor/skills/askbox-first/SKILL.md"
copy_file "$SCRIPT_DIR/.cursor/skills/git-autopilot/SKILL.md" "$TARGET_DIR/.cursor/skills/git-autopilot/SKILL.md"

if [ "$COPY_TEMPLATE" = "1" ]; then
  echo
  echo "## Plantillas (inertes hasta que las adaptes)"
  copy_file "$SCRIPT_DIR/templates/project-conventions.mdc.template" "$TARGET_DIR/.cursor/rules/project-conventions.mdc.template"
  copy_file "$SCRIPT_DIR/templates/git-settings-screen.md" "$TARGET_DIR/.cursor/templates/git-settings-screen.md"
fi

if [ -f "$SCRIPT_DIR/.askbox/git-settings.json.example" ]; then
  echo
  echo "## Preferencias Git (opcional, sin secretos)"
  copy_file "$SCRIPT_DIR/.askbox/git-settings.json.example" "$TARGET_DIR/.askbox/git-settings.json.example"
  if [ ! -f "$TARGET_DIR/.askbox/git-settings.json" ]; then
    echo "  (tip: cp .askbox/git-settings.json.example .askbox/git-settings.json y ajusta preferencias)"
  fi
fi

run_policy_analysis

register_orchestrator_target() {
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  if [ "${ORCHESTRATOR_SKIP_REGISTER_TARGET:-}" = "1" ]; then
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "  (aviso: python3 no disponible — no se actualizó el registro de instalaciones)" >&2
    return 0
  fi
  local reg_helper="$SCRIPT_DIR/scripts/installations_registry.py"
  if [ ! -f "$reg_helper" ]; then
    return 0
  fi
  local flags_json="[]"
  if [ "$MERGE_APPLY" = "1" ]; then
    flags_json='["--merge-apply"]'
  elif [ "$MERGE" = "1" ]; then
    flags_json='["--merge"]'
  elif [ "$FORCE" = "1" ]; then
    flags_json='["--force"]'
  fi
  if python3 "$reg_helper" register "$TARGET_DIR" "$flags_json" 2>/dev/null; then
    echo "  + registro: .askbox/installations.json"
  fi
}

register_orchestrator_target

echo
echo "Resumen: $N_COPIED copiados, $N_IDENTICAL sin cambios, $N_SKIPPED en conflicto/saltados,"
echo "         $N_BACKED_UP con backup, $N_MERGE_PROPOSALS propuestas de fusión, $N_MERGE_APPLIED fusiones aplicadas."

if [ "$N_SKIPPED" -gt 0 ] && [ "$MERGE" != "1" ] && [ "$DRY_RUN" != "1" ]; then
  echo
  echo "Archivos distintos saltados. Opciones:"
  echo "  ./install.sh $TARGET_DIR --merge        # propuesta en *.merge-proposal (+ informe de directivas)"
  echo "  ./install.sh $TARGET_DIR --merge-apply  # aplica fusión askbox con backup"
  echo "  ./install.sh $TARGET_DIR --force        # kit puro con backup (sin fusión)"
fi

if [ "$N_MERGE_PROPOSALS" -gt 0 ] && [ "$MERGE_APPLY" != "1" ] && [ "$DRY_RUN" != "1" ]; then
  echo
  echo "Revisa los *.merge-proposal; si están bien: mv archivo.merge-proposal archivo"
  echo "o vuelve a ejecutar con --merge-apply (requiere ASKBOX_* para fusión automática)."
fi

echo
echo "Siguiente: convenciones en <proyecto>-conventions.mdc · Git capa B: docs/git-and-askbox.md"
