# Empezar tras `git clone`

Flujo canónico para el kit **cursor-agent-orchestrator**. Askbox (producto) y este repo van
por separado; la configuración tiene **tres capas** (ver también [`git-and-askbox.md`](git-and-askbox.md)).

## URL e instalador

| Qué | Comando / URL |
|-----|----------------|
| Clonar el kit | `git clone https://github.com/livianweb/cursor-agent-orchestrator.git` |
| Entrar al repo | `cd cursor-agent-orchestrator` |
| Wizard (guía + instalar en UI) | `./install.sh` o `./configure` |
| Instalar por CLI | `./install.sh /ruta/a/tu-proyecto` |

`./install.sh` sin argumentos arranca el servidor del wizard (`scripts/setup_server.py`) en
`CONFIGURE_HOST` (por defecto `0.0.0.0`) y `CONFIGURE_PORT` (por defecto `8765`). En la consola
verás `http://127.0.0.1:8765/` y, si hay IP LAN, `http://<ip-lan>:8765/` para abrir desde otro PC.

- **Misma máquina:** navegador en `http://127.0.0.1:8765/` (deja `./install.sh` en marcha).
- **Otro PC en la red:** usa la URL **Red** que imprime el script.
  Comprueba con `ss -tlnp | grep 8765` que escucha `0.0.0.0:8765`, no solo `127.0.0.1` (proceso
  antiguo con `python3 -m http.server` sin API — mátalo y vuelve a ejecutar `./install.sh`).
- **Hard refresh** en el navegador (`Ctrl+Shift+R`) si ves la sección «Clonar e instalar» obsoleta.
- **Sin red / firewall:** `./configure --open-file` (solo lectura; Instalar requiere el servidor).
- Solo localhost: `CONFIGURE_HOST=127.0.0.1 ./install.sh`. Sin Python: `./configure --print`.

### API del wizard

| Método | Ruta | Cuerpo |
|--------|------|--------|
| `GET` | `/api/health` | — |
| `GET` | `/api/auto-update` | Estado cron, `schedule`, `targets`, línea cron sugerida |
| `POST` | `/api/install` | `{ "path": "/ruta/absoluta", "flags": ["--dry-run"] }` → JSON con `ok`, `log`, `exit_code` |
| `POST` | `/api/auto-update` | `{ "action": "install_cron" \| "remove_cron" \| "run_now", "schedule": "0 6 * * *" }` |

**Seguridad en LAN:** cualquier equipo en la red local puede llamar a `POST /api/install` y
escribir en rutas del host. Mitigación opcional: `export CONFIGURE_TOKEN=…` y cabecera
`X-Configure-Token` (o `Authorization: Bearer …`) en la petición.

Opciones útiles:

```bash
./configure --open-file  # guía en el navegador sin servidor HTTP
./configure --kit-git    # copia .askbox/git-settings.json.example → .askbox/git-settings.json (capa C)
./scripts/install-auto-update-cron.sh   # cron diario 06:00 (cada clone / cada máquina)
./install.sh --help
```

Auto-update del kit: [`auto-update.md`](auto-update.md).

## Paso a paso (≈5 minutos)

### 1. Clonar y abrir el wizard

```bash
git clone https://github.com/livianweb/cursor-agent-orchestrator.git
cd cursor-agent-orchestrator
./install.sh
```

En la UI, de arriba a abajo: **Paso 1 · Askbox** (capa A, opcional) → **Paso 2 · Proyecto**
(ruta absoluta + **Instalar**, capa B) → **Paso 3** git/auto-update del kit (capa C).

### 2. Capa A — Askbox LLM (entorno del agente Cursor)

En el host donde corre Cursor (o en el env del agente), **no** en git:

```bash
# Sustituye por la URL de tu instancia (dominio o IP; cada cliente puede ser distinto)
export ASKBOX_API_URL="https://TU-INSTANCIA/api"
export ASKBOX_ACCESS_TOKEN="ab_live_…"          # /projects en esa instancia
```

En el wizard (`./install.sh`), la sección **Capa A** tiene campos vacíos por defecto y genera estos exports al pulsar **Copiar exports**.

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
./install.sh /ruta/a/mi-app --merge            # fusión askbox → *.merge-proposal (+ informe directivas)
./install.sh /ruta/a/mi-app --merge-apply      # aplica fusión askbox con backup (capa A: ASKBOX_*)
./install.sh /ruta/a/mi-app --force            # kit puro con backup (sin fusión)

cd /ruta/a/mi-app
# Si es proyecto nuevo y copiaste la plantilla:
mv .cursor/rules/project-conventions.mdc.template .cursor/rules/mi-app-conventions.mdc
# Edita convenciones (stack, puertos, verify)

cp .askbox/git-settings.json.example .askbox/git-settings.json   # opcional
gh auth login
git remote add origin https://github.com/TU_USUARIO/mi-app.git   # o gh repo create
```

**Conflictos en `.cursor/`:** idéntico → sin cambios; distinto → **skip** por defecto. Con
`--merge`, askbox (`POST /v1/ask`) propone texto fusionado en `*.merge-proposal` y analiza
contradicciones entre convenciones y orquestador en `.cursor/install-merge-policy-report.md`.
Sin `ASKBOX_API_URL` / `ASKBOX_ACCESS_TOKEN` se avisa y la propuesta es side-by-side para
fusionar con Cursor. `--merge-apply` escribe la fusión con backup. `--force` sobrescribe el kit
sin askbox. Lista cerrada de archivos: ver `./install.sh --help`.

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

**No mezclar:** el remoto/PAT del kit no sirve para la app, ni al revés. En cada repo:
`gh` + git local (y opcionalmente `.askbox/git-settings.json` en ese repo).

### 5. Trabajar

- Proyecto diario: carpeta de **tu app** en Cursor.
- Contribuir al kit: carpeta **cursor-agent-orchestrator** en Cursor (u otro clone).

## Qué no es esta guía

- **No** sustituye la documentación del producto askbox.
- **No** configura secretos en el repo (tokens van en env o en gh).
- La guía visual del kit: `setup/` y `./install.sh` (wizard).

## Referencias

- [`git-and-askbox.md`](git-and-askbox.md) — tabla de las tres capas
- [`../README.md`](../README.md) — visión general del kit
- `.cursor/skills/askbox-first/SKILL.md` — capa A
- `.cursor/skills/git-autopilot/SKILL.md` — capas B y C
