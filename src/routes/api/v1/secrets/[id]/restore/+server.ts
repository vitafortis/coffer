import { json } from '@sveltejs/kit';
import { actor, body, handler, int, NotFound, requireWrite } from '#lib/server/http.ts';
import { describeValue, refOf, secretOr404 } from '#lib/server/secrets.ts';
import { logActivity, readSecretValue, updateSecret } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Makes an old value current again, as a new version (history is never rewritten). */
export const POST: RequestHandler = handler(async ({ params, request, locals }) => {
	requireWrite(locals);
	const s = secretOr404(params.id);
	const version = int(await body(request), 'version', { min: 1 });
	const value = version ? readSecretValue(s.id, version) : undefined;
	if (value === undefined) throw new NotFound('That version is no longer kept');
	const out = updateSecret(s.id, { value, meta: describeValue(s.type, value), by: actor(locals) });
	logActivity('secret.restored', { actor: actor(locals), target: refOf(s), detail: `v${version} → v${out.version}` });
	return json({ secret: out });
});
