# Plantilla: pantalla de configuración Git por proyecto

Guía de contrato (no código atado a un framework) para implementar la pantalla/endpoints que
pide `.cursor/skills/git-autopilot/SKILL.md`. Adapta rutas y framework a tu stack; esto es la
forma de los datos y el comportamiento esperado, no una implementación obligatoria.

Hay una implementación de referencia completa (FastAPI + Next.js) en askbox:
`api/app/gitops.py`, `api/app/routers/git_settings.py`, `web/app/settings/git/page.js`.

## Principios

- **Nunca** devolver URLs de remoto con credenciales embebidas (`https://usuario:token@host/...`
  → sanea a `https://host/...` antes de responder).
- **Nunca** ejecutar commit automático desde este endpoint: esta pantalla **lee** estado y
  **gestiona conexión/preferencias**; el commit autónomo lo decide el agente siguiendo
  `git-autopilot`. Crear remoto y `push` explícito (acción del usuario/agente vía API) sí son
  válidos si hay credenciales.
- Si el proceso que sirve la API no tiene acceso al `.git` del repo (contenedor sin ese
  volumen montado), responder con un estado degradado explícito, no simular datos ni fallar
  con un 500 genérico.
- Las preferencias (no secretas) se guardan **en el propio repo** (archivo versionable, p. ej.
  `.<app>/git-settings.json`), para que viajen con el proyecto. Las credenciales viven fuera:
  `gh auth`, variables de entorno, un gestor de secretos del host/contenedor, o **cifradas en la
  BD de la app** (ver «GitHub token» más abajo).

## Endpoints sugeridos

### `GET /settings/git/status`

Respuesta cuando el repo **no** es accesible:

```json
{
  "available": false,
  "reason": "Repo no accesible desde este proceso (REPO_PATH=/workspace/repo). Monta el repo o ejecuta el servicio en el host."
}
```

Respuesta cuando el repo **sí** es accesible:

```json
{
  "available": true,
  "branch": "main",
  "remotes": [
    { "name": "origin", "url": "https://github.com/usuario/proyecto.git", "type": "fetch" }
  ],
  "upstream": "origin/main",
  "last_commit": { "hash": "a1b2c3d4e5f6", "date": "2026-10-11T09:00:00+02:00", "subject": "Mensaje del commit" },
  "dirty": false,
  "preferences": { "auto_commit": true, "remote_name": "origin", "default_visibility": "private", "last_push_at": null }
}
```

### `PATCH /settings/git/preferences`

Body (todos los campos opcionales, solo se actualiza lo presente):

```json
{ "auto_commit": true, "remote_name": "origin", "default_visibility": "private" }
```

Devuelve el objeto de preferencias ya mergeado y guardado.

### `POST /settings/git/remote`

Para **conectar** un remoto existente:

```json
{ "name": "origin", "url": "https://github.com/usuario/proyecto.git" }
```

Para **crear** uno nuevo vía `gh` (requiere `gh auth status` OK en el host/contenedor):

```json
{ "name": "origin", "create": true, "slug": "mi-proyecto", "visibility": "private", "push": false }
```

Errores esperables y cómo comunicarlos:

| Caso | Código sugerido | Mensaje |
|---|---|---|
| Repo no accesible | 503 `git_unavailable` | Indicar cómo montar/acceder al repo |
| Ni `gh` autenticado ni GitHub token guardado y se pidió `create` | 501 `gh_not_available` | Indicar guardar un token en la pantalla, `gh auth login`, o conectar un remoto con `url` |
| Falló `git remote add/set-url` | 502 `git_remote_failed` | Incluir el stderr resumido (sin credenciales) |
| Body sin `url` ni `create` | 422 `missing_url_or_create` | — |

### GitHub token (opcional, recomendado si el host no tiene `gh` autenticado)

Permite que la app (y un agente vía API) cree el remoto y haga push sin `gh`.

| Método | Ruta | Comportamiento |
|---|---|---|
| `GET` | `/settings/git/github-token` | `{ "github_token_configured": true, "github_token_last4": "WXYZ" }` — **nunca** el token |
| `PUT`/`POST` | `/settings/git/github-token` | Body `{ "token": "..." }`; valida formato, **cifra** (AES-GCM con la master key de la app) y guarda; reemplaza el anterior. Respuesta = `GET` |
| `DELETE` | `/settings/git/github-token` | Borra el token |
| `POST` | `/settings/git/push` | `{ remote?, branch? }` → push usando el token si el remoto es `https://github.com/...` |

- `status` incluye también `github_token_configured` / `github_token_last4`.
- `POST /remote` con `create: true`: usa `gh` si está autenticado; si no, el token guardado vía
  `POST https://api.github.com/user/repos` (`slug` obligatorio) y conecta el remoto con la URL
  limpia (`clone_url`, sin credenciales). Errores: 501 `gh_not_available` (ni `gh` ni token),
  401 `github_token_invalid`, 409 `github_repo_exists`, 502 `github_push_failed`.
- Push con token: pasarlo solo por **entorno del subproceso** (`GIT_CONFIG_COUNT/KEY/VALUE` con
  `http.https://github.com/.extraheader = AUTHORIZATION: basic base64(x-access-token:TOKEN)`),
  nunca en argv ni en la URL del remoto ni en `.git/config`; redactar el token de cualquier
  error/log antes de responder.
- UI: input `type=password` (`autocomplete=new-password`), botón guardar/reemplazar, botón borrar,
  indicador «configurado (…last4)»; vaciar el input tras guardar.
- Opcional: soporte multi-repo con `?repo=<nombre>` limitado a una allowlist de repos montados.

## Campos de preferencias (forma mínima)

| Campo | Tipo | Notas |
|---|---|---|
| `auto_commit` | bool | Si el agente debe aplicar la política de `git-autopilot` sin preguntar en este proyecto |
| `remote_name` | string | Normalmente `origin` |
| `default_visibility` | `"public"` \| `"private"` | Usado al crear repos nuevos con `gh repo create` |
| `last_push_at` | string ISO-8601 o `null` | Lo actualiza quien hace el push (agente o este mismo servicio si alguna vez ejecuta push) |

## UI sugerida (independiente del framework)

- Banner de estado: disponible / no disponible (con el motivo si no lo está).
- Bloque "Estado": branch, remoto(s) con URL saneada, último commit, si hay cambios sin
  commitear.
- Formulario "Conectar remoto": campo URL (tratar como sensible en el input, tipo password o
  aviso de que puede contener credenciales) + botón "Conectar".
- Botón/formulario "Crear repo con gh": slug opcional, selector de visibilidad, checkbox
  "pushear ahora" → llama a `create: true`.
- Formulario "Preferencias": toggle `auto_commit`, input `remote_name`, selector
  `default_visibility`, botón "Guardar".

## Seguridad

- Autenticar el acceso a estos endpoints igual que el resto de la app (sesión/admin); no
  dejarlos públicos.
- No loguear el valor de `url` tal cual llega en `POST /remote` (puede contener un token);
  solo loguear la versión saneada o el nombre del remoto.
- No exponer ningún endpoint que lea archivos arbitrarios del repo "de paso" (p. ej. nunca
  servir el contenido de `.env` aunque esté dentro del mismo `REPO_PATH` montado).
