// Settings, the API, and filling fields: used by the popup and the background worker.

export async function getConfig() {
	const { url = '', token = '', email = '', options } = await chrome.storage.local.get(['url', 'token', 'email', 'options']);
	return { url, token, email, options };
}

export async function api(path, { method = 'GET', body } = {}) {
	const { url, token } = await getConfig();
	if (!url || !token) throw new Error('Not connected');
	let res;
	try {
		res = await fetch(url + path, {
			method,
			headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
			body: body ? JSON.stringify(body) : undefined
		});
	} catch {
		throw new Error(`Can't reach ${url}`);
	}
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.message ?? `${res.status} ${res.statusText}`);
		err.status = res.status;
		throw err;
	}
	return data;
}

/**
 * Runs in the page: puts `value` into the focused field (or the last one right-clicked) the way
 * typing would, so frameworks (React, Vue…) notice. Self-contained: it's injected on its own.
 */
export function fillFocused(value) {
	const isField = (el) => el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable);
	let el = document.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	if (!isField(el)) return false;
	el.focus();
	if (el.isContentEditable) {
		el.textContent = value;
	} else {
		const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
	}
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
	el.dispatchEvent(new Event('change', { bubbles: true }));
	// Fill a "confirm password" field that follows, when there's exactly one.
	if (el instanceof HTMLInputElement && el.type === 'password' && el.form) {
		const pw = [...el.form.querySelectorAll('input[type=password]')];
		const next = pw[pw.indexOf(el) + 1];
		if (pw.length === 2 && next && !next.value) {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(next, value);
			next.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
			next.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}
	return true;
}

/**
 * Runs in the page: fills a stored secret into the focused field or, for a password, the page's
 * first visible password field when nothing is focused. Self-contained: it's injected on its own.
 */
export function fillLogin(value, passwordFallback) {
	let el = document.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	// Focus is inside a frame: that frame fills, not this one.
	if (el instanceof HTMLIFrameElement) return false;
	if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
		if (!passwordFallback) return false;
		el = [...document.querySelectorAll('input[type=password]')].find((x) => x.offsetParent !== null && !x.disabled && !x.readOnly);
		if (!el) return false;
	}
	el.focus();
	const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
	el.dispatchEvent(new Event('change', { bubbles: true }));
	return true;
}

/** Clears the clipboard in 30 seconds, from the background (the popup closes long before). */
export async function scheduleClipboardClear(value) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	await chrome.storage.session.set({ clipboardHash: hash });
	await chrome.alarms.create('clear-clipboard', { delayInMinutes: 0.5 });
}
