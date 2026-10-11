"""Estado remoto del clone del kit y pull --ff-only (sin reinstalar targets)."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from kit_manifest import kit_fingerprint


def _git(kit_root: Path, *args: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(kit_root),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _short(sha: str) -> str:
    s = (sha or "").strip()
    return s[:12] if len(s) > 12 else s


def user_facing_kit_error(log: str) -> str:
    """Mensaje breve para la UI del panel (sin volcar stderr crudo de git)."""
    text = (log or "").strip()
    if not text:
        return "No se pudo actualizar el kit del orquestador."
    lower = text.lower()
    if "would be overwritten by merge" in lower or "please commit your changes" in lower:
        return (
            "No se pudo actualizar el kit: el clone del orquestador tiene cambios locales sin commitear. "
            "En el servidor, alinea el directorio con git (commit, stash o reset) y vuelve a pulsar «Actualizar kit»."
        )
    if "not possible to fast-forward" in lower or "divergent branches" in lower:
        return (
            "No se pudo actualizar el kit: la rama local no puede avanzar en fast-forward "
            "(hay commits locales que no están en remoto)."
        )
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line or line.startswith("[orchestrator-auto-update"):
            continue
        if line.lower().startswith("error:"):
            return line[:320]
        return line[:320]
    return "No se pudo actualizar el kit. Revisa los logs del panel en el servidor."


def kit_git_status(kit_root: Path, *, fetch: bool = True) -> dict[str, Any]:
    """Compara HEAD local con origin/<rama actual>."""
    root = kit_root.resolve()
    fp = kit_fingerprint(root)
    if not (root / ".git").exists():
        return {
            "ok": False,
            "error": "el kit no es un repositorio git",
            "kit_fingerprint": fp,
        }

    branch_proc = _git(root, "rev-parse", "--abbrev-ref", "HEAD", timeout=30)
    if branch_proc.returncode != 0:
        return {
            "ok": False,
            "error": (branch_proc.stderr or branch_proc.stdout or "no se pudo leer la rama").strip(),
            "kit_fingerprint": fp,
        }
    branch = (branch_proc.stdout or "").strip()
    upstream = f"origin/{branch}"

    fetch_error: str | None = None
    if fetch:
        fetch_proc = _git(root, "fetch", "origin", timeout=180)
        if fetch_proc.returncode != 0:
            fetch_error = (fetch_proc.stderr or fetch_proc.stdout or "git fetch falló").strip()

    local_proc = _git(root, "rev-parse", "HEAD", timeout=30)
    if local_proc.returncode != 0:
        return {"ok": False, "error": "no se pudo leer HEAD", "kit_fingerprint": fp}
    local_full = (local_proc.stdout or "").strip()

    remote_proc = _git(root, "rev-parse", "--verify", upstream, timeout=30)
    if remote_proc.returncode != 0:
        payload: dict[str, Any] = {
            "ok": True,
            "branch": branch,
            "upstream": upstream,
            "local_sha": _short(local_full),
            "local_full": local_full,
            "remote_sha": None,
            "updates_available": False,
            "behind": 0,
            "ahead": 0,
            "kit_fingerprint": fp,
            "up_to_date": True,
        }
        if fetch_error:
            payload["fetch_warning"] = fetch_error
            payload["upstream_missing"] = True
        return payload

    remote_full = (remote_proc.stdout or "").strip()
    behind = 0
    ahead = 0
    if local_full != remote_full:
        behind_proc = _git(root, "rev-list", "--count", f"HEAD..{upstream}", timeout=60)
        ahead_proc = _git(root, "rev-list", "--count", f"{upstream}..HEAD", timeout=60)
        if behind_proc.returncode == 0:
            behind = int((behind_proc.stdout or "0").strip() or "0")
        if ahead_proc.returncode == 0:
            ahead = int((ahead_proc.stdout or "0").strip() or "0")

    updates = behind > 0
    return {
        "ok": True,
        "branch": branch,
        "upstream": upstream,
        "local_sha": _short(local_full),
        "local_full": local_full,
        "remote_sha": _short(remote_full),
        "remote_full": remote_full,
        "updates_available": updates,
        "behind": behind,
        "ahead": ahead,
        "up_to_date": not updates,
        "kit_fingerprint": fp,
        **({"fetch_warning": fetch_error} if fetch_error else {}),
    }


def run_kit_pull_only(kit_root: Path) -> dict[str, Any]:
    """git pull --ff-only del kit; no ejecuta install.sh en targets."""
    root = kit_root.resolve()
    script = root / "scripts" / "auto-update-kit.sh"
    if not script.is_file():
        return {"ok": False, "error": "auto-update-kit.sh no encontrado"}

    env = os.environ.copy()
    env["ORCHESTRATOR_AUTO_UPDATE"] = "1"
    env["ORCHESTRATOR_AUTO_UPDATE_DRY_RUN"] = "1"
    env.setdefault("ORCHESTRATOR_IN_DOCKER", os.environ.get("ORCHESTRATOR_IN_DOCKER", ""))
    try:
        proc = subprocess.run(
            ["bash", str(script)],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=300,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "actualización superó 300s"}

    log = (proc.stdout or "") + (proc.stderr or "")
    status = kit_git_status(root, fetch=False)
    in_docker = os.environ.get("ORCHESTRATOR_IN_DOCKER", "").strip() == "1"
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "log": log,
        "panel_restart_recommended": in_docker and proc.returncode == 0,
        **{k: status[k] for k in (
            "local_sha",
            "remote_sha",
            "updates_available",
            "up_to_date",
            "kit_fingerprint",
            "branch",
        ) if k in status},
        **(
            {
                "user_error": user_facing_kit_error(log),
                "error": user_facing_kit_error(log),
            }
            if proc.returncode != 0
            else {}
        ),
    }
