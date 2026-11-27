# Security model

Coffer is built for a small team that trusts each other with the same secrets. This page covers what it protects against, and what it doesn't.

## Values at rest

- Every value is encrypted with **AES-256-GCM** under the master key. The master key is `COFFER_SECRET_KEY` (stretched with scrypt) or the random key in `/data/secret.key`.
- Each ciphertext is bound to its secret and version (`secret:<id>:<version>` as associated data). Ciphertext copied onto another row fails to decrypt instead of showing up under a different name.
- Lists, search and the extension's site matching read only names, types, notes, URLs and certificate facts. They never decrypt.
- The last 30 values of each secret are kept, so they can be restored. Older ones are deleted.

> A database backup **plus** the master key is everything. Keep them apart.

## Reads are logged

Every value read goes through one place on the server and is recorded in **Activity** with who read it and through which token: showing or copying in the web app, `coffer get`, and copying, showing or filling from the extension. Changes, shares, sign-ins and failed sign-ins are recorded too.

## Signing in

- Passwords are hashed with scrypt. Sign-ins are limited to 10 per address every 5 minutes. Behind a proxy, [pass the client address](reverse-proxy.html#trust-the-forwarded-headers) so this limit applies per person.
- The web app uses an `HttpOnly`, `SameSite=Lax` session cookie that lasts 14 days, marked `Secure` on https.
- Requests that change something and ride on the cookie must come from Coffer's own origin. Others are refused.
- Pages and API responses that can contain values are sent with `Cache-Control: no-store`, and no page can be framed.

## API tokens

- Tokens (`cof_…`) are shown once. Only a SHA-256 hash is stored.
- A token works on `/api/v1/` and nowhere else, so it can't open the web app. It also can't create tokens or change your account.
- **Read-only** tokens can read and share, but not change anything. Tokens can expire, and **Settings → API tokens** shows when each was last used.
- When a request carries a token, Coffer uses only the token, never a cookie sent alongside it.

## One-time links

- A link is `/s/<id>#<key>`. The value is encrypted with a key derived (HKDF) from the link's key and id. The link's key is never stored, and it's never sent to the server in a path or a log line: it lives in the `#fragment`, which browsers keep to themselves.
- So neither the database nor the master key can open a link, and neither can anyone reading your proxy's logs.
- Opening is a POST after a click on **Show**, so chat apps' link previews can't use it up. The server checks the key before it counts a view, and the last view wipes the ciphertext in the same database write.
- Expired links are wiped every few minutes.

## What Coffer doesn't do

- **No per-project permissions.** Everyone who can sign in can read every project. Admins also manage people and settings. Run separate Coffers for groups that mustn't see each other's secrets.
- **No end-to-end encryption.** The server decrypts values to hand them out. Anyone with control of the server, or with the database and the key, can read everything.
- **No pushing secrets elsewhere.** Coffer doesn't sync into clouds, CI or Kubernetes, and doesn't inject environment variables. Things fetch what they need, and every fetch is logged.

Keep Coffer on a private network or behind your proxy's sign-in, and expose [only one-time links](reverse-proxy.html#expose-only-one-time-links) to the outside.
