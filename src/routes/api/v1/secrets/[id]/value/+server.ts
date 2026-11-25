import { json } from '@sveltejs/kit';
import { actor, handler, NotFound } from '#lib/server/http.ts';
import { refOf, secretOr404 } from '#lib/server/secrets.ts';
import { logActivity, readSecretValue } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** The value (?version=N for an old one). Every read is logged. */
export const GET: RequestHandler = handler(({ params, url, locals }) => {
	const s = secretOr404(params.id);
	const version = url.searchParams.get('version') ? Number(url.searchParams.get('version')) : undefined;
	const value = readSecretValue(s.id, version);
	if (value === undefined) throw new NotFound('That version is no longer kept');
	logActivity('secret.read', { actor: actor(locals), target: refOf(s), detail: version && version !== s.version ? `v${version}` : null });
	return json({ value, version: version ?? s.version });
});
