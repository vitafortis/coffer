import { listShares } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const everyone = url.searchParams.get('all') === '1' && locals.user?.role === 'admin';
	return { shares: listShares(everyone ? undefined : locals.user!.email), everyone };
};
