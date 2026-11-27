# Configuration

Most settings are in the web app. **Settings → Server** (admins) has the Public URL and how long one-time links last by default. The rest is environment variables on the container.

## Environment variables

| Variable | |
| --- | --- |
| `COFFER_DATA_DIR` | The database and key file. `/data` in the image. |
| `COFFER_SECRET_KEY` | The master key. If it's unset, Coffer creates a random key in `$COFFER_DATA_DIR/secret.key`. Changing it makes existing secrets unreadable. |
| `COFFER_ADMIN_EMAIL`, `COFFER_ADMIN_PASSWORD` | Create the admin on start, instead of in the setup screen. `COFFER_ADMIN_NAME` is optional. |
| `PROTOCOL_HEADER` | Behind a TLS proxy: `x-forwarded-proto`. See [Behind a reverse proxy](reverse-proxy.html). |
| `ADDRESS_HEADER`, `XFF_DEPTH` | Behind a proxy: `x-forwarded-for` and the number of proxies, so rate limits and the activity log see real addresses. |
| `HOST_HEADER` | Only when the proxy rewrites `Host`: `x-forwarded-host`. |
| `PORT` | The port inside the container. `3000` in the image. |

## API

Everything the web app, CLI and extension do goes through `/api/v1`, with either the session cookie or `Authorization: Bearer cof_…`.

| | |
| --- | --- |
| `GET /api/v1/projects`, `POST` | List, create (`{ name, slug?, environments? }`) |
| `GET/PATCH/DELETE /api/v1/projects/:project` | A project (by slug or id), its environments and folders |
| `POST /api/v1/projects/:project/environments`, `PATCH/DELETE …/:env` | Environments |
| `GET /api/v1/projects/:project/secrets?env=&path=&deep=1&key=&values=1` | Secrets. Values only with `values=1` (logged) |
| `POST /api/v1/projects/:project/secrets` | `{ env, path, key, type, value, note, url, alsoIn: [env…], upsert }` |
| `GET/PATCH/DELETE /api/v1/secrets/:id` | One secret. A new `value` makes a new version |
| `GET /api/v1/secrets/:id/value?version=` | The value (logged) |
| `GET /api/v1/secrets/:id/versions`, `POST …/restore` | History |
| `GET /api/v1/search?q=`, `?host=` | Find secrets (no values). `host` returns the ones whose URL is on that site |
| `POST /api/v1/generate` | `{ kind: password \| key \| uuid \| keypair \| certificate, … }`. Nothing is stored |
| `GET/POST /api/v1/shares`, `DELETE …/:id` | One-time links: `{ secretId }` or `{ value }`, `hours`, `views`, `label` |
| `POST /api/v1/shares/open` | `{ id, key }` → the value. Public |
