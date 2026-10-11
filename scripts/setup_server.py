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

ALLOWED_INSTALL_FLAGS = frozenset(
    {
        "--force",
        "--merge",
        "--merge-apply",
        "--dry-run",
        "--no-template",
    }
)


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
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/install":
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

        try:
            target = validate_install_path(data.get("path", ""))
            flags = normalize_flags(data.get("flags"))
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
                env=os.environ.copy(),
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
    print("  API:    POST /api/install  {\"path\": \"/ruta/absoluta\", \"flags\": []}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDetenido.")
        httpd.server_close()


if __name__ == "__main__":
    main()
