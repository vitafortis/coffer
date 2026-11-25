import { decryptShare, encryptShare, randomToken } from './crypto.ts';
import { claimShareView, createShare, getSettings, getShare } from './store.ts';
import type { Share } from '#lib/types.ts';

export const MAX_SHARE_HOURS = 24 * 30;
export const MAX_SHARE_VIEWS = 20;

/**
 * Makes a one-time link. The link is /s/<id>#<key>: the id finds the row, the key (never sent
 * in a URL path, never stored) decrypts it. Browsers don't send the #fragment to servers or in
 * Referer headers, so it stays out of proxy and access logs too.
 */
export function makeShare(input: { value: string; label: string | null; source: string | null; createdBy: string | null; hours: number; maxViews: number }, origin: string): { share: Share; url: string } {
	const id = randomToken(12);
	const key = randomToken(32);
	const share = createShare({
		id,
		ciphertext: encryptShare(input.value, key, id),
		label: input.label,
		source: input.source,
		createdBy: input.createdBy,
		expiresAt: new Date(Date.now() + input.hours * 3_600_000).toISOString(),
		maxViews: input.maxViews
	});
	return { share, url: shareUrl(origin, id, key) };
}

/** The address links are shared at: Settings' public URL, else the one this request came in on. */
export function shareUrl(origin: string, id: string, key: string): string {
	const base = getSettings().publicUrl.replace(/\/+$/, '') || origin;
	return `${base}/s/${id}#${key}`;
}

export type OpenResult =
	| { ok: true; value: string; label: string | null; remaining: number }
	| { ok: false; status: 404 | 403 | 410; message: string; state?: Share['state'] };

/**
 * Opens a link: checks the key first (a wrong key uses nothing up), then takes a view. The last
 * view wipes the ciphertext.
 */
export function openShare(id: string, key: string): OpenResult {
	const share = /^[\w-]{8,32}$/.test(id) ? getShare(id) : undefined;
	if (!share) return { ok: false, status: 404, message: 'This link does not exist' };
	if (share.state !== 'active' || !share.ciphertext) return { ok: false, status: 410, message: goneMessage(share.state), state: share.state };
	const value = /^[\w-]{20,64}$/.test(key) ? decryptShare(share.ciphertext, key, id) : undefined;
	if (value === undefined) return { ok: false, status: 403, message: 'This link is incomplete: copy the whole address, including the part after #' };
	if (!claimShareView(id)) return { ok: false, status: 410, message: goneMessage('opened'), state: 'opened' };
	return { ok: true, value, label: share.label, remaining: share.maxViews - share.views - 1 };
}

export function goneMessage(state: Share['state']): string {
	return state === 'opened' ? 'This link has already been opened' : state === 'revoked' ? 'This link was turned off' : 'This link has expired';
}
