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
from urllib.parse import parse_qs, urlparse

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
    set_auto_update_enabled,
)
from installations_registry import (  # noqa: E402
    list_installations,
    remove_installation,
    upsert_installation,
)
from kit_manifest import kit_fingerprint  # noqa: E402
from browse_fs import list_subdirs, resolve_browse_path  # noqa: E402
from uninstall_kit import uninstall_project  # noqa: E402

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
        parsed = urlparse(self.path)
        path_only = parsed.path.rstrip("/")

        if path_only == "/api/health":
            self._send_json(200, {"ok": True, "service": "cursor-agent-orchestrator-setup"})
            return
        if path_only == "/api/auto-update":
            self._send_json(200, auto_update_status(ROOT))
            return
        if path_only == "/api/browse":
            if not self._check_token():
                self._send_json(401, {"ok": False, "error": "no autorizado (CONFIGURE_TOKEN)"})
                return
            qs = parse_qs(parsed.query)
            raw = (qs.get("path") or [""])[0]
            try:
                directory = resolve_browse_path(raw if raw else None, kit_root=ROOT)
                payload = list_subdirs(directory, kit_root=ROOT)
            except ValueError as e:
                self._send_json(400, {"ok": False, "error": str(e)})
                return
            self._send_json(200, payload)
            return
        if path_only == "/api/setup-config":
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
        if path_only == "/api/installations":
            self._send_json(
                200,
                {
                    "ok": True,
                    "kit_fingerprint": kit_fingerprint(ROOT),
                    "installations": list_installations(ROOT),
                },
            )
            return
        super().do_GET()

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/") != "/api/installations":
            self.send_error(404)
            return
        if not self._check_token():
            self._send_json(401, {"ok": False, "error": "no autorizado (CONFIGURE_TOKEN)"})
            return
        qs = parse_qs(parsed.query)
        raw_path = (qs.get("path") or [""])[0]
        if not raw_path:
            self._send_json(400, {"ok": False, "error": "path es obligatorio"})
            return
        try:
            target = validate_install_path(raw_path)
        except ValueError as e:
            self._send_json(400, {"ok": False, "error": str(e)})
            return
        self._run_uninstall(target)

    def do_POST(self) -> None:
        path_only = urlparse(self.path).path.rstrip("/")
        if path_only not in ("/api/install", "/api/auto-update", "/api/uninstall"):
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

        if path_only == "/api/auto-update":
            self._handle_auto_update_post(data)
            return
        if path_only == "/api/uninstall":
            try:
                target = validate_install_path(data.get("path", ""))
            except ValueError as e:
                self._send_json(400, {"ok": False, "error": str(e)})
                return
            self._run_uninstall(target)
            return

        self._handle_install_post(data)

    def _handle_install_post(self, data: dict[str, Any]) -> None:
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

        env = install_env.copy()
        env["ORCHESTRATOR_SKIP_REGISTER_TARGET"] = "1"

        cmd = ["bash", str(INSTALL_SH), str(target)] + flags
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                timeout=600,
                env=env,
            )
        except subprocess.TimeoutExpired:
            self._send_json(504, {"ok": False, "error": "install superó el tiempo límite (600s)"})
            return

        log = (proc.stdout or "") + (proc.stderr or "")
        ok = proc.returncode == 0
        if ok:
            want_auto = data.get("auto_update", True) is not False
            upsert_installation(
                ROOT,
                str(target),
                flags=flags,
                auto_update=want_auto,
                kit_fingerprint=kit_fingerprint(ROOT),
            )
            au = set_auto_update_enabled(ROOT, want_auto)
            if not au.get("ok"):
                sys.stderr.write(f"auto-update tras install: {au.get('error', 'fallo')}\n")

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

    def _run_uninstall(self, target: Path) -> None:
        result = uninstall_project(target, dry_run=False)
        log_lines: list[str] = []
        if result.get("removed"):
            for rel in result["removed"]:
                log_lines.append(f"  - {rel}")
        if not result.get("ok"):
            self._send_json(
                500,
                {"ok": False, "error": result.get("error", "desinstalación fallida"), "path": str(target)},
            )
            return
        remove_installation(ROOT, str(target))
        self._send_json(
            200,
            {
                "ok": True,
                "path": str(target),
                "removed": result.get("removed") or [],
                "log": "\n".join(log_lines) or "Nada que quitar (piezas del kit ya ausentes).",
            },
        )

    def _handle_auto_update_post(self, data: dict[str, Any]) -> None:
        if "enabled" not in data:
            self._send_json(400, {"ok": False, "error": "enabled es obligatorio (true/false)"})
            return
        enabled = data.get("enabled")
        if not isinstance(enabled, bool):
            self._send_json(400, {"ok": False, "error": "enabled debe ser booleano"})
            return
        result = set_auto_update_enabled(ROOT, enabled)
        status = 200 if result.get("ok") else 500
        self._send_json(status, {"ok": result.get("ok"), "enabled": result.get("enabled", False), **(
            {"error": result["error"]} if result.get("error") else {}
        )})


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
    print("  Panel:  gestiona instalaciones en el navegador (lista, nueva, desinstalar).")
    print("  API:    GET  /api/installations")
    print("          GET  /api/browse?path=/srv  (directorios del host)")
    print("          POST /api/install  |  POST /api/uninstall  |  DELETE /api/installations?path=")
    print("          GET/POST /api/auto-update  |  GET /api/setup-config")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDetenido.")
        httpd.server_close()


if __name__ == "__main__":
    main()
