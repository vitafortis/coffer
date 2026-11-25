import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { searchSecrets } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Secrets by name, folder, note, project or environment (no values): ?q=stripe prod */
export const GET: RequestHandler = handler(({ url }) => {
	const q = (url.searchParams.get('q') ?? '').slice(0, 200);
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
	return json({ results: searchSecrets(q, limit) });
});
