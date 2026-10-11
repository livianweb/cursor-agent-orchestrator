# Actualización automática del kit (todas las instancias)

Cada máquina o cliente con su propio `git clone` de **cursor-agent-orchestrator** puede
actualizarse sola: `git pull --ff-only` del kit y re-ejecución de `./install.sh` en los
proyectos que hayas registrado.

No usa Docker ni el stack de askbox.

## Qué hace

| Paso | Script |
|------|--------|
| 1 | `scripts/auto-update-kit.sh` hace `git fetch` + `git pull --ff-only` en el clone del kit |
| 2 | Si existe `.askbox/orchestrator-targets`, ejecuta `./install.sh <ruta>` por cada línea (sin `--force` salvo flag) |
| 3 | Los targets se añaden solos tras cada `install.sh` exitoso (no `--dry-run`); también puedes editar el archivo a mano |

Plantilla: `.askbox/orchestrator-targets.example` → copiar a `.askbox/orchestrator-targets` (gitignored).

## Activar por instancia

Desde la raíz del **clone del kit** en esa máquina:

```bash
chmod +x scripts/auto-update-kit.sh scripts/install-auto-update-cron.sh
./scripts/install-auto-update-cron.sh
```

Eso añade una línea a la **crontab del usuario** que ejecuta el script cada día a las **06:00**
(hora local del servidor). El log va a `.askbox/auto-update.log`.

Alternativas:

- **Solo ver la línea cron** (copiar a mano): `./scripts/install-auto-update-cron.sh --print-line`
- **Wizard** (`./install.sh`): sección «Actualización diaria» → activar / desactivar / ejecutar ahora
- **systemd** (usuario con loginctl): ver `docs/systemd/` en este repo

## Hora del cron

Por defecto: `0 6 * * *` (06:00).

```bash
ORCHESTRATOR_AUTO_UPDATE_CRON_SCHEDULE='30 4 * * *' ./scripts/install-auto-update-cron.sh
```

Vuelve a ejecutar el instalador de cron para reemplazar la línea anterior (mismo marcador `# cursor-agent-orchestrator-auto-update`).

## Encender / apagar

| Acción | Cómo |
|--------|------|
| **Apagar** (cron sigue pero no hace nada) | Edita crontab y cambia `ORCHESTRATOR_AUTO_UPDATE=1` por `=0`, o exporta `ORCHESTRATOR_AUTO_UPDATE=0` en la línea |
| **Quitar cron** | `./scripts/install-auto-update-cron.sh --remove` |
| **Una pasada manual** | `./scripts/auto-update-kit.sh` |
| **Forzar sobrescritura en targets** | `ORCHESTRATOR_AUTO_UPDATE_FORCE=1 ./scripts/auto-update-kit.sh` |

Estado local (si instalaste vía script): `.askbox/auto-update.state` (JSON con `schedule`, `enabled`).

## Variables de entorno

| Variable | Efecto |
|----------|--------|
| `ORCHESTRATOR_AUTO_UPDATE=0` | El script termina sin tocar git ni proyectos |
| `ORCHESTRATOR_AUTO_UPDATE_FORCE=1` | Pasa `--force` a cada `install.sh` de target |
| `ORCHESTRATOR_AUTO_UPDATE_DRY_RUN=1` | Solo actualiza git del kit |
| `ORCHESTRATOR_SKIP_REGISTER_TARGET=1` | `install.sh` no añade la ruta a `orchestrator-targets` |

## systemd (opcional)

Copia y ajusta `%h` / ruta del kit:

```bash
mkdir -p ~/.config/systemd/user
cp docs/systemd/cursor-orchestrator-auto-update.* ~/.config/systemd/user/
# Edita WorkingDirectory y rutas en el .service
systemctl --user daemon-reload
systemctl --user enable --now cursor-orchestrator-auto-update.timer
```

Timer por defecto: diario 06:00 (`OnCalendar=*-*-* 06:00:00`).

## Varias instancias

Cada servidor o PC con su clone debe ejecutar **una vez** `install-auto-update-cron.sh` (o equivalente).
Así todas las copias del kit se alinean con `origin` y los proyectos listados reciben rules/skills nuevos
con la política por defecto de `install.sh` (no pisa archivos que ya difieren).
