#!/usr/bin/env python3
"""Servidor del wizard: estáticos en setup/ + POST /api/install.

Seguridad: por defecto escucha en LAN (CONFIGURE_HOST=0.0.0.0). Cualquiera en la red
local puede invocar /api/install y escribir en rutas del host. Mitigación opcional:
export CONFIGURE_TOKEN=... y enviar cabecera X-Configure-Token o Authorization: Bearer.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    from http.server import SimpleHTTPRequestHandler
except ImportError:
    from http.server import BaseHTTPRequestHandler as SimpleHTTPRequestHandler  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
SETUP_DIR = ROOT / "setup"
INSTALL_SH = ROOT / "install.sh"

sys.path.insert(0, str(ROOT / "scripts"))
from auto_update_api import (  # noqa: E402
    auto_update_status,
    run_auto_update,
    run_cron_installer,
    validate_schedule,
)

ALLOWED_INSTALL_FLAGS = frozenset(
    {
        "--force",
        "--merge",
        "--merge-apply",
        "--dry-run",
        "--no-template",
    }
)


def _askbox_env_complete(env: dict[str, str]) -> bool:
    url = (env.get("ASKBOX_API_URL") or "").strip()
    token = (env.get("ASKBOX_ACCESS_TOKEN") or "").strip()
    return bool(url and token)


def _install_env_from_body(data: dict[str, Any]) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items()}
    url = data.get("askbox_api_url")
    token = data.get("askbox_access_token")
    if isinstance(url, str) and url.strip():
        env["ASKBOX_API_URL"] = url.strip()
    if isinstance(token, str) and token.strip():
        env["ASKBOX_ACCESS_TOKEN"] = token.strip()
    return env


def _default_install_flags_if_omitted(env: dict[str, str]) -> list[str]:
    """Si el cliente no envía ``flags``, usar --merge-apply con askbox completo."""
    if _askbox_env_complete(env):
        return ["--merge-apply"]
    return []


def _lan_ip() -> str:
    import socket

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("1.1.1.1", 80))
            return s.getsockname()[0]
    except OSError:
        return ""


def validate_install_path(raw: str) -> Path:
    if not raw or not isinstance(raw, str):
        raise ValueError("path es obligatorio")
    text = raw.strip()
    if not text:
        raise ValueError("path vacío")
    if "\0" in text:
        raise ValueError("path inválido")

    p = Path(text).expanduser()
    if not p.is_absolute():
        raise ValueError("path debe ser absoluto (p. ej. /home/user/mi-app)")

    try:
        resolved = p.resolve(strict=False)
    except (OSError, RuntimeError) as e:
        raise ValueError(f"path no resoluble: {e}") from e

    if resolved.exists():
        if not resolved.is_dir():
            raise ValueError("path debe ser un directorio")
    else:
        parent = resolved.parent
        if not parent.exists():
            raise ValueError(f"no se puede crear: el directorio padre no existe ({parent})")

    kit_root = ROOT.resolve()
    if resolved == kit_root:
        raise ValueError(
            "no instales en la raíz del kit del orquestador; "
            "usa una ruta de proyecto distinta (p. ej. /ruta/a/tu-app)"
        )

    return resolved


def normalize_flags(flags: Any) -> list[str]:
    if flags is None:
        return []
    if not isinstance(flags, list):
        raise ValueError("flags debe ser una lista")
    out: list[str] = []
    for f in flags:
        if not isinstance(f, str) or not f.startswith("--"):
            raise ValueError(f"flag inválida: {f!r}")
        if f not in ALLOWED_INSTALL_FLAGS:
            raise ValueError(f"flag no permitida: {f}")
        out.append(f)
    if "--force" in out and ("--merge" in out or "--merge-apply" in out):
        raise ValueError("--force es incompatible con --merge / --merge-apply")
    return out


class SetupHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(SETUP_DIR), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_token(self) -> bool:
        token = os.environ.get("CONFIGURE_TOKEN", "").strip()
        if not token:
            return True
        got = self.headers.get("X-Configure-Token", "").strip()
        auth = self.headers.get("Authorization", "").strip()
        if auth.lower().startswith("bearer "):
            got = auth[7:].strip() if not got else got
        return got == token

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/api/health":
            self._send_json(200, {"ok": True, "service": "cursor-agent-orchestrator-setup"})
            return
        if self.path.rstrip("/") == "/api/auto-update":
            self._send_json(200, auto_update_status(ROOT))
            return
        if self.path.rstrip("/") == "/api/setup-config":
            url = os.environ.get("ASKBOX_API_URL", "").strip()
            token_ok = bool(os.environ.get("ASKBOX_ACCESS_TOKEN", "").strip())
            complete = bool(url and token_ok)
            self._send_json(
                200,
                {
                    "askbox_api_url": url,
                    "askbox_token_configured": token_ok,
                    "default_merge_apply": complete,
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path not in ("/api/install", "/api/auto-update"):
            self.send_error(404)
            return
        if not self._check_token():
            self._send_json(401, {"ok": False, "error": "no autorizado (CONFIGURE_TOKEN)"})
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > 65536:
            self._send_json(413, {"ok": False, "error": "body demasiado grande"})
            return
        try:
            raw = self.rfile.read(length).decode("utf-8")
            data = json.loads(raw) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"ok": False, "error": "JSON inválido"})
            return

        if self.path == "/api/auto-update":
            self._handle_auto_update_post(data)
            return

        try:
            target = validate_install_path(data.get("path", ""))
            install_env = _install_env_from_body(data)
            if "flags" in data:
                flags = normalize_flags(data.get("flags"))
            else:
                flags = _default_install_flags_if_omitted(install_env)
        except ValueError as e:
            self._send_json(400, {"ok": False, "error": str(e)})
            return

        if not target.exists():
            try:
                target.mkdir(parents=True, exist_ok=False)
            except OSError as e:
                self._send_json(400, {"ok": False, "error": f"no se pudo crear el directorio: {e}"})
                return

        if not INSTALL_SH.is_file():
            self._send_json(500, {"ok": False, "error": "install.sh no encontrado en el kit"})
            return

        cmd = ["bash", str(INSTALL_SH), str(target)] + flags
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                timeout=600,
                env=install_env,
            )
        except subprocess.TimeoutExpired:
            self._send_json(504, {"ok": False, "error": "install superó el tiempo límite (600s)"})
            return

        log = (proc.stdout or "") + (proc.stderr or "")
        ok = proc.returncode == 0
        self._send_json(
            200 if ok else 500,
            {
                "ok": ok,
                "exit_code": proc.returncode,
                "path": str(target),
                "flags": flags,
                "log": log,
            },
        )

    def _handle_auto_update_post(self, data: dict[str, Any]) -> None:
        action = data.get("action")
        if not isinstance(action, str) or not action.strip():
            self._send_json(400, {"ok": False, "error": "action es obligatorio"})
            return
        action = action.strip()
        try:
            schedule = validate_schedule(str(data.get("schedule") or ""))
        except ValueError as e:
            self._send_json(400, {"ok": False, "error": str(e)})
            return

        if action == "install_cron":
            result = run_cron_installer(ROOT, remove=False, schedule=schedule)
        elif action == "remove_cron":
            result = run_cron_installer(ROOT, remove=True, schedule=schedule)
        elif action == "run_now":
            result = run_auto_update(ROOT)
        else:
            self._send_json(400, {"ok": False, "error": f"action desconocida: {action}"})
            return

        status = 200 if result.get("ok") else 500
        self._send_json(status, result)


def main() -> None:
    host = os.environ.get("CONFIGURE_HOST", "0.0.0.0")
    port = int(os.environ.get("CONFIGURE_PORT", "8765"))

    if not SETUP_DIR.is_dir():
        print(f"ERROR: no existe {SETUP_DIR}", file=sys.stderr)
        sys.exit(1)

    httpd = ThreadingHTTPServer((host, port), SetupHandler)
    print("cursor-agent-orchestrator — wizard de configuración")
    print(f"  Sirviendo setup en {host}:{port} (Ctrl+C para parar)")
    print(f"  Local:  http://127.0.0.1:{port}/")
    lan = _lan_ip()
    if lan and host not in ("127.0.0.1", "localhost"):
        print(f"  Red:    http://{lan}:{port}/  (otros equipos en la LAN)")
    elif host in ("127.0.0.1", "localhost"):
        print("  (solo localhost; para LAN: CONFIGURE_HOST=0.0.0.0 ./install.sh)")
    if os.environ.get("CONFIGURE_TOKEN", "").strip():
        print("  Auth:   CONFIGURE_TOKEN activo (cabecera X-Configure-Token)")
    else:
        print("  Aviso:  sin CONFIGURE_TOKEN — cualquier cliente en la LAN puede llamar a POST /api/install")
    print("  API:    GET  /api/setup-config  (askbox en env del servidor, sin token)")
    print("          POST /api/install  {\"path\": \"/ruta/absoluta\", \"flags\": [...]}")
    print("          (si omites flags y ASKBOX_* está completo en env → --merge-apply por defecto)")
    print("          GET/POST /api/auto-update  (cron diario del kit)")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDetenido.")
        httpd.server_close()


if __name__ == "__main__":
    main()
