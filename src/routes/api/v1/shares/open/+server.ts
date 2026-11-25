import { json } from '@sveltejs/kit';
import { throttled } from '#lib/server/auth.ts';
import { openShare } from '#lib/server/shares.ts';
import { logActivity } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/**
 * Opens a one-time link: { id, key }. Public: the key is the permission. A POST, so chat apps'
 * link previews (which only GET) can't use up the view.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (throttled(`share:${getClientAddress()}`, 30)) return json({ message: 'Too many attempts — wait a few minutes' }, { status: 429 });
	const { id, key } = await request.json().catch(() => ({}));
	if (typeof id !== 'string' || typeof key !== 'string') return json({ message: 'This link is incomplete' }, { status: 400 });
	const res = openShare(id, key);
	if (!res.ok) return json({ message: res.message, state: res.state }, { status: res.status });
	logActivity('share.opened', { target: `link ${id}`, detail: getClientAddress() });
	return json({ value: res.value, label: res.label, remaining: res.remaining }, { headers: { 'cache-control': 'no-store' } });
};
