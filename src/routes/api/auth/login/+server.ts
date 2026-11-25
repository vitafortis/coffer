import { json } from '@sveltejs/kit';
import { startSession, throttled } from '#lib/server/auth.ts';
import { hashPassword, verifyPassword } from '#lib/server/crypto.ts';
import { findUserByEmail, getPasswordHash, logActivity } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

// Verified against when the user doesn't exist, so timing doesn't reveal valid emails.
const DUMMY_HASH = hashPassword('coffer-dummy-password');

export const POST: RequestHandler = async ({ request, cookies, locals, getClientAddress }) => {
	if (throttled(`login:${getClientAddress()}`)) return json({ message: 'Too many attempts — wait a few minutes' }, { status: 429 });
	const { email, password } = await request.json().catch(() => ({}));
	if (typeof email !== 'string' || typeof password !== 'string') return json({ message: 'Incorrect email or password' }, { status: 401 });
	const user = findUserByEmail(email);
	const hash = user ? getPasswordHash(user.id) : undefined;
	const ok = verifyPassword(password, hash ?? DUMMY_HASH) && !!hash;
	if (!user || !ok) {
		logActivity('login.failed', { actor: email.slice(0, 200), detail: getClientAddress() });
		return json({ message: 'Incorrect email or password' }, { status: 401 });
	}
	startSession(cookies, user.id, locals.secure);
	logActivity('login', { actor: user.email, detail: getClientAddress() });
	return json({ ok: true });
};
