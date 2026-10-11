#!/usr/bin/env python3
"""Propone fusión de archivos del kit vs proyecto vía askbox (POST /v1/ask).

Uso:
  install-merge-askbox.py file KIT_PATH PROJECT_PATH
  install-merge-askbox.py policy PROJECT_ROOT

Salida: texto fusionado o informe en stdout. Códigos de salida:
  0 — éxito (texto en stdout)
  2 — sin ASKBOX_* o fallo askbox (fallback; install.sh escribe side-by-side)
  1 — error de uso / IO
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

MAX_CHARS_PER_FILE = 14_000


def _read_bounded(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > MAX_CHARS_PER_FILE:
        return text[:MAX_CHARS_PER_FILE] + "\n\n… [truncado por install-merge]\n"
    return text


def _askbox_request(prompt: str, system: str, tier: str = "balanced") -> str | None:
    base = (os.environ.get("ASKBOX_API_URL") or "").rstrip("/")
    token = os.environ.get("ASKBOX_ACCESS_TOKEN") or ""
    if not base or not token:
        return None
    body = json.dumps(
        {
            "prompt": prompt,
            "system": system,
            "tier": tier,
            "max_output_tokens": 8192,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/v1/ask",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None
    text = (data.get("text") or "").strip()
    return text or None


def cmd_file(kit: Path, project: Path) -> int:
    if not kit.is_file() or not project.is_file():
        print("error: rutas de archivo inválidas", file=sys.stderr)
        return 1
    kit_text = _read_bounded(kit)
    proj_text = _read_bounded(project)
    rel = project.name
    system = (
        "Eres un editor técnico de reglas Cursor (.mdc) y skills (Markdown). "
        "Fusiona dos versiones del mismo archivo conservando las convenciones y políticas "
        "del proyecto y las piezas obligatorias del orquestador portable. "
        "Devuelve SOLO el contenido fusionado del archivo, sin explicación ni fences markdown."
    )
    prompt = f"""Fusiona estos dos contenidos del archivo «{rel}».

Prioridad:
1. Mantener convenciones, puertos, stack y reglas de dominio del bloque «proyecto».
2. Incorporar heurísticas del orquestador del bloque «kit» (plan vs directo, ownership, git-autopilot, askbox-first).
3. Eliminar duplicados y contradicciones explícitas; si no se puede resolver, conserva la política del proyecto y añade una nota HTML <!-- install-merge: … --> breve.

<<< proyecto (actual en destino)
{proj_text}

<<< kit (cursor-agent-orchestrator)
{kit_text}
"""
    merged = _askbox_request(prompt, system)
    if merged is None:
        return 2
    sys.stdout.write(merged)
    if not merged.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def _collect_policy_context(project_root: Path) -> str:
    rules_dir = project_root / ".cursor" / "rules"
    chunks: list[str] = []
    if rules_dir.is_dir():
        for p in sorted(rules_dir.glob("*.mdc")):
            chunks.append(f"### {p.name}\n{_read_bounded(p)}")
    skills = project_root / ".cursor" / "skills"
    if skills.is_dir():
        for skill_md in sorted(skills.rglob("SKILL.md")):
            rel = skill_md.relative_to(project_root)
            chunks.append(f"### {rel}\n{_read_bounded(skill_md)}")
    return "\n\n".join(chunks) if chunks else "(sin rules/skills en .cursor/)"


def cmd_policy(project_root: Path) -> int:
    if not project_root.is_dir():
        print("error: PROJECT_ROOT no es directorio", file=sys.stderr)
        return 1
    context = _collect_policy_context(project_root)
    if len(context) > MAX_CHARS_PER_FILE * 2:
        context = context[: MAX_CHARS_PER_FILE * 2] + "\n… [truncado]\n"
    system = (
        "Analizas reglas Cursor y skills en un repo tras instalar cursor-agent-orchestrator. "
        "Responde en Markdown claro en español."
    )
    prompt = f"""Tras instalar el kit de orquestación, revisa si hay **directivas contradictorias**
entre reglas de convenciones del proyecto y reglas/skills del orquestador (plan vs directo,
multitask ownership, git-autopilot, askbox-first).

Para cada conflicto:
- Archivos implicados
- Qué choca
- Recomendación concreta (editar manualmente, fusionar sección X en Y, o «sin conflicto»)

Si no hay conflictos relevantes, dilo en una línea.

Contenido actual bajo .cursor/ en el proyecto:

{context}
"""
    report = _askbox_request(prompt, system, tier="balanced")
    if report is None:
        return 2
    sys.stdout.write(report)
    if not report.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1
    mode = sys.argv[1]
    if mode == "file" and len(sys.argv) == 4:
        return cmd_file(Path(sys.argv[2]), Path(sys.argv[3]))
    if mode == "policy" and len(sys.argv) == 3:
        return cmd_policy(Path(sys.argv[2]))
    print(__doc__, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
