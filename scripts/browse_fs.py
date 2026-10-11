"""Listado seguro de directorios para el wizard (solo en el host del kit)."""
from __future__ import annotations

import os
from pathlib import Path

# No listar pseudo-fs ni rutas típicamente sensibles como raíz de navegación.
BLOCKED_PREFIXES = (
    "/proc",
    "/sys",
    "/dev",
    "/run/user",
)

HIDDEN_SKIP = frozenset({".ssh", ".gnupg", ".aws", ".config"})


def default_browse_start() -> Path:
    home = Path.home()
    for candidate in (Path("/srv"), home, Path("/")):
        try:
            if candidate.is_dir():
                return candidate.resolve()
        except OSError:
            continue
    return Path("/").resolve()


def _is_blocked(resolved: Path) -> bool:
    text = str(resolved)
    for prefix in BLOCKED_PREFIXES:
        if text == prefix or text.startswith(prefix + "/"):
            return True
    return False


def resolve_browse_path(raw: str | None, *, kit_root: Path) -> Path:
    if not raw or not str(raw).strip():
        return default_browse_start()
    text = str(raw).strip()
    if "\0" in text:
        raise ValueError("path inválido")
    p = Path(text).expanduser()
    if not p.is_absolute():
        raise ValueError("path debe ser absoluto")
    try:
        resolved = p.resolve(strict=False)
    except (OSError, RuntimeError) as e:
        raise ValueError(f"path no resoluble: {e}") from e
    if _is_blocked(resolved):
        raise ValueError("ruta no permitida")
    if not resolved.exists():
        raise ValueError("el directorio no existe")
    if not resolved.is_dir():
        raise ValueError("debe ser un directorio")
    return resolved


def list_subdirs(directory: Path, *, kit_root: Path) -> dict[str, object]:
    current = directory.resolve()
    if _is_blocked(current):
        raise ValueError("ruta no permitida")

    parent: str | None = None
    if current != current.parent:
        parent_path = current.parent.resolve()
        if not _is_blocked(parent_path):
            parent = str(parent_path)

    entries: list[dict[str, str]] = []
    try:
        names = sorted(os.listdir(current), key=str.lower)
    except OSError as e:
        raise ValueError(f"no se puede leer el directorio: {e}") from e

    kit_resolved = kit_root.resolve()
    for name in names:
        if name.startswith("."):
            continue
        if name in HIDDEN_SKIP:
            continue
        child = current / name
        try:
            if not child.is_dir():
                continue
            resolved_child = child.resolve(strict=False)
        except OSError:
            continue
        if _is_blocked(resolved_child):
            continue
        entries.append({"name": name, "path": str(resolved_child)})

    selectable = current != kit_resolved
    return {
        "ok": True,
        "path": str(current),
        "parent": parent,
        "selectable": selectable,
        "kit_root": str(kit_resolved),
        "entries": entries,
    }
