import { expiringCertificates, listProjects, totals } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	projects: listProjects(),
	totals: totals(),
	// Certificates that run out within 30 days (or already have).
	expiring: expiringCertificates(new Date(Date.now() + 30 * 86_400_000))
});
