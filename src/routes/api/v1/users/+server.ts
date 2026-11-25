import { json } from '@sveltejs/kit';
import { hashPassword } from '#lib/server/crypto.ts';
import { actor, body, BadRequest, Conflict, handler, requireAdmin, str } from '#lib/server/http.ts';
import { createUser, findUserByEmail, listUsers, logActivity } from '#lib/server/store.ts';
import type { UserRole } from '#lib/types.ts';
import type { RequestHandler } from './$types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET: RequestHandler = handler(({ locals }) => {
	requireAdmin(locals);
	return json({ users: listUsers() });
});

export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const b = await body(request);
	const email = str(b, 'email', { required: true, max: 200 })!;
	if (!EMAIL.test(email)) throw new BadRequest('Enter a valid email address');
	if (findUserByEmail(email)) throw new Conflict('Someone already has that email');
	const password = str(b, 'password', { required: true, max: 500, trim: false })!;
	if (password.length < 10) throw new BadRequest('Use at least 10 characters for the password');
	const role = (str(b, 'role') ?? 'member') as UserRole;
	if (role !== 'admin' && role !== 'member') throw new BadRequest('role is admin or member');
	const user = createUser({ email, name: str(b, 'name', { max: 100 }), passwordHash: hashPassword(password), role });
	logActivity('user.created', { actor: actor(locals), target: user.email, detail: role });
	return json({ user }, { status: 201 });
});
