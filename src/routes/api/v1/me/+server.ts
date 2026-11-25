import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Who this token or session is: `coffer whoami`, and the extension's connection check. */
export const GET: RequestHandler = ({ locals }) => {
	const u = locals.user!;
	return json({
		email: u.email,
		name: u.name,
		role: u.role,
		via: locals.via?.kind,
		token: locals.via?.kind === 'token' ? { name: locals.via.token.name, readOnly: locals.via.token.readOnly, expiresAt: locals.via.token.expiresAt } : null,
		version: __APP_VERSION__
	});
};
