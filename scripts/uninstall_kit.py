#!/usr/bin/env python3
"""Quita del proyecto destino solo las piezas de la lista cerrada del kit."""
from __future__ import annotations

import sys
from pathlib import Path

from kit_manifest import KIT_TARGET_RELATIVE_PATHS


def uninstall_project(target: Path, *, dry_run: bool = False) -> dict[str, object]:
    root = target.resolve()
    if not root.is_dir():
        return {"ok": False, "error": f"no es un directorio: {root}"}

    removed: list[str] = []
    skipped: list[str] = []

    for rel in KIT_TARGET_RELATIVE_PATHS:
        path = root / rel
        if not path.is_file():
            skipped.append(rel)
            continue
        if dry_run:
            removed.append(rel)
            continue
        try:
            path.unlink()
            removed.append(rel)
        except OSError as e:
            return {"ok": False, "error": f"no se pudo borrar {path}: {e}"}

    # Directorios vacíos bajo .cursor/skills/* (solo si quedaron vacíos)
    if not dry_run:
        for rel in KIT_TARGET_RELATIVE_PATHS:
            parent = (root / rel).parent
            _prune_empty_dirs(parent, stop_at=root)

    return {"ok": True, "path": str(root), "removed": removed, "not_present": skipped}


def _prune_empty_dirs(directory: Path, stop_at: Path) -> None:
    current = directory.resolve()
    stop = stop_at.resolve()
    while current != stop and current.is_dir():
        try:
            if any(current.iterdir()):
                break
            current.rmdir()
        except OSError:
            break
        current = current.parent


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    if not args:
        print("uso: uninstall_kit.py [--dry-run] /ruta/proyecto", file=sys.stderr)
        return 2
    result = uninstall_project(Path(args[0]), dry_run=dry_run)
    if not result.get("ok"):
        print(result.get("error", "error"), file=sys.stderr)
        return 1
    for rel in result.get("removed") or []:
        print(f"  - {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
