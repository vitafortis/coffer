import { json } from '@sveltejs/kit';
import { actor, body, BadRequest, handler, int, str } from '#lib/server/http.ts';
import { MAX_VALUE, refOf, secretOr404 } from '#lib/server/secrets.ts';
import { makeShare, MAX_SHARE_HOURS, MAX_SHARE_VIEWS } from '#lib/server/shares.ts';
import { getSettings, listShares, logActivity, readSecretValue } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Your links; admins see everyone's with ?all=1. */
export const GET: RequestHandler = handler(({ locals, url }) => {
	const everyone = url.searchParams.get('all') === '1' && locals.user?.role === 'admin';
	return json({ shares: listShares(everyone ? undefined : locals.user!.email) });
});

/**
 * Makes a one-time link to a stored secret ({ secretId }) or to any text ({ value }).
 * { hours, views } set how long it lasts and how many times it opens (default: 1 view).
 * Read-only tokens may share: sharing reads, it doesn't change what's stored.
 */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	const b = await body(request);
	const secretId = str(b, 'secretId');
	let value: string;
	let source: string | null = null;
	if (secretId) {
		const s = secretOr404(secretId);
		value = readSecretValue(s.id)!;
		source = refOf(s);
	} else {
		value = str(b, 'value', { max: MAX_VALUE, trim: false }) ?? '';
		if (!value.trim()) throw new BadRequest('Nothing to share');
	}
	const by = actor(locals);
	const { share, url } = makeShare(
		{
			value,
			label: str(b, 'label', { max: 200 }),
			source,
			createdBy: locals.user!.email,
			hours: int(b, 'hours', { min: 1, max: MAX_SHARE_HOURS }) ?? getSettings().shareHours,
			maxViews: int(b, 'views', { min: 1, max: MAX_SHARE_VIEWS }) ?? 1
		},
		locals.origin
	);
	logActivity('share.created', { actor: by, target: source ?? `link ${share.id}`, detail: `${share.maxViews} view${share.maxViews === 1 ? '' : 's'}, until ${share.expiresAt}` });
	return json({ share, url }, { status: 201 });
});
