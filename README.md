<p align="center">
  <img src="docs/logo.svg" width="64" height="64" alt="" />
</p>

<h1 align="center">Coffer</h1>

<p align="center">
  Self-hosted secrets for a small team.<br />
  Projects and environments, passwords, keys, key pairs and certificates, version history,<br />
  and one-time links for handing a secret to someone without an account. A web app, a CLI and a browser extension.
</p>

<p align="center"><a href="https://vitafortis.github.io/coffer/">Website and docs</a></p>

Coffer stores and shares secrets. It deliberately doesn't push them anywhere: no syncing into
clouds, CI systems or Kubernetes. Things that need a secret fetch it (`coffer get`) or a person
copies it.

## Features

- **Projects → environments → folders → secrets.** Each project has environments (Development,
  Staging, Production by default; add, rename or remove them), and each environment its own value
  for every secret. Folders (`/db/replica`) keep big projects tidy. **Compare** lists a folder's
  names across environments side by side, so a key missing from production stands out, and copies
  it across in one click.
- **Types**: text, password, note (multi-line), key, certificate and key pair. The type changes how
  a secret is shown and generated: certificates show their subject, names, fingerprint and expiry;
  key pairs show their public key.
- **Generators**: passwords (length, character sets, no look-alikes), random keys (hex/base64),
  UUIDs, key pairs (Ed25519, ECDSA P-256/P-384, RSA; OpenSSH format and `authorized_keys` line for
  SSH), and X.509 certificates: self-signed, a CA, or issued by any CA stored in Coffer. Built on
  `node:crypto` alone and checked against `openssl verify` and `ssh-keygen`.
- **Certificates to renew**: the home page lists certificates expiring within 30 days.
- **History**: every value a secret has had (the last 30), who set it, and one-click restore.
- **One-time links**: share a stored secret or any text. The recipient opens the link, clicks
  **Show**, and sees it once; then the link is dead and the stored copy is wiped. Set how long it
  lasts (1 hour to 30 days) and how many times it opens (1 to 10). The link is
  `/s/<id>#<key>`: the key lives only in the `#fragment`, which browsers never send to servers,
  so neither Coffer's database nor its master key can open a link, and it stays out of proxy logs.
  Opening is a POST, so chat apps' link previews can't use it up.
- **Activity**: every read (web, CLI, extension), change, share and sign-in, with who did it and
  through which token.
- **People**: admins add people and manage settings; everyone can use every project.
- **API tokens**: personal, optionally read-only (read and share, no changes) and expiring. Only a
  hash is stored. Tokens work on `/api/v1` and nothing else, and can't make more tokens.
