"""Lista cerrada de piezas del kit (install / uninstall)."""
from __future__ import annotations

import hashlib
from pathlib import Path

# Rutas relativas al proyecto destino que install.sh copia y uninstall puede quitar.
# No incluye *-conventions.mdc adaptadas por el usuario (solo plantillas inertes).
KIT_TARGET_RELATIVE_PATHS: tuple[str, ...] = (
    ".cursor/rules/auto-orchestrator.mdc",
    ".cursor/rules/multitask-ownership.mdc",
    ".cursor/skills/plan-implement-verify/SKILL.md",
    ".cursor/skills/askbox-first/SKILL.md",
    ".cursor/skills/git-autopilot/SKILL.md",
    ".cursor/rules/project-conventions.mdc.template",
    ".cursor/templates/git-settings-screen.md",
    ".askbox/git-settings.json.example",
)


def kit_fingerprint(kit_root: Path) -> str:
    """Huella corta del contenido portable del kit (para API / registro)."""
    h = hashlib.sha256()
    root = kit_root.resolve()
    for rel in sorted(KIT_TARGET_RELATIVE_PATHS):
        src = root / rel
        if not src.is_file():
            continue
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(src.read_bytes())
    return h.hexdigest()[:16]


def target_paths_for(project_root: Path) -> list[Path]:
    base = project_root.resolve()
    return [base / rel for rel in KIT_TARGET_RELATIVE_PATHS]
