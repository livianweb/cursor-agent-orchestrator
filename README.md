# cursor-agent-orchestrator

Kit portable con el paradigma **"padre Auto + Multitask"** para Cursor: un agente padre que
planifica (cuando toca), delega en subagentes con ownership claro, y verifica — sin pedir
aprobación intermedia del plan al usuario. Extraído y generalizado a partir del proyecto
[askbox](https://github.com) (gateway LLM), separando lo **portable** (orquestación genérica)
de lo **específico de cada app** (puertos, stack, dominio).

## Qué resuelve

Cuando usas Cursor en modo Auto con Multitask, sin reglas claras el padre puede:

- Lanzar un Task planificador para un typo, o saltarse el plan en un refactor de arquitectura.
- Lanzar varios Tasks en paralelo que pisan los mismos archivos.
- Usar nombres de modelo hardcodeados que quedan obsoletos cuando Cursor cambia su catálogo.
- Pedir aprobación del plan al usuario rompiendo el flujo "Auto".

Este kit instala tres piezas que resuelven eso de forma genérica:

| Archivo | Qué hace |
|---|---|
| `.cursor/rules/auto-orchestrator.mdc` | Heurística **plan vs. directo**, niveles de capacidad (`fast`/`balanced`/`strong`/`strong-thinking`) y cómo resolver esos niveles a un slug de modelo concreto en cada sesión (sin listas fijas de slugs en las reglas). |
| `.cursor/rules/multitask-ownership.mdc` | Evita que Tasks en paralelo se pisen: allowlist/denylist por Task, qué va en serie, qué archivos son "calientes" (ownership único). |
| `.cursor/skills/plan-implement-verify/SKILL.md` | El flujo paso a paso: Decidir → Plan (si aplica) → Directo (si aplica) → Implement → Verify, con niveles por tipo de subagente. |

## Qué queda portable vs. qué añade cada app

**Portable (este kit, igual en cualquier proyecto):**
- Cuándo planificar con un Task dedicado vs. implementar directo.
- Niveles de capacidad genéricos y cómo resolverlos a slugs en runtime.
- Reglas de ownership para no pisar escrituras en paralelo.
- El esqueleto del flujo Plan → Implement → Verify.

**Específico de cada app (lo añades tú, con `templates/project-conventions.mdc.template`):**
- Puertos, stack (lenguajes, frameworks, BD), cómo se levanta el proyecto.
- Reglas de dominio: p. ej. "toda llamada a un proveedor externo pasa por `api/app/llm/`",
  catálogo de modelos en BD en vez de hardcodeado, etc.
- Reglas de secretos propias (equivalente a `no-secret-leak.mdc` en askbox).
- Los comandos reales de la fase **Verify** (build, health check, tests, linters propios).

## Instalación

### Opción A — clonar e instalar en un proyecto existente

```bash
git clone <URL_DE_ESTE_REPO> cursor-agent-orchestrator
cd cursor-agent-orchestrator
./install.sh /ruta/a/tu-proyecto
```

Sin argumento, instala sobre el directorio actual:

```bash
cd /ruta/a/tu-proyecto
/ruta/a/cursor-agent-orchestrator/install.sh
```

### Opción B — usar este repo como template de GitHub

Si publicaste este kit como repo público en GitHub, márcalo como **Template repository**
(Settings → Template repository). Luego, para cada proyecto nuevo:

1. "Use this template" → crea un repo nuevo a partir del kit.
2. Clónalo dentro de (o junto a) tu proyecto real, o copia manualmente `.cursor/` a tu repo.
3. Renombra `.cursor/rules/project-conventions.mdc.template` a `<tu-proyecto>-conventions.mdc`
   y rellena tus convenciones (ver plantilla).

### Flags de `install.sh`

```bash
./install.sh [RUTA_PROYECTO_DESTINO] [--force] [--dry-run] [--no-template]
```

- Sin flags: copia lo que falte; si un archivo destino **ya existe y es distinto**, lo **salta**
  (no pisa nada a ciegas) y te avisa.
- `--force`: si el archivo destino difiere, hace **backup** (`archivo.bak-FECHA-HORA`) y
  sobrescribe con la versión del kit.
- `--dry-run`: muestra qué haría, sin tocar el disco.
- `--no-template`: no copia `project-conventions.mdc.template` (por si ya tienes tu propia rule
  de convenciones y solo quieres las piezas de orquestación).
- **Idempotente**: si vuelves a ejecutarlo y nada cambió, no hace nada (ni backups innecesarios).

## Arrancar un proyecto nuevo con este paradigma en <5 minutos

```bash
# 1. Instala el kit en tu proyecto (o en un repo recién creado)
/ruta/a/cursor-agent-orchestrator/install.sh /ruta/a/tu-proyecto-nuevo

# 2. Rellena tus convenciones propias
cd /ruta/a/tu-proyecto-nuevo
mv .cursor/rules/project-conventions.mdc.template .cursor/rules/mi-proyecto-conventions.mdc
$EDITOR .cursor/rules/mi-proyecto-conventions.mdc   # puertos, stack, dominio, secretos, verify

# 3. Abre el proyecto en Cursor, modo Auto + Multitask.
#    El padre ya sabe: cuándo planificar vs. ir directo, qué niveles usar,
#    cómo no pisar escrituras entre Tasks paralelos.
```

A partir de ahí, cualquier instrucción al padre en modo Auto sigue el flujo:
**decide plan o directo → (plan si aplica) → implementa → verifica → informa**, anunciando
siempre la decisión tomada, el nivel de capacidad y el slug de modelo resuelto en esa sesión.

## Sincronización con askbox

Este kit nació extrayendo el contenido portable de
[askbox](https://github.com) (`/srv/softportweb/askbox/.cursor/`). Las reglas
`auto-orchestrator.mdc`, `multitask-ownership.mdc` y el skill `plan-implement-verify` deben
mantenerse **con el mismo texto de orquestación** en ambos sitios; lo que diverge entre askbox
y cualquier otro proyecto es su rule de convenciones propia (`askbox-conventions.mdc` en ese
caso) y sus reglas específicas de dominio (p. ej. `llm-routing`, `no-secret-leak`), que **no**
forman parte de este kit porque son específicas del producto.

## Qué NO incluye este kit (a propósito)

- Nada de secretos, `.env`, claves de API ni configuración de infraestructura real.
- Reglas de dominio específicas de un producto (routing LLM, esquemas de BD, etc.).
- Listas fijas de slugs de modelos de Cursor: los niveles de capacidad se resuelven en cada
  sesión contra el catálogo de modelos disponible, porque los slugs concretos cambian con el
  tiempo.

## Licencia

MIT — ver `LICENSE`.
