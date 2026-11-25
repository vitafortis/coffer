import { json } from '@sveltejs/kit';
import { issueToken } from '#lib/server/auth.ts';
import { actor, body, bool, handler, int, requireSession, str } from '#lib/server/http.ts';
import { listTokens, logActivity } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(({ locals }) => json({ tokens: listTokens(locals.user!.id) }));

/** A new token for the CLI or the extension: { name, readOnly, days }. Shown once. */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireSession(locals);
	const b = await body(request);
	const name = str(b, 'name', { required: true, max: 80 })!;
	const { token, record } = issueToken(locals.user!.id, name, bool(b, 'readOnly') ?? false, int(b, 'days', { min: 1, max: 3650 }));
	logActivity('token.created', { actor: actor(locals), target: name, detail: record.readOnly ? 'read-only' : 'read-write' });
	return json({ token, record }, { status: 201 });
});
