import { json } from '@sveltejs/kit';
import { actor, body, Conflict, handler, requireWrite, str } from '#lib/server/http.ts';
import { checkKey, checkPath, checkType, describeValue, MAX_VALUE, refOf, secretOr404 } from '#lib/server/secrets.ts';
import { deleteSecret, findSecret, logActivity, readSecretValue, updateSecret } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(({ params }) => json({ secret: secretOr404(params.id) }));

/** Changes any of key, path, type, note, value. A new value is a new version. */
export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireWrite(locals);
	const s = secretOr404(params.id);
	const b = await body(request);
	const key = b.key !== undefined ? checkKey(str(b, 'key', { max: 200 })) : undefined;
	const path = b.path !== undefined ? checkPath(str(b, 'path')) : undefined;
	const type = b.type !== undefined ? checkType(str(b, 'type')) : undefined;
	const value = b.value !== undefined ? str(b, 'value', { required: true, max: MAX_VALUE, trim: false })! : undefined;
	if ((key && key !== s.key) || (path && path !== s.path)) {
		const clash = findSecret(s.environmentId, path ?? s.path, key ?? s.key);
		if (clash && clash.id !== s.id) throw new Conflict(`${key ?? s.key} already exists there`);
	}
	// Re-read what the value says about itself when either the value or the type changes.
	const meta = value !== undefined || type !== undefined ? describeValue(type ?? s.type, value ?? readSecretValue(s.id)!) : undefined;
	const before = refOf(s);
	const out = updateSecret(s.id, { key, path, type, value, meta, note: b.note !== undefined ? str(b, 'note', { max: 2000 }) : undefined, by: actor(locals) });
	logActivity('secret.updated', { actor: actor(locals), target: refOf(out), detail: [value !== undefined ? `v${out.version}` : null, refOf(out) !== before ? `was ${before}` : null].filter(Boolean).join(', ') || null });
	return json({ secret: out });
});

export const DELETE: RequestHandler = handler(({ params, locals }) => {
	requireWrite(locals);
	const s = secretOr404(params.id);
	const ref = refOf(s);
	deleteSecret(s.id);
	logActivity('secret.deleted', { actor: actor(locals), target: ref });
	return json({ ok: true });
});
