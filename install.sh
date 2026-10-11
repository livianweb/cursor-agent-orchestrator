#!/usr/bin/env bash
# install.sh — instala el paradigma de orquestación Cursor (Auto + Multitask)
# en un proyecto destino, sin pisar a ciegas lo que ya exista.
#
# Uso:
#   ./install.sh [RUTA_PROYECTO_DESTINO] [--force] [--dry-run] [--no-template]
#
# - RUTA_PROYECTO_DESTINO: por defecto, el directorio actual (cwd).
# - --force: si un archivo destino ya existe y difiere del origen, se hace backup
#            (timestamp) y se sobrescribe. Sin --force, esos archivos se SALTAN.
# - --dry-run: muestra qué haría, sin copiar ni crear nada.
# - --no-template: no copia la plantilla de convenciones (templates/project-conventions.mdc.template).
#
# Idempotente: si el archivo destino es idéntico al origen, no hace nada (ni backup).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET_DIR="."
FORCE=0
DRY_RUN=0
COPY_TEMPLATE=1

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --no-template) COPY_TEMPLATE=0 ;;
    -h|--help)
      sed -n '1,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      TARGET_DIR="$arg"
      ;;
  esac
done

TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || { echo "ERROR: no existe el directorio destino: $TARGET_DIR" >&2; exit 1; })"

echo "Kit origen:      $SCRIPT_DIR"
echo "Proyecto destino: $TARGET_DIR"
[ "$FORCE" = "1" ] && echo "Modo: --force (sobrescribe con backup si difiere)"
[ "$DRY_RUN" = "1" ] && echo "Modo: --dry-run (no se escribe nada)"
echo

STAMP="$(date +%Y%m%d-%H%M%S)"
N_COPIED=0
N_SKIPPED=0
N_IDENTICAL=0
N_BACKED_UP=0

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
    if [ "$FORCE" != "1" ]; then
      echo "  ! ya existe y difiere (usa --force para sobrescribir): $dest"
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

echo "## Rules portables"
copy_file "$SCRIPT_DIR/.cursor/rules/auto-orchestrator.mdc" "$TARGET_DIR/.cursor/rules/auto-orchestrator.mdc"
copy_file "$SCRIPT_DIR/.cursor/rules/multitask-ownership.mdc" "$TARGET_DIR/.cursor/rules/multitask-ownership.mdc"

echo
echo "## Skills portables"
copy_file "$SCRIPT_DIR/.cursor/skills/plan-implement-verify/SKILL.md" "$TARGET_DIR/.cursor/skills/plan-implement-verify/SKILL.md"

if [ "$COPY_TEMPLATE" = "1" ]; then
  echo
  echo "## Plantilla de convenciones propias (inerte hasta que la renombres)"
  copy_file "$SCRIPT_DIR/templates/project-conventions.mdc.template" "$TARGET_DIR/.cursor/rules/project-conventions.mdc.template"
fi

echo
echo "Resumen: $N_COPIED copiados, $N_IDENTICAL sin cambios, $N_SKIPPED saltados (ya existían y difieren), $N_BACKED_UP con backup."

if [ "$N_SKIPPED" -gt 0 ] && [ "$DRY_RUN" != "1" ]; then
  echo
  echo "Algunos archivos ya existían con contenido distinto y se saltaron."
  echo "Revísalos manualmente o vuelve a ejecutar con --force para sobrescribir (se hace backup .bak-${STAMP})."
fi

echo
echo "Siguiente paso: renombra $TARGET_DIR/.cursor/rules/project-conventions.mdc.template"
echo "a algo como <tu-proyecto>-conventions.mdc y rellena tus convenciones propias."
