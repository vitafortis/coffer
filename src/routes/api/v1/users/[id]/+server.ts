import { json } from '@sveltejs/kit';
import { hashPassword } from '#lib/server/crypto.ts';
import { actor, body, BadRequest, handler, NotFound, requireAdmin, str } from '#lib/server/http.ts';
import { countAdmins, deleteUser, deleteUserAuthSessions, getUser, logActivity, updateUser } from '#lib/server/store.ts';
import type { UserRole } from '#lib/types.ts';
import type { RequestHandler } from './$types';

/** Change someone's role, name or password (resetting a password signs them out everywhere). */
export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireAdmin(locals);
	const user = getUser(params.id);
	if (!user) throw new NotFound('No such person');
	const b = await body(request);
	const role = str(b, 'role') as UserRole | null;
	if (role && role !== 'admin' && role !== 'member') throw new BadRequest('role is admin or member');
	if (role === 'member' && user.role === 'admin' && countAdmins() === 1) throw new BadRequest('Coffer needs at least one admin');
	const password = str(b, 'password', { max: 500, trim: false });
	if (password !== null && password.length < 10) throw new BadRequest('Use at least 10 characters for the password');
	updateUser(user.id, { role: role ?? undefined, name: b.name !== undefined ? str(b, 'name', { max: 100 }) : undefined, passwordHash: password ? hashPassword(password) : undefined });
	if (password) deleteUserAuthSessions(user.id);
	logActivity('user.updated', { actor: actor(locals), target: user.email, detail: [role && `role ${role}`, password && 'password reset'].filter(Boolean).join(', ') || null });
	return json({ user: getUser(user.id) });
});

export const DELETE: RequestHandler = handler(({ params, locals }) => {
	requireAdmin(locals);
	const user = getUser(params.id);
	if (!user) throw new NotFound('No such person');
	if (user.id === locals.user!.id) throw new BadRequest("You can't remove yourself");
	if (user.role === 'admin' && countAdmins() === 1) throw new BadRequest('Coffer needs at least one admin');
	deleteUser(user.id);
	logActivity('user.deleted', { actor: actor(locals), target: user.email });
	return json({ ok: true });
});
