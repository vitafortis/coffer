# Introduction

Coffer is a self-hosted place for a small team's secrets: passwords, API keys, notes, key pairs and certificates, organised into projects and environments. You use it from a web app, a one-file CLI and a browser extension. One-time links let you hand a secret to someone who has no account.

Coffer stores and shares secrets. It deliberately doesn't push them anywhere: there's no syncing into clouds, CI systems or Kubernetes. Whatever needs a secret fetches it (`coffer get`), or a person copies it.

## How it's organised

```
project ─┬─ environment (Development, Staging, Production, …)
         │     └─ folder (/, /db, /db/replica)
         │           └─ secret: name, type, value (versioned), note, URL
         └─ environment …
```

- **Projects** hold **environments**, and each environment has its own value for every secret. **Compare** lists a folder's names side by side across environments, so a key missing from production stands out.
- **Types** change how a secret is shown and generated: text, password, note (multi-line), key, certificate and key pair. A certificate shows its subject, names and expiry; a key pair shows its public key.
- **History** keeps the last 30 values of every secret, with who set each one, and restores any of them in one click.
- **URL**: a secret can name the site it signs in to. The browser extension then lists it first on that site and can fill it in.

## What's in the box

- **Generators** for passwords, random keys, UUIDs, key pairs (Ed25519, ECDSA, RSA, also in OpenSSH format) and X.509 certificates: self-signed, a CA, or issued by a CA stored in Coffer.
- **One-time links**: share a stored secret or any text. It opens once (or up to 10 times) within a time limit, and then the stored copy is wiped.
- **Activity**: every read, change, share and sign-in, with who did it and through which token.
- **People and tokens**: admins add people; everyone can use every project. Personal API tokens can be read-only and can expire.

## Where to go next

- [Install](install.html) with Docker, then put it [behind a reverse proxy](reverse-proxy.html).
- Set up the [CLI](cli.html) and the [browser extension](extension.html).
- Read the [security model](security.html) before you store anything that matters.
