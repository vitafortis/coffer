import { error } from '@sveltejs/kit';
import { getShare } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

/**
 * What a one-time link says before it's opened: its label, and whether it still works. The value
 * only comes from the POST in /api/v1/shares/open, with the key from the #fragment.
 */
export const load: PageServerLoad = ({ params, setHeaders }) => {
	setHeaders({ 'x-robots-tag': 'noindex, nofollow' });
	const share = /^[\w-]{8,32}$/.test(params.id) ? getShare(params.id) : undefined;
	if (!share) error(404, 'This link does not exist');
	return {
		id: share.id,
		label: share.label,
		state: share.state,
		expiresAt: share.expiresAt,
		remaining: Math.max(0, share.maxViews - share.views),
		from: share.createdBy
	};
};
