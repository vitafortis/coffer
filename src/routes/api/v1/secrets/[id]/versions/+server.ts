import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { secretOr404 } from '#lib/server/secrets.ts';
import { listSecretVersions } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(({ params }) => {
	const s = secretOr404(params.id);
	return json({ current: s.version, versions: listSecretVersions(s.id) });
});
