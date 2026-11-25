import { json } from '@sveltejs/kit';
import { SESSION_COOKIE } from '#lib/server/auth.ts';
import { hashPassword, sha256, verifyPassword } from '#lib/server/crypto.ts';
import { actor, body, BadRequest, Forbidden, handler, requireSession, str } from '#lib/server/http.ts';
import { deleteUserAuthSessions, getPasswordHash, getUser, logActivity, updateUser } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Your own name and password. A new password signs out your other sessions. */
export const PATCH: RequestHandler = handler(async ({ request, locals, cookies }) => {
	requireSession(locals);
	const me = locals.user!;
	const b = await body(request);
	if (b.name !== undefined) updateUser(me.id, { name: str(b, 'name', { max: 100 }) });
	const next = str(b, 'newPassword', { max: 500, trim: false });
	if (next !== null) {
		const current = str(b, 'currentPassword', { max: 500, trim: false }) ?? '';
		if (!verifyPassword(current, getPasswordHash(me.id) ?? '')) throw new Forbidden('Your current password is not right');
		if (next.length < 10) throw new BadRequest('Use at least 10 characters for the password');
		updateUser(me.id, { passwordHash: hashPassword(next) });
		const session = cookies.get(SESSION_COOKIE);
		deleteUserAuthSessions(me.id, session ? sha256(session) : undefined);
		logActivity('account.password', { actor: actor(locals) });
	}
	return json({ user: getUser(me.id) });
});
