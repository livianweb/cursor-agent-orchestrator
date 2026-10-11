# Empezar tras `git clone`

Flujo canónico para el kit **cursor-agent-orchestrator**. Askbox (producto) y este repo van
por separado; la configuración tiene **tres capas** (ver también [`git-and-askbox.md`](git-and-askbox.md)).

## URL e instalador

| Qué | Comando / URL |
|-----|----------------|
| Clonar el kit | `git clone https://github.com/livianweb/cursor-agent-orchestrator.git` |
| Entrar al repo | `cd cursor-agent-orchestrator` |
| Asistente visual (capas A/B/C) | `./configure` |
| Instalar en un proyecto | `./install.sh /ruta/a/tu-proyecto` |

`./configure` sirve `setup/index.html` en `http://127.0.0.1:8765/` (puerto configurable con
`CONFIGURE_PORT`). Sin Python: `./configure --print` y abre el HTML en el navegador.

Opciones útiles:

```bash
./configure --kit-git    # copia .askbox/git-settings.json.example → .askbox/git-settings.json (capa C)
./install.sh --help
```

## Paso a paso (≈5 minutos)

### 1. Clonar y abrir la guía

```bash
git clone https://github.com/livianweb/cursor-agent-orchestrator.git
cd cursor-agent-orchestrator
./configure
```

### 2. Capa A — Askbox LLM (entorno del agente Cursor)

En el host donde corre Cursor (o en el env del agente), **no** en git:

```bash
export ASKBOX_API_URL="http://127.0.0.1:8066"   # o tu URL pública /api
export ASKBOX_ACCESS_TOKEN="ab_live_…"          # /projects en askbox
```

Reinicia o recarga la sesión del agente para que lea las variables. Sin capa A, askbox-first
hace fallback a subagentes Cursor (sigue funcionando el kit).

### 3. Capa B — Proyecto destino + git de la app

`install.sh` vale para un repo **nuevo** (sin `.cursor/`) o **existente** (con rules/skills/hooks
propios). Solo instala piezas del orquestador; **no borra** tu `*-conventions.mdc`, hooks ni
skills ajenos al kit.

```bash
./install.sh /ruta/a/mi-app                    # seguro: no pisa archivos que ya difieran
./install.sh /ruta/a/mi-app --dry-run          # simular
./install.sh /ruta/a/mi-app --no-template      # sin plantilla de convenciones
./install.sh /ruta/a/mi-app --force            # backup .bak-* + sobrescribe lo que difiera

cd /ruta/a/mi-app
# Si es proyecto nuevo y copiaste la plantilla:
mv .cursor/rules/project-conventions.mdc.template .cursor/rules/mi-app-conventions.mdc
# Edita convenciones (stack, puertos, verify)

cp .askbox/git-settings.json.example .askbox/git-settings.json   # opcional
gh auth login
git remote add origin https://github.com/TU_USUARIO/mi-app.git   # o gh repo create
```

**Conflictos en `.cursor/`:** archivo idéntico al kit → sin cambios; distinto → **skip** (salvo
`--force`, que hace backup y copia). Lista cerrada: `auto-orchestrator.mdc`, `multitask-ownership.mdc`,
skills `plan-implement-verify`, `askbox-first`, `git-autopilot`. Ver `./install.sh --help`.

Abre **mi-app** en Cursor (Auto + Multitask). Los commits autopilot van al remoto de **mi-app**.

### 4. Capa C — Git del kit (este repo)

Desde la raíz del clon del orquestador:

```bash
cd /ruta/a/cursor-agent-orchestrator
./configure --kit-git
gh auth login
git remote -v    # origin → github.com/.../cursor-agent-orchestrator.git
git push origin master
```

Mejoras a `.cursor/rules` o `.cursor/skills` del kit → commit aquí → push al remoto del kit.

**No mezclar:** el remoto/PAT del kit no sirve para la app, ni al revés. La UI
`/settings/git` de un despliegue askbox solo aplica a repos montados en ese servidor
(`ASKBOX_EXTRA_REPOS`); el camino portable es `gh` + git local en cada repo.

### 5. Trabajar

- Proyecto diario: carpeta de **tu app** en Cursor.
- Contribuir al kit: carpeta **cursor-agent-orchestrator** en Cursor (u otro clone).

## Qué no es esta guía

- **No** sustituye la documentación del producto askbox.
- **No** configura secretos en el repo (tokens van en env o en gh).
- **No** es la pantalla `/settings/git` de askbox: la guía visual del kit vive en `setup/` y
  `./configure`.

## Referencias

- [`git-and-askbox.md`](git-and-askbox.md) — tabla de las tres capas
- [`../README.md`](../README.md) — visión general del kit
- `.cursor/skills/askbox-first/SKILL.md` — capa A
- `.cursor/skills/git-autopilot/SKILL.md` — capas B y C
