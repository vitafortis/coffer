import { api } from './api.ts';
import { writeClipboard } from './clipboard.ts';
import { toast } from './state.svelte.ts';

/** Loads a value only when it's needed (every read is logged on the server). */
export async function readValue(id: string, version?: number): Promise<string> {
	return (await api.get<{ value: string }>(`/api/v1/secrets/${id}/value${version ? `?version=${version}` : ''}`)).value;
}

let clearTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Copies a value and clears the clipboard 30 seconds later, if it still holds that value
 * (and the page is still open: browsers only let a page touch the clipboard while it's open).
 */
export async function copyValue(value: string, label: string): Promise<boolean> {
	const ok = await writeClipboard(value);
	if (!ok) {
		toast('error', 'Could not copy to the clipboard');
		return false;
	}
	toast('success', `Copied ${label}`, 'The clipboard clears in 30 seconds.');
	clearTimeout(clearTimer);
	clearTimer = setTimeout(async () => {
		try {
			if (!navigator.clipboard?.readText || (await navigator.clipboard.readText()) === value) await writeClipboard('');
		} catch {
			// Reading needs permission; without it, clear anyway rather than leave the secret.
			await writeClipboard('').catch(() => {});
		}
	}, 30_000);
	return true;
}

export async function copySecret(id: string, label: string): Promise<boolean> {
	try {
		// Safari only allows clipboard writes straight after the click, so hand it a promise.
		if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write && window.isSecureContext && /^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
			const text = readValue(id);
			await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
			toast('success', `Copied ${label}`);
			return true;
		}
		return copyValue(await readValue(id), label);
	} catch (err) {
		toast('error', 'Could not copy', err instanceof Error ? err.message : String(err));
		return false;
	}
}
