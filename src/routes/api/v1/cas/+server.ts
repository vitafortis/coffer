import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { searchSecrets } from '#lib/server/store.ts';
import { secretRef } from '#lib/paths.ts';
import type { RequestHandler } from './$types';

/** Certificate authorities stored with their keys: what new certificates can be issued from. */
export const GET: RequestHandler = handler(() => {
	const cas = searchSecrets('', 10_000)
		.filter((s) => s.type === 'certificate' && s.meta.cert?.ca && s.meta.cert.hasKey && Date.parse(s.meta.cert.validTo) > Date.now())
		.map((s) => ({ id: s.id, ref: secretRef(s.projectSlug, s.envSlug, s.path, s.key), subject: s.meta.cert!.subject, validTo: s.meta.cert!.validTo }));
	return json({ cas });
});
