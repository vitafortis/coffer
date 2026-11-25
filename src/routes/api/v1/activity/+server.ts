import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { listActivity } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(({ url }) => json({ activity: listActivity(Math.min(Number(url.searchParams.get('limit')) || 300, 2000), url.searchParams.get('target') ?? undefined) }));
