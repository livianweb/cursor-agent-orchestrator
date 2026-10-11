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
| `.cursor/rules/auto-orchestrator.mdc` | Heurística **plan vs. directo**, niveles de capacidad (`fast`/`balanced`/`strong`/`strong-thinking`), resolución dinámica a slug (sin tablas fijas) con **preferencia Composer** para ahorro de coste; escalar a otros modelos solo en `strong*`. |
| `.cursor/rules/multitask-ownership.mdc` | Evita que Tasks en paralelo se pisen: allowlist/denylist por Task, qué va en serie, qué archivos son "calientes" (ownership único). |
| `.cursor/skills/plan-implement-verify/SKILL.md` | El flujo paso a paso: Decidir → Plan (si aplica) → Directo (si aplica) → Implement → Verify → Git autopilot, con niveles por tipo de subagente. |
| `.cursor/skills/askbox-first/SKILL.md` | Para UI/visual y copy/docs: usar primero el gateway [askbox](https://github.com) (`POST /v1/ask`); fallback a subagentes Cursor si falla, no aprueba o no hay token/URL en el entorno. |
| `.cursor/skills/git-autopilot/SKILL.md` | Política de auto-commit + auto-push (anula el "solo commit si el usuario lo pide" por defecto de Cursor) y contrato de la pantalla de configuración Git por proyecto. |
| `templates/git-settings-screen.md` | Guía de contrato (endpoints, forma de datos, UI sugerida) para construir la pantalla de configuración Git de **tu** proyecto. |
| `docs/git-and-askbox.md` | Las tres capas (LLM / git proyecto / git kit) y cómo no mezclarlas. |
| `.askbox/git-settings.json.example` | Preferencias git no secretas por repo (copiar a `.askbox/git-settings.json` en proyecto o kit). |
| `configure` | Asistente post-clone: abre la guía de setup (capas A/B/C). |
| `setup/index.html` | UI estática del kit para configuración (independiente de askbox). |
| `docs/getting-started-after-clone.md` | Flujo canónico clone → configure → install → git por capa. |

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

**URL del repositorio:** `https://github.com/livianweb/cursor-agent-orchestrator.git`

### Tras `git clone` — configurar el kit (3 capas)

```bash
git clone https://github.com/livianweb/cursor-agent-orchestrator.git
cd cursor-agent-orchestrator
./configure          # guía visual: capas A (Askbox LLM), B (git proyecto), C (git kit)
./install.sh /ruta/a/tu-proyecto
```

Pasos detallados: [`docs/getting-started-after-clone.md`](docs/getting-started-after-clone.md).
La guía UI vive en `setup/` (no es la pantalla `/settings/git` de askbox).

| Comando | Qué hace |
|---------|----------|
| `./configure` | Servidor local + `setup/index.html` con los tres bloques de config |
| `./configure --kit-git` | Crea `.askbox/git-settings.json` en el kit (capa C) |
| `./install.sh DESTINO` | Copia rules/skills al **proyecto destino** (capa B) |

### Opción A — clonar e instalar en un proyecto existente

```bash
git clone https://github.com/livianweb/cursor-agent-orchestrator.git
cd cursor-agent-orchestrator
./configure
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
git clone https://github.com/livianweb/cursor-agent-orchestrator.git
cd cursor-agent-orchestrator
./configure   # repasa capas A/B/C en el navegador

# Capa A (opcional): export ASKBOX_API_URL y ASKBOX_ACCESS_TOKEN en el entorno Cursor

# Capa B: instala en tu app
./install.sh /ruta/a/tu-proyecto-nuevo
cd /ruta/a/tu-proyecto-nuevo
mv .cursor/rules/project-conventions.mdc.template .cursor/rules/mi-proyecto-conventions.mdc
$EDITOR .cursor/rules/mi-proyecto-conventions.mdc

# Capa C (cuando toques el kit): gh auth + push desde cursor-agent-orchestrator

# Abre tu-proyecto-nuevo en Cursor, modo Auto + Multitask.
```

A partir de ahí, cualquier instrucción al padre en modo Auto sigue el flujo:
**decide plan o directo → (plan si aplica) → implementa → verifica → informa**, anunciando
siempre la decisión tomada, si la vía fue askbox o Cursor, el nivel de capacidad y el slug resuelto en esa sesión (UI/copy: askbox-first cuando la skill está instalada).

## Askbox vs orquestador vs git (3 configs)

**Askbox** (producto gateway LLM) y **este kit** (orquestación Cursor) van por separado: remotos
Git distintos, repos distintos, objetivos distintos. No asumas que «todo se configura en askbox»
ni que la pantalla `/settings/git` de un despliegue askbox sustituye git en apps arbitrarias.

| Capa | Qué | Dónde se configura |
|------|-----|-------------------|
| **A. Askbox LLM** | `ASKBOX_API_URL` + `ASKBOX_ACCESS_TOKEN` para askbox-first | Env del host/agente Cursor; token en askbox `/projects` |
| **B. Git del proyecto** | Remoto, PAT/`gh`, preferencias autopilot | Repo del **proyecto abierto en Cursor**: `.askbox/git-settings.json` (ver `.askbox/git-settings.json.example`), `gh`/git local; skill `git-autopilot` opera sobre el cwd de ese repo |
| **C. Git del orquestador** | Remoto del **kit**, push de rules/skills | Repo de este kit (`cursor-agent-orchestrator`): mismo patrón que B, pero commits del kit van al remoto del kit, no al de askbox ni al de tu app |

- **Capa A** → `.cursor/skills/askbox-first/SKILL.md` (solo LLM; no gestiona Git).
- **Capas B y C** → `.cursor/skills/git-autopilot/SKILL.md` y guía extendida en
  [`docs/git-and-askbox.md`](docs/git-and-askbox.md).

El producto askbox puede montar repos hermanos (`ASKBOX_EXTRA_REPOS`, p. ej. este kit) y ofrecer
`/settings/git?repo=…` como **conveniencia opcional** de deploy; el camino canónico del kit sigue
siendo trabajar en su repo con git-autopilot + `gh` (o su propio `.askbox/git-settings.json`).

## Sincronización con askbox

Este kit nació extrayendo el contenido portable de
[askbox](https://github.com) (`/srv/softportweb/askbox/.cursor/`). Las reglas
`auto-orchestrator.mdc`, `multitask-ownership.mdc` y los skills `plan-implement-verify` y
`askbox-first` deben mantenerse **con el mismo texto de orquestación** en ambos sitios; lo que diverge entre askbox
y cualquier otro proyecto es su rule de convenciones propia (`askbox-conventions.mdc` en ese
caso) y sus reglas específicas de dominio (p. ej. `llm-routing`, `no-secret-leak`), que **no**
forman parte de este kit porque son específicas del producto.

## Política de auto-commit + auto-push

Al instalar este kit, el padre en Auto **deja de pedir aprobación para commitear**: decide él
mismo cuándo cerrar con un commit (+ push si hay remoto, o creación de remoto con `gh` si no lo
hay) tanto en el **proyecto gestionado** como en **este mismo kit** cuando lo mejora. La
heurística completa (cuándo sí, cuándo no, qué nunca se commitea) vive en
`.cursor/skills/git-autopilot/SKILL.md`. Si quieres volver al comportamiento por defecto de
Cursor en un proyecto concreto, elimina ese skill de `.cursor/skills/` en ese repo.

## Qué NO incluye este kit (a propósito)

- Nada de secretos, `.env`, claves de API ni configuración de infraestructura real.
- Reglas de dominio específicas de un producto (routing LLM, esquemas de BD, etc.).
- Listas fijas de slugs de modelos de Cursor: los niveles de capacidad se resuelven en cada
  sesión contra el catálogo de modelos disponible, porque los slugs concretos cambian con el
  tiempo.

## Licencia

MIT — ver `LICENSE`.
