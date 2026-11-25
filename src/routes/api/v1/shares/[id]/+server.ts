import { json } from '@sveltejs/kit';
import { actor, Forbidden, handler, NotFound } from '#lib/server/http.ts';
import { deleteShare, getShare, logActivity, revokeShare } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

function mine(id: string, locals: App.Locals) {
	const s = getShare(id);
	if (!s) throw new NotFound('No such link');
	if (s.createdBy !== locals.user?.email && locals.user?.role !== 'admin') throw new Forbidden('That link is someone else’s');
	return s;
}

/** Turns a link off (and wipes what it holds). ?forget=1 also removes it from the list. */
export const DELETE: RequestHandler = handler(({ params, url, locals }) => {
	const s = mine(params.id, locals);
	if (url.searchParams.get('forget') === '1') deleteShare(s.id);
	else revokeShare(s.id);
	logActivity('share.revoked', { actor: actor(locals), target: s.source ?? `link ${s.id}` });
	return json({ ok: true });
});
