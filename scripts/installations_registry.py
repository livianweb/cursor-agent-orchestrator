"""Registro local de instalaciones (.askbox/installations.json), gitignored."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

INSTALLATIONS_FILE = "installations.json"
LEGACY_TARGETS = "orchestrator-targets"


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def token_last4(token: str | None) -> str | None:
    """Últimos 4 caracteres del token; nunca devuelve el valor completo."""
    t = (token or "").strip()
    if not t:
        return None
    return t[-4:] if len(t) > 4 else t


def installations_path(kit_root: Path) -> Path:
    return kit_root / ".askbox" / INSTALLATIONS_FILE


def legacy_targets_path(kit_root: Path) -> Path:
    return kit_root / ".askbox" / LEGACY_TARGETS


def _empty_doc() -> dict[str, Any]:
    return {"version": 1, "installations": []}


def load(kit_root: Path) -> dict[str, Any]:
    path = installations_path(kit_root)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("installations"), list):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    migrated = _migrate_legacy_targets(kit_root)
    if migrated:
        return migrated
    return _empty_doc()


def save(kit_root: Path, doc: dict[str, Any]) -> None:
    path = installations_path(kit_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sync_legacy_targets(kit_root, doc)


def _migrate_legacy_targets(kit_root: Path) -> dict[str, Any] | None:
    legacy = legacy_targets_path(kit_root)
    if not legacy.is_file():
        return None
    paths: list[str] = []
    for line in legacy.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            paths.append(line)
    if not paths:
        return None
    doc = _empty_doc()
    now = _utc_now()
    for p in paths:
        doc["installations"].append(
            {
                "path": p,
                "installed_at": now,
                "flags": [],
                "auto_update": True,
                "migrated_from": LEGACY_TARGETS,
            }
        )
    save(kit_root, doc)
    return doc


def sync_legacy_targets(kit_root: Path, doc: dict[str, Any] | None = None) -> None:
    """Mantiene orchestrator-targets para auto-update-kit.sh."""
    if doc is None:
        doc = load(kit_root)
    lines: list[str] = []
    for entry in doc.get("installations") or []:
        if not isinstance(entry, dict):
            continue
        if entry.get("auto_update") is False:
            continue
        path = (entry.get("path") or "").strip()
        if path:
            lines.append(path)
    target = legacy_targets_path(kit_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    if lines:
        target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    elif target.is_file():
        target.unlink()


def list_installations(kit_root: Path) -> list[dict[str, Any]]:
    doc = load(kit_root)
    out: list[dict[str, Any]] = []
    for entry in doc.get("installations") or []:
        if not isinstance(entry, dict):
            continue
        path = (entry.get("path") or "").strip()
        if not path:
            continue
        exists = Path(path).is_dir()
        askbox_url = entry.get("askbox_api_url")
        if askbox_url is not None and not isinstance(askbox_url, str):
            askbox_url = ""
        out.append(
            {
                "path": path,
                "installed_at": entry.get("installed_at"),
                "flags": entry.get("flags") or [],
                "auto_update": entry.get("auto_update", True) is not False,
                "kit_fingerprint": entry.get("kit_fingerprint"),
                "askbox_api_url": (askbox_url or "").strip() if askbox_url is not None else "",
                "askbox_token_last4": entry.get("askbox_token_last4") or None,
                "status": "ok" if exists else "missing",
            }
        )
    return out


def _apply_askbox_fields(
    entry: dict[str, Any],
    *,
    askbox_api_url: str | None = None,
    askbox_access_token: str | None = None,
    clear_askbox: bool = False,
) -> None:
    if clear_askbox:
        entry["askbox_api_url"] = ""
        entry.pop("askbox_token_last4", None)
        return
    if askbox_api_url is not None:
        entry["askbox_api_url"] = askbox_api_url.strip()
    last4 = token_last4(askbox_access_token)
    if last4 is not None:
        entry["askbox_token_last4"] = last4


def upsert_installation(
    kit_root: Path,
    project_path: str,
    *,
    flags: list[str] | None = None,
    auto_update: bool = True,
    kit_fingerprint: str | None = None,
    askbox_api_url: str | None = None,
    askbox_access_token: str | None = None,
) -> dict[str, Any]:
    doc = load(kit_root)
    path = str(Path(project_path).resolve())
    flags = flags or []
    now = _utc_now()
    installations = doc.setdefault("installations", [])
    found = False
    for entry in installations:
        if not isinstance(entry, dict):
            continue
        if (entry.get("path") or "").strip() == path:
            entry["installed_at"] = now
            entry["flags"] = flags
            entry["auto_update"] = auto_update
            if kit_fingerprint:
                entry["kit_fingerprint"] = kit_fingerprint
            _apply_askbox_fields(
                entry,
                askbox_api_url=askbox_api_url,
                askbox_access_token=askbox_access_token,
            )
            found = True
            break
    if not found:
        new_entry: dict[str, Any] = {
            "path": path,
            "installed_at": now,
            "flags": flags,
            "auto_update": auto_update,
            "kit_fingerprint": kit_fingerprint,
        }
        _apply_askbox_fields(
            new_entry,
            askbox_api_url=askbox_api_url if askbox_api_url is not None else "",
            askbox_access_token=askbox_access_token,
        )
        installations.append(new_entry)
    save(kit_root, doc)
    return {"ok": True, "path": path}


def update_installation_askbox(
    kit_root: Path,
    project_path: str,
    *,
    askbox_api_url: str | None = None,
    askbox_access_token: str | None = None,
    clear_askbox: bool = False,
) -> dict[str, Any]:
    """Actualiza metadatos askbox de una instalación sin tocar installed_at."""
    doc = load(kit_root)
    path = str(Path(project_path).resolve())
    for entry in doc.get("installations") or []:
        if not isinstance(entry, dict):
            continue
        if (entry.get("path") or "").strip() != path:
            continue
        _apply_askbox_fields(
            entry,
            askbox_api_url=askbox_api_url,
            askbox_access_token=askbox_access_token,
            clear_askbox=clear_askbox,
        )
        save(kit_root, doc)
        return {"ok": True, "path": path}
    return {"ok": False, "error": "no estaba en el registro", "path": path}


def get_installation_entry(kit_root: Path, project_path: str) -> dict[str, Any] | None:
    path = str(Path(project_path).resolve())
    for entry in load(kit_root).get("installations") or []:
        if isinstance(entry, dict) and (entry.get("path") or "").strip() == path:
            return entry
    return None


def remove_installation(kit_root: Path, project_path: str) -> dict[str, Any]:
    doc = load(kit_root)
    path = str(Path(project_path).resolve())
    before = len(doc.get("installations") or [])
    doc["installations"] = [
        e
        for e in (doc.get("installations") or [])
        if isinstance(e, dict) and (e.get("path") or "").strip() != path
    ]
    if len(doc["installations"]) == before:
        return {"ok": False, "error": "no estaba en el registro", "path": path}
    save(kit_root, doc)
    return {"ok": True, "path": path}


def cli_main(argv: list[str]) -> int:
    kit_root = Path(__file__).resolve().parent.parent
    if len(argv) < 2:
        print("uso: installations_registry.py register|remove PATH [flags-json]", file=sys.stderr)
        return 2
    cmd = argv[1]
    raw_path = argv[2] if len(argv) > 2 else ""
    if cmd == "register":
        flags: list[str] = []
        if len(argv) > 3:
            flags = json.loads(argv[3])
        scripts = Path(__file__).resolve().parent
        if str(scripts) not in sys.path:
            sys.path.insert(0, str(scripts))
        from kit_manifest import kit_fingerprint

        fp = kit_fingerprint(kit_root)
        upsert_installation(kit_root, raw_path, flags=flags, kit_fingerprint=fp)
        return 0
    if cmd == "remove":
        result = remove_installation(kit_root, raw_path)
        return 0 if result.get("ok") else 1
    print(f"comando desconocido: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(cli_main(sys.argv))
