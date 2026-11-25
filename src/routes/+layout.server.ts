import type { LayoutServerLoad } from './$types';
import { getSettings, listProjects } from '#lib/server/store.ts';
import type { Viewer } from '#lib/types.ts';

export const load: LayoutServerLoad = ({ locals }) => {
	const user = locals.user;
	const signedIn = locals.auth === 'authenticated' && locals.via?.kind === 'session';
	const viewer: Viewer | null = user && signedIn ? { id: user.id, email: user.email, name: user.name, admin: user.role === 'admin' } : null;
	return {
		auth: locals.auth,
		version: __APP_VERSION__,
		viewer,
		// One-time link pages are public: they get nothing about the rest of Coffer.
		projects: signedIn ? listProjects().map((p) => ({ id: p.id, slug: p.slug, name: p.name, secretCount: p.secretCount })) : [],
		shareHours: signedIn ? getSettings().shareHours : 24
	};
};
