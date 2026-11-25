import type { Cookies } from '@sveltejs/kit';
import { config } from './config.ts';
import { hashPassword, randomToken, sha256 } from './crypto.ts';
import { authSessionUser, countUsers, createAuthSession, createToken, createUser, deleteAuthSession, tokenUser, touchUserLogin } from './store.ts';
import type { ApiToken, User } from '#lib/types.ts';

export const SESSION_COOKIE = 'coffer_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** API tokens start with this, so secret scanners and people can recognise them. */
export const TOKEN_PREFIX = 'cof_';

export type AuthState = 'setup' | 'anonymous' | 'authenticated';

/** How the request signed in: a browser session, or an API token (CLI, extension). */
export type AuthVia = { kind: 'session' } | { kind: 'token'; token: ApiToken };

let bootstrapped = false;

/** COFFER_ADMIN_EMAIL + COFFER_ADMIN_PASSWORD create the first account, so headless installs skip setup. */
function bootstrapAdmin() {
	bootstrapped = true;
	const b = config.bootstrapAdmin;
	if (!b || countUsers() > 0) return;
	if (b.password.length < 10) {
		console.warn('[coffer] COFFER_ADMIN_PASSWORD must be at least 10 characters; showing the setup screen instead.');
		return;
	}
	createUser({ email: b.email, name: b.name, passwordHash: hashPassword(b.password) });
	console.log(`[coffer] Created account ${b.email} from COFFER_ADMIN_EMAIL.`);
}

/**
 * Who is asking. A Bearer token wins over the cookie: the CLI and the extension never have
 * a session, and a token request never needs one.
 */
export function authenticate(cookies: Cookies, authorization: string | null): { state: AuthState; user: User | null; via: AuthVia | null } {
	if (!bootstrapped) bootstrapAdmin();
	if (countUsers() === 0) return { state: 'setup', user: null, via: null };
	const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (bearer) {
		const hit = bearer.startsWith(TOKEN_PREFIX) ? tokenUser(sha256(bearer)) : undefined;
		return hit ? { state: 'authenticated', user: hit.user, via: { kind: 'token', token: hit.token } } : { state: 'anonymous', user: null, via: null };
	}
	const session = cookies.get(SESSION_COOKIE);
	const user = session ? authSessionUser(sha256(session)) : undefined;
	return user ? { state: 'authenticated', user, via: { kind: 'session' } } : { state: 'anonymous', user: null, via: null };
}

export function startSession(cookies: Cookies, userId: string, secure: boolean) {
	const token = randomToken();
	createAuthSession(sha256(token), userId, SESSION_TTL_MS);
	touchUserLogin(userId);
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		// Cross-site writes are blocked by the Origin check in hooks.server.ts.
		sameSite: 'lax',
		secure,
		maxAge: SESSION_TTL_MS / 1000
	});
}

export function endSession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) deleteAuthSession(sha256(token));
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** A new API token. The plain token is returned once; only its hash is kept. */
export function issueToken(userId: string, name: string, readOnly: boolean, days: number | null): { token: string; record: ApiToken } {
	const token = TOKEN_PREFIX + randomToken(30);
	const record = createToken({
		userId,
		name,
		prefix: token.slice(0, TOKEN_PREFIX.length + 6),
		tokenHash: sha256(token),
		readOnly,
		expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null
	});
	return { token, record };
}

// Simple in-memory throttle: `max` attempts per 5 minutes per key (client address).
const attempts = new Map<string, number[]>();
export function throttled(key: string, max = 10): boolean {
	const now = Date.now();
	const recent = (attempts.get(key) ?? []).filter((t) => now - t < 5 * 60_000);
	recent.push(now);
	attempts.set(key, recent);
	if (attempts.size > 10_000) attempts.clear();
	return recent.length > max;
}
