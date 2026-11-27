# Behind a reverse proxy

Most installs put Coffer behind Caddy, nginx, Traefik, Pangolin or a tunnel that terminates TLS. Coffer works without any of the settings below, but some parts work wrongly. The short version:

1. Serve Coffer at the **root of its own host name**, such as `https://coffer.example.com`. It can't be served under a path.
2. Have the proxy pass **`Host`**, **`X-Forwarded-Proto`** and **`X-Forwarded-For`**.
3. Tell Coffer to **trust those headers**, and make sure only the proxy can reach it.
4. Set **Settings → Server → Public URL** to the address people use.

## Trust the forwarded headers

Add these to the `environment:` of the `coffer` service in `compose.yaml`:

```yaml
    environment:
      PROTOCOL_HEADER: x-forwarded-proto
      ADDRESS_HEADER: x-forwarded-for
      XFF_DEPTH: 1          # how many proxies stand in front of Coffer
      # Only if your proxy rewrites Host and sends the original as X-Forwarded-Host:
      # HOST_HEADER: x-forwarded-host
```

What each one does:

| Variable | Without it |
| --- | --- |
| `PROTOCOL_HEADER` | Coffer still reads `X-Forwarded-Proto` to decide whether the sign-in cookie is marked `Secure`, but setting this makes the whole app agree that it's on `https`. Without either, the cookie isn't `Secure`. |
| `ADDRESS_HEADER`, `XFF_DEPTH` | **Every request appears to come from the proxy.** Sign-ins are limited to 10 per address every 5 minutes, so the whole team shares one budget, and one person mistyping a password can lock everyone out for a few minutes. The activity log also shows the proxy's address for every sign-in. |
| `HOST_HEADER` | Only needed when the proxy replaces `Host`. Coffer builds the CLI installer and one-time links from the host name, unless you set a Public URL. |

`XFF_DEPTH` counts proxies from Coffer outwards: `1` for one proxy, `2` for a proxy behind a CDN or load balancer, and so on. Coffer reads the address that many hops from the right of `X-Forwarded-For`, which is the one your own proxy added. A client can't fake it.

> **Only the proxy may reach Coffer.** With these set, Coffer believes whatever those headers say. If port 3070 is open to anyone else, they can claim any address and any protocol. Publish the port on loopback (`"127.0.0.1:3070:3000"`), or drop `ports:` and put Coffer and the proxy on the same Docker network.

## Public URL

**Settings → Server → Public URL** (admins only) is the address one-time links and the CLI installer use, such as `https://coffer.example.com`. If it's blank, they use whatever address the request came in on, which behind a proxy is right only when the headers above are.

## Example configurations

### Caddy

Caddy passes `Host`, `X-Forwarded-Proto` and `X-Forwarded-For` by default.

```
coffer.example.com {
	reverse_proxy 127.0.0.1:3070
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name coffer.example.com;
    # ssl_certificate …; ssl_certificate_key …;

    location / {
        proxy_pass http://127.0.0.1:3070;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}
```

The default `client_max_body_size` (1 MB) is enough: a secret's value is at most 256 KB.

### Traefik

```yaml
services:
  coffer:
    image: ghcr.io/vitafortis/coffer:latest
    environment:
      PROTOCOL_HEADER: x-forwarded-proto
      ADDRESS_HEADER: x-forwarded-for
      XFF_DEPTH: 1
    labels:
      - traefik.enable=true
      - traefik.http.routers.coffer.rule=Host(`coffer.example.com`)
      - traefik.http.routers.coffer.entrypoints=websecure
      - traefik.http.routers.coffer.tls.certresolver=letsencrypt
      - traefik.http.services.coffer.loadbalancer.server.port=3000
    volumes:
      - coffer-data:/data
```

### Pangolin

On the Coffer resource, keep **SSO** (or other authentication) on, and under **Rules** turn rules on and add:

| Action | Match | Value |
| --- | --- | --- |
| Always Allow | Path | `/api/v1/*` |
| Always Allow | Path | `/cli/*` |

Add `/s/*`, `/api/v1/shares/open`, `/_app/*` and `/favicon.svg` as well if people without an account should open one-time links. The section below explains why these paths are safe to allow. Pangolin's tunnel adds one hop, so check the client addresses in **Activity** after a sign-in. If they all show the same internal address, raise `XFF_DEPTH`.

## Sign-in at the proxy

You can put Coffer behind your proxy's own sign-in (Authelia, Authentik, oauth2-proxy, Cloudflare Access, Pangolin and so on), and people sign in to Coffer after that. Let these paths through without the proxy's sign-in:

| Path | Why |
| --- | --- |
| `/api/v1/` | The CLI and the browser extension. Every request carries an API token. |
| `/cli/` | The CLI, its installer and the extension download. They hold nothing secret. |
| `/api/health` | The container health check, if something outside checks it. |

The CLI and extension sign in to Coffer with `Authorization: Bearer cof_…`. When a request carries a token, Coffer uses only the token: a revoked or mistyped token is refused even if a valid Coffer session cookie comes along with it.

> **"The extension works, but the CLI doesn't."** Once you've allowed the extension access to Coffer's site, the browser attaches that site's cookies to the extension's requests, including your proxy's sign-in cookie. So the extension gets past the proxy while you're signed in to the proxy, and stops when that session ends. The CLI has no browser cookies and never gets past it. Both report *"Something in front of Coffer answered instead"* when that happens. Letting the paths above through fixes both.

Tokens only work on `/api/v1/`, so letting that path through doesn't let a token open the web app.

## Expose only one-time links

To keep Coffer on your network but let people outside open one-time links, publish a second host name that serves only what a link needs:

| Path | Why |
| --- | --- |
| `/s/` | The link page. |
| `/api/v1/shares/open` | Opening the link (a POST). It's rate-limited per address, so pass `X-Forwarded-For`. |
| `/_app/` | The page's scripts and styles. Without them the page loads but **Show** does nothing. |
| `/favicon.svg` | The tab icon. |

Then set **Public URL** to that host name, so new links point at it.

With Caddy:

```
share.example.com {
	@link path /s/* /api/v1/shares/open /_app/* /favicon.svg
	handle @link {
		reverse_proxy 127.0.0.1:3070
	}
	respond 404
}
```

With nginx:

```nginx
server {
    listen 443 ssl;
    server_name share.example.com;

    location ~ ^/(s/|api/v1/shares/open$|_app/|favicon\.svg$) {
        proxy_pass http://127.0.0.1:3070;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
    location / { return 404; }
}
```

The key that decrypts a link is in its `#fragment`, which browsers never send to servers, so it doesn't appear in your proxy's access logs either.
