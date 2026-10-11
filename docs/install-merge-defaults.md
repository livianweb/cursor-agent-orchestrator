# Fusión askbox por defecto

Con **capa A completa** (`ASKBOX_API_URL` + `ASKBOX_ACCESS_TOKEN`), la instalación asume que
quieres **fusionar y aplicar** conflictos en `.cursor/` en lugar de dejarlos en skip.

## Wizard (`./install.sh`)

1. Si el servidor del wizard ya tiene `ASKBOX_*` en el entorno, `GET /api/setup-config` rellena
   la URL y marca el token como configurado (sin enviar el valor al navegador).
2. Con askbox completo (inputs o env), en **Avanzado** queda marcado **Aplicar fusión**
   (`--merge-apply`). Si vacías URL o token, se desmarca.
3. Puedes desmarcar, usar solo `--merge`, `--dry-run` o `--force` en Avanzado.

`POST /api/install` recibe `flags` explícitos desde la UI. Si un cliente API **omite** la clave
`flags` y el entorno del servidor (más `askbox_api_url` / `askbox_access_token` opcionales en el
body) tiene askbox completo, el backend añade `--merge-apply` por defecto.

## CLI

```bash
export ASKBOX_API_URL="https://tu-instancia/api"
export ASKBOX_ACCESS_TOKEN="ab_live_…"
./install.sh /ruta/a/mi-app
# → equivalente a --merge-apply salvo que pases --force, --merge o --merge-apply explícitos
```

Sin `ASKBOX_*`: comportamiento seguro anterior (skip en conflictos).
