"""Helpers for wizard API: estado de auto-update y cron."""
from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MARKER = "cursor-agent-orchestrator-auto-update"
DEFAULT_SCHEDULE = "0 6 * * *"


def kit_paths(root: Path) -> dict[str, Path]:
    askbox = root / ".askbox"
    return {
        "targets": askbox / "orchestrator-targets",
        "state": askbox / "auto-update.state",
        "log": askbox / "auto-update.log",
        "update_script": root / "scripts" / "auto-update-kit.sh",
        "cron_installer": root / "scripts" / "install-auto-update-cron.sh",
    }


def read_targets(path: Path) -> list[str]:
    if not path.is_file():
        return []
    out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def cron_line_for(root: Path, schedule: str = DEFAULT_SCHEDULE) -> str:
    paths = kit_paths(root)
    log = paths["log"]
    script = paths["update_script"]
    return (
        f"{schedule} ORCHESTRATOR_AUTO_UPDATE=1 {script} "
        f">> {log} 2>&1 # {MARKER}"
    )


def cron_installed() -> bool:
    try:
        proc = subprocess.run(
            ["crontab", "-l"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if proc.returncode != 0:
        return False
    return MARKER in (proc.stdout or "")


def read_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_preference_state(
    state_path: Path,
    *,
    enabled: bool,
    schedule: str = DEFAULT_SCHEDULE,
    merge: bool = True,
) -> None:
    """Persiste preferencia local (UI); no implica que cron esté instalado."""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = read_state(state_path) if merge and state_path.is_file() else {}
    data["enabled"] = enabled
    if enabled:
        data.setdefault("schedule", schedule)
    data["preference_updated_at"] = datetime.now(timezone.utc).isoformat()
    state_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def auto_update_enabled(root: Path) -> bool:
    """Preferencia de actualización automática (por defecto ON si nunca se configuró)."""
    state_path = kit_paths(root)["state"]
    if not state_path.is_file():
        return True
    state = read_state(state_path)
    if "enabled" in state:
        return bool(state["enabled"])
    return True


def auto_update_status(root: Path) -> dict[str, Any]:
    return {
        "ok": True,
        "enabled": auto_update_enabled(root),
        "cron_installed": cron_installed(),
    }


def set_auto_update_enabled(root: Path, enabled: bool, *, schedule: str = DEFAULT_SCHEDULE) -> dict[str, Any]:
    """Activa o desactiva la actualización automática (cron en el host cuando está disponible)."""
    paths = kit_paths(root)
    state_path = paths["state"]

    if not enabled:
        if _has_crontab():
            result = run_cron_installer(root, remove=True, schedule=schedule)
            if not result.get("ok"):
                return {
                    "ok": False,
                    "enabled": auto_update_enabled(root),
                    "error": result.get("error") or "no se pudo quitar el cron de auto-update",
                }
        _write_preference_state(state_path, enabled=False, schedule=schedule, merge=False)
        return {"ok": True, "enabled": False}

    _write_preference_state(state_path, enabled=True, schedule=schedule)
    if not _has_crontab():
        return {
            "ok": False,
            "enabled": True,
            "error": "actualización automática no disponible en este equipo (sin crontab)",
        }
    result = run_cron_installer(root, remove=False, schedule=schedule)
    ok = bool(result.get("ok"))
    payload: dict[str, Any] = {"ok": ok, "enabled": auto_update_enabled(root)}
    if not ok:
        payload["error"] = result.get("error") or "no se pudo cambiar la actualización automática"
    return payload


def bootstrap_auto_update(root: Path) -> None:
    """Primera vez en el host: preferencia ON y cron si crontab está disponible."""
    if os.environ.get("ORCHESTRATOR_IN_DOCKER", "").strip() == "1":
        return
    state_path = kit_paths(root)["state"]
    if state_path.is_file():
        if auto_update_enabled(root) and _has_crontab() and not cron_installed():
            run_cron_installer(root, remove=False, schedule=DEFAULT_SCHEDULE)
        return
    if not _has_crontab():
        return
    run_cron_installer(root, remove=False, schedule=DEFAULT_SCHEDULE)


def _has_crontab() -> bool:
    from shutil import which

    return which("crontab") is not None


def validate_schedule(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return DEFAULT_SCHEDULE
    # cinco campos cron habituales
    if not re.match(r"^(\S+\s+){4}\S+$", text):
        raise ValueError("schedule debe ser una línea cron de 5 campos (p. ej. 0 6 * * *)")
    return text


def run_cron_installer(root: Path, *, remove: bool = False, schedule: str) -> dict[str, Any]:
    installer = kit_paths(root)["cron_installer"]
    if not installer.is_file():
        return {"ok": False, "error": "install-auto-update-cron.sh no encontrado"}
    env = os.environ.copy()
    env["ORCHESTRATOR_AUTO_UPDATE_CRON_SCHEDULE"] = schedule
    args = ["bash", str(installer)]
    if remove:
        args.append("--remove")
    try:
        proc = subprocess.run(
            args,
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout instalando cron"}
    log = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        import sys

        sys.stderr.write(log)
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "log": log,
    }


def run_auto_update(root: Path) -> dict[str, Any]:
    script = kit_paths(root)["update_script"]
    if not script.is_file():
        return {"ok": False, "error": "auto-update-kit.sh no encontrado"}
    env = os.environ.copy()
    env.setdefault("ORCHESTRATOR_AUTO_UPDATE", "1")
    try:
        proc = subprocess.run(
            ["bash", str(script)],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=900,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "auto-update superó 900s"}
    log = (proc.stdout or "") + (proc.stderr or "")
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "log": log,
    }
