import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { searchSecrets, secretsForHost } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/**
 * Secrets by name, folder, note, URL, project or environment (no values): ?q=stripe prod.
 * ?host=app.example.com instead gives the secrets whose URL is on that site.
 */
export const GET: RequestHandler = handler(({ url }) => {
	const host = url.searchParams.get('host');
	if (host) return json({ results: secretsForHost(host.slice(0, 253)) });
	const q = (url.searchParams.get('q') ?? '').slice(0, 200);
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
	return json({ results: searchSecrets(q, limit) });
});
