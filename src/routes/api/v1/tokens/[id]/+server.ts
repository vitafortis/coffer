import { json } from '@sveltejs/kit';
import { actor, handler, NotFound, requireSession } from '#lib/server/http.ts';
import { deleteToken, logActivity } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = handler(({ params, locals }) => {
	requireSession(locals);
	if (!deleteToken(params.id, locals.user!.id)) throw new NotFound('No such token');
	logActivity('token.revoked', { actor: actor(locals), target: params.id });
	return json({ ok: true });
});
