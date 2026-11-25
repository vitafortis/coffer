# Coffer

- SvelteKit 3 + Svelte 5 runes + Tailwind 4, built with adapter-node; `server.js` drops root and loads `build/index.js`. No runtime dependencies: `node:sqlite` and `node:crypto` only.
- Scope: store and share secrets. No integrations that push secrets into other systems (clouds, CI, Kubernetes) and no `run`/env-injection; that's a product decision, not an omission.
- The theme is the shared ·modern palette (pg-modern, octo-modern, debrief, Orbital, Wharf, Saga) with primary hue 335 (garnet). Keep `src/app.css` in step with those projects rather than inventing new tokens; `extension/popup.css` mirrors the same tokens.
- Store (`src/lib/server/store.ts`, SQLite): projects → environments → secrets (path + key unique per environment). Values live in `secret_versions`, encrypted with AES-256-GCM under the master key (`crypto.ts`) with `secret:<id>:<version>` as AAD, so ciphertext moved to another row fails. The `secrets` row holds only metadata (`meta`: certificate facts, public key) so lists never decrypt.
- Every value read goes through `readSecretValue` and is logged as `secret.read` by the route. Don't add endpoints that return values without logging.
- One-time links (`shares.ts`): `/s/<id>#<key>`. The share is encrypted with HKDF(key, id); the key is never stored or sent in a path. `openShare` checks the key before `claimShareView`, which takes a view and wipes the ciphertext on the last one in one UPDATE. Opening is a POST.
- Auth (`auth.ts`, `hooks.server.ts`): session cookie for the web app, `Bearer cof_…` tokens (hashed) for the CLI and extension. Tokens only work on `/api/v1/*`; `requireSession` keeps account and token management off tokens; `requireWrite` stops read-only tokens. Cookie requests from another origin are refused; token requests get CORS.
- PKI (`pki.ts`): certificates and OpenSSH keys are DER/wire-encoded by hand. `tests/pki.test.ts` checks them with `X509Certificate` and against `ssh-keygen`; keep those passing.
- Password rules are written three times: `src/lib/generate.ts` (web + server), `extension/generate.js`, `cli/coffer.mjs`. Change them together.
- The CLI (`cli/coffer.mjs`) and extension (`extension/`) are served by `/cli/coffer`, `/cli/install.sh` and `/cli/coffer-extension.zip` (`assets.ts`, `zip.ts`); the CLI's `__COFFER_URL__` is replaced with the server's address.
- Checks: `pnpm check`, `pnpm test`, `pnpm build`.
