import { json } from '@sveltejs/kit';
import { actor, body, BadRequest, handler, int, requireAdmin, str } from '#lib/server/http.ts';
import { MAX_SHARE_HOURS } from '#lib/server/shares.ts';
import { getSettings, logActivity, saveSettings } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(() => json({ settings: getSettings() }));

export const PUT: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const b = await body(request);
	const publicUrl = (str(b, 'publicUrl', { max: 300 }) ?? '').replace(/\/+$/, '');
	if (publicUrl && !/^https?:\/\/[^/\s]+/.test(publicUrl)) throw new BadRequest('The public URL starts with https:// (or http://)');
	const settings = { ...getSettings(), publicUrl, shareHours: int(b, 'shareHours', { min: 1, max: MAX_SHARE_HOURS }) ?? getSettings().shareHours };
	saveSettings(settings);
	logActivity('settings.updated', { actor: actor(locals) });
	return json({ settings });
});