- **⌘K** finds any secret from anywhere; **⇧↵** copies it. Copied values are cleared from the
  clipboard after 30 seconds (if they're still there).
- **Light and dark**, on the same design system as Orbital, Wharf, Atrium and Saga, in garnet
  (hue 335).

## Run it

```sh
docker compose up -d
```

Then open `http://<this-host>:3070` and create the admin account. See [compose.yaml](compose.yaml)
for the options.

**Back up the key.** Secrets are encrypted with AES-256-GCM under a master key: `COFFER_SECRET_KEY`
if you set one, otherwise a random key created at `/data/secret.key`. Keep a copy of the key
somewhere other than your database backups. Without it the secrets can't be read; with it, anyone
holding a database backup can read them.

Keep Coffer on your LAN, a VPN, or behind your reverse proxy's sign-in. To send one-time links to
people outside, expose only `/s/`, `/api/v1/shares/open`, `/_app/` (the link page's scripts) and
`/favicon.svg`, and set **Settings → Public URL**. The CLI and extension need `/api/v1/` and `/cli/` (the
installer, which holds nothing secret) let through any sign-in at your proxy: they sign in to Coffer
with a token. The extension may seem to work without that while your browser is signed in to the
proxy, since the browser sends the proxy's cookie along with it, but the CLI won't.

### Behind a reverse proxy

Serve Coffer at the root of its own host name; it can't live under a path. Have the proxy pass
`Host`, `X-Forwarded-Proto` and `X-Forwarded-For`, and tell Coffer to trust them:

```yaml
    environment:
      PROTOCOL_HEADER: x-forwarded-proto
      ADDRESS_HEADER: x-forwarded-for
      XFF_DEPTH: 1    # proxies in front of Coffer
```

Without `ADDRESS_HEADER`, every request seems to come from the proxy: the sign-in limit (10 per
address per 5 minutes) is shared by the whole team, and the activity log shows the proxy's address.
Only set these when nothing but the proxy can reach Coffer's port. Caddy, nginx and Traefik
examples, and how to expose only one-time links:
[Behind a reverse proxy](https://vitafortis.github.io/coffer/docs/reverse-proxy.html).

### Environment

| Variable | |
| --- | --- |
| `COFFER_DATA_DIR` | Database and key file. `/data` in the image. |
| `COFFER_SECRET_KEY` | Master key. Unset: a random key in `$COFFER_DATA_DIR/secret.key`. |
| `COFFER_ADMIN_EMAIL`, `COFFER_ADMIN_PASSWORD` | Create the admin on start instead of in the setup screen. |
| `PROTOCOL_HEADER` | Behind a TLS-terminating proxy: `x-forwarded-proto`. |
| `ADDRESS_HEADER`, `XFF_DEPTH` | Behind a proxy: `x-forwarded-for` and how many proxies, so rate limits and the activity log see real addresses. |
| `HOST_HEADER` | Only when the proxy rewrites `Host`: `x-forwarded-host`. |

## CLI

One file, Node 20 or later, no packages. Coffer serves it pointed at itself:

```sh
curl -fsSL https://coffer.example.com/cli/install.sh | sh    # to ~/.local/bin/coffer
coffer login                                                 # paste a token from Settings → API tokens
coffer use billing-api prod                                  # default project and environment
```

```sh
coffer ls [folder] [--deep]                 # names, types, versions — never values
coffer get DATABASE_URL                     # the value, with no trailing newline when piped
coffer get billing-api/prod/db/PASSWORD     # or name it in full
coffer get API_KEY -c                       # copy instead; the clipboard clears in 30 s
coffer set API_KEY                          # hidden prompt; or `coffer set API_KEY value`, or pipe it in
coffer set TLS --file cert-and-key.pem      # certificates and keys are recognised
coffer gen password -l 32 --save ADMIN_PASSWORD
coffer gen keypair --alg ed25519 --ssh --comment deploy@ci --save DEPLOY_KEY
coffer gen cert --cn api.internal --san 10.0.0.5 --days 90 --issuer infra/prod/ca/ROOT_CA --save TLS
coffer history API_KEY && coffer get API_KEY -v 3
coffer share DATABASE_URL --expires 1h      # prints a one-time link
pg_dump … | gzip | base64 | coffer share -  # share anything once
coffer open 'https://…/s/abc#key'           # read a one-time link
```

`-p/--project`, `-e/--env` and `--path` work everywhere. `COFFER_URL`, `COFFER_TOKEN`,
`COFFER_PROJECT` and `COFFER_ENV` override `~/.config/coffer/config.json` (mode 600).

## Browser extension

For Chrome, Edge, Brave and Arc, installed unpacked:

1. **Settings → Browser extension → Download**, and unzip it somewhere it can stay (or use
   [`extension/`](extension) from this repo).
2. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → the folder.
3. Click the Coffer icon (or **⌘⇧K**), enter Coffer's address and an API token. It asks for access
   to that one site only.

What it does:

- **Search and copy**: type to find a secret across projects; **Enter** or a click copies it, and
  the clipboard clears after 30 seconds if it still holds the value.
- **This site first**: secrets whose URL is on the page you're on (or a domain above it, so
  `github.com` is offered on `gist.github.com`) are listed first, with **Fill in page**. Secrets with
  a URL show the site's icon, from the browser's own favicon cache, so no request leaves it.
- **Projects**: browse a project's secrets by environment, and add new ones with **+**.
- **Generate into fields**: right-click any field → **Fill with a new password** (it fills a
  matching "confirm password" box too). The popup then offers to save it, named after the site.
  The **Generate** tab has the options, **Fill in page**, **Copy** and **Save to a project**.

It never reads pages or fills existing logins by itself; it only touches a page when you use the
right-click menu or **Fill in page**. A password fills the focused field, or the page's first
password field when nothing is focused.

## API

Everything the web app, CLI and extension do goes through `/api/v1`, with either the session
cookie or `Authorization: Bearer cof_…`.

| | |
| --- | --- |
| `GET /api/v1/projects`, `POST` | List, create (`{ name, slug?, environments? }`) |
| `GET/PATCH/DELETE /api/v1/projects/:project` | Project (by slug or id), its environments and folders |
| `POST /api/v1/projects/:project/environments`, `PATCH/DELETE …/:env` | Environments |
| `GET /api/v1/projects/:project/secrets?env=&path=&deep=1&key=&values=1` | Secrets; values only with `values=1` (logged) |
| `POST /api/v1/projects/:project/secrets` | `{ env, path, key, type, value, note, url, alsoIn: [env…], upsert }` |
| `GET/PATCH/DELETE /api/v1/secrets/:id` | One secret; a new `value` makes a new version |
| `GET /api/v1/secrets/:id/value?version=` | The value (logged) |
| `GET /api/v1/secrets/:id/versions`, `POST …/restore` | History |
| `GET /api/v1/search?q=`, `?host=` | Find secrets (no values); `host` gives the ones whose URL is on that site |
| `POST /api/v1/generate` | `{ kind: password \| key \| uuid \| keypair \| certificate, … }`; nothing is stored |
| `GET/POST /api/v1/shares`, `DELETE …/:id` | One-time links: `{ secretId }` or `{ value }`, `hours`, `views`, `label` |
| `POST /api/v1/shares/open` | `{ id, key }` → the value. Public. |
| `GET /api/v1/activity` | The log |

## Development

```sh
pnpm install
pnpm dev        # http://localhost:3070, data in ./data
pnpm check && pnpm test && pnpm build
```

SvelteKit 3, Svelte 5, Tailwind 4, `node:sqlite`, `node:crypto`. No runtime dependencies.

## License

Apache-2.0
