#!/usr/bin/env bash
# auto-update-kit.sh — actualiza el clone del kit (git pull --ff-only) y re-sincroniza
# proyectos listados en .askbox/orchestrator-targets vía ./install.sh (sin --force por defecto).
#
# Uso:
#   ./scripts/auto-update-kit.sh
#   ORCHESTRATOR_AUTO_UPDATE=0 ./scripts/auto-update-kit.sh   # no-op (salida 0)
#   ORCHESTRATOR_AUTO_UPDATE_FORCE=1 ...                    # install.sh --force en targets
#
# Variables:
#   ORCHESTRATOR_AUTO_UPDATE=0|1   (default 1 si no está definida en cron manual)
#   ORCHESTRATOR_AUTO_UPDATE_FORCE=1  pasa --force a install.sh en cada target
#   ORCHESTRATOR_AUTO_UPDATE_DRY_RUN=1  solo git, no install en targets
#
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS_FILE="$KIT_ROOT/.askbox/orchestrator-targets"
INSTALL_SH="$KIT_ROOT/install.sh"
LOG_PREFIX="[orchestrator-auto-update $(date -Iseconds)]"

log() {
  echo "$LOG_PREFIX $*"
}

_worktree_dirty() {
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    return 0
  fi
  if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    return 0
  fi
  return 1
}

# Fast-forward a upstream; si el worktree está sucio, reset (panel Docker sin commits locales) o stash+pull+pop.
_sync_kit_to_upstream() {
  local upstream="$1"
  local local_sha remote_sha ahead behind

  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "$upstream")"
  if [ "$local_sha" = "$remote_sha" ]; then
    return 0
  fi

  ahead="$(git rev-list --count "${upstream}..HEAD" 2>/dev/null || echo 0)"
  behind="$(git rev-list --count "HEAD..${upstream}" 2>/dev/null || echo 0)"

  if _worktree_dirty; then
    if [ "${ORCHESTRATOR_IN_DOCKER:-}" = "1" ] && [ "$ahead" = "0" ] && [ "$behind" != "0" ]; then
      log "Worktree sucio sin commits locales — git reset --hard $upstream (panel Docker)"
      git reset --hard "$upstream"
      return 0
    fi
    log "Worktree con cambios locales — git stash push -u antes del pull"
    git stash push -u -m "orchestrator-auto-update pre-pull $(date -Iseconds)"
    git pull --ff-only
    if git stash pop; then
      log "Stash reaplicado tras pull."
      return 0
    fi
    log "ERROR: conflicto al reaplicar stash; revisa git stash list en el clone del kit." >&2
    return 1
  fi

  git pull --ff-only
}

if [ "${ORCHESTRATOR_AUTO_UPDATE:-1}" = "0" ]; then
  log "ORCHESTRATOR_AUTO_UPDATE=0 — omitido."
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  log "ERROR: git no encontrado." >&2
  exit 1
fi

if [ ! -d "$KIT_ROOT/.git" ]; then
  log "ERROR: $KIT_ROOT no es un repositorio git." >&2
  exit 1
fi

cd "$KIT_ROOT"

log "git fetch origin"
git fetch origin

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
UPSTREAM="${ORCHESTRATOR_AUTO_UPDATE_UPSTREAM:-origin/$CURRENT_BRANCH}"

if ! git rev-parse --verify "$UPSTREAM" >/dev/null 2>&1; then
  log "Aviso: no existe $UPSTREAM; intentando pull de la rama actual sin upstream explícito."
  git pull --ff-only
else
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "$UPSTREAM")"
  if [ "$LOCAL" = "$REMOTE" ]; then
    log "Kit ya actualizado ($CURRENT_BRANCH @ ${LOCAL:0:8})."
  else
    log "Sincronizar kit con $UPSTREAM (ff-only)"
    _sync_kit_to_upstream "$UPSTREAM"
    log "Kit actualizado a $(git rev-parse --short HEAD)."
  fi
fi

if [ ! -x "$INSTALL_SH" ]; then
  chmod +x "$INSTALL_SH" 2>/dev/null || true
fi

if [ ! -f "$TARGETS_FILE" ]; then
  log "Sin $TARGETS_FILE — solo actualización del kit."
  exit 0
fi

INSTALL_FLAGS=()
if [ "${ORCHESTRATOR_AUTO_UPDATE_FORCE:-0}" = "1" ]; then
  INSTALL_FLAGS+=(--force)
fi
if [ "${ORCHESTRATOR_AUTO_UPDATE_DRY_RUN:-0}" = "1" ]; then
  log "ORCHESTRATOR_AUTO_UPDATE_DRY_RUN=1 — no se ejecuta install.sh en targets."
  exit 0
fi

N_OK=0
N_FAIL=0

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -z "$line" ] && continue

  if [ ! -d "$line" ]; then
    log "SKIP target (no existe): $line"
    N_FAIL=$((N_FAIL + 1))
    continue
  fi

  log "install.sh → $line ${INSTALL_FLAGS[*]:-}"
  if bash "$INSTALL_SH" "$line" "${INSTALL_FLAGS[@]}"; then
    N_OK=$((N_OK + 1))
  else
    log "ERROR install en $line (código $?)"
    N_FAIL=$((N_FAIL + 1))
  fi
done < "$TARGETS_FILE"

log "Targets: $N_OK ok, $N_FAIL fallidos/saltados."
[ "$N_FAIL" -eq 0 ] || exit 1
