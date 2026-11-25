import { getSettings, listTokens, listUsers } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const admin = locals.user?.role === 'admin';
	const settings = getSettings();
	return {
		me: locals.user!,
		tokens: listTokens(locals.user!.id),
		users: admin ? listUsers() : [],
		settings,
		// Where the CLI and extension should point: the public URL, else this address.
		base: settings.publicUrl || locals.origin
	};
};
