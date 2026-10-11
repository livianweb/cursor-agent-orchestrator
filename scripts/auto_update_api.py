"""Helpers for wizard API: estado de auto-update y cron."""
from __future__ import annotations

import json
import os
import re
import subprocess
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


def auto_update_status(root: Path) -> dict[str, Any]:
    paths = kit_paths(root)
    state = read_state(paths["state"])
    schedule = str(state.get("schedule") or DEFAULT_SCHEDULE)
    targets = read_targets(paths["targets"])
    installed = cron_installed()
    return {
        "ok": True,
        "cron_installed": installed,
        "enabled": installed and bool(state.get("enabled", True)),
        "schedule": schedule,
        "cron_line": cron_line_for(root, schedule),
        "log_file": str(paths["log"]),
        "targets_file": str(paths["targets"]),
        "targets": targets,
        "crontab_available": _has_crontab(),
    }


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
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "log": log,
        "status": auto_update_status(root),
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
