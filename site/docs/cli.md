# CLI

The CLI is one file that needs Node 20 or later and no packages. Coffer serves it already pointed at itself, so the install command comes from your own server.

## Install and sign in

```sh
curl -fsSL https://coffer.example.com/cli/install.sh | sh    # to ~/.local/bin/coffer
coffer login                                                 # paste a token from Settings → API tokens
coffer use billing-api prod                                  # default project and environment
```

**Settings → Command line** shows the install command for your server, and **Make a CLI token** creates a token to paste.

## Everyday use

```sh
coffer ls [folder] [--deep]                 # names, types, versions — never values
coffer get DATABASE_URL                     # the value, with no trailing newline when piped
coffer get billing-api/prod/db/PASSWORD     # or name it in full
coffer get API_KEY -c                       # copy instead; the clipboard clears in 30 s
coffer set API_KEY                          # hidden prompt; or `coffer set API_KEY value`, or pipe it in
coffer set GITHUB --url github.com          # the browser extension offers it on github.com
coffer set TLS --file cert-and-key.pem      # certificates and keys are recognised
coffer history API_KEY && coffer get API_KEY -v 3
coffer rm OLD_KEY
```

## Generating

```sh
coffer gen password -l 32 --save ADMIN_PASSWORD
coffer gen keypair --alg ed25519 --ssh --comment deploy@ci --save DEPLOY_KEY
coffer gen cert --cn api.internal --san 10.0.0.5 --days 90 --issuer infra/prod/ca/ROOT_CA --save TLS
```

Without `--save`, the generated value is printed and nothing is stored.

## One-time links

```sh
coffer share DATABASE_URL --expires 1h      # prints a one-time link
pg_dump … | gzip | base64 | coffer share -  # share anything once
coffer open 'https://…/s/abc#key'           # read a one-time link
```

## Options and environment

`-p/--project`, `-e/--env` and `--path` work with every command. The settings live in `~/.config/coffer/config.json` (mode 600). These override them:

| Variable | |
| --- | --- |
| `COFFER_URL` | The server. |
| `COFFER_TOKEN` | The API token, for scripts and CI. A read-only token is enough for `get`. |
| `COFFER_PROJECT`, `COFFER_ENV` | The default project and environment. |

Every value the CLI reads is recorded in **Activity**, with the token that read it.
