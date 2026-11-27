# Install

Coffer is one container with a SQLite database in a volume. It needs Docker and nothing else.

## Docker Compose

```sh
mkdir coffer && cd coffer
curl -fsSLO https://raw.githubusercontent.com/vitafortis/coffer/main/compose.yaml
docker compose up -d
```

Open `http://<your-host>:3070` and create the admin account. To create the admin from the environment instead, see [Configuration](configuration.html).

The compose file mounts one volume, `coffer-data` at `/data`. It holds the database (encrypted secrets, people, tokens, links) and `secret.key`, the master key.

## Back up the key, separately

Secret values are encrypted with AES-256-GCM under a master key. That's `COFFER_SECRET_KEY` if you set it; otherwise it's a random key that Coffer creates at `/data/secret.key` on first start.

> Keep a copy of the key somewhere other than your database backups. Without it the secrets can't be read. With it, anyone holding a database backup can read them all.

## Where to run it

Keep Coffer on your LAN, a VPN, or behind your reverse proxy's sign-in. Anyone who reaches the sign-in page can try passwords, though attempts are rate-limited per address. If you want people outside to open one-time links, expose only the paths those links need: see [Behind a reverse proxy](reverse-proxy.html#expose-only-one-time-links).

Serve Coffer at the root of its own host name (`https://coffer.example.com`), not under a path such as `https://example.com/coffer`. The app's links and assets assume the root.

## Upgrading

```sh
docker compose pull
docker compose up -d
```

The database migrates itself on start. Images are published for amd64 and arm64 at `ghcr.io/vitafortis/coffer`: `:latest` follows `main`, and release tags such as `:1.2` stay fixed.

## Build from source

```sh
git clone https://github.com/vitafortis/coffer && cd coffer
docker build -t coffer .
```

Or, for development: `pnpm install`, then `pnpm dev`. Run `pnpm check`, `pnpm test` and `pnpm build` before sending changes.
