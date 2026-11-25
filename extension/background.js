import { DEFAULT_OPTIONS, generatePassword } from './generate.js';
import { fillFocused } from './shared.js';

// Right-click any text or password field: fill it with a new password.
chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({ id: 'coffer-fill', title: 'Fill with a new password', contexts: ['editable'] });
		chrome.contextMenus.create({ id: 'coffer-fill-copy', title: 'Fill with a new password and copy it', contexts: ['editable'] });
	});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (!tab?.id || !info.menuItemId.toString().startsWith('coffer-fill')) return;
	const { options } = await chrome.storage.local.get('options');
	const value = generatePassword({ ...DEFAULT_OPTIONS, ...options });
	const [res] = await chrome.scripting
		.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId ?? 0] }, func: fillFocused, args: [value] })
		.catch(() => [{ result: false }]);
	// Kept (in memory, for this browser session) so the popup can offer to save it.
	let host = '';
	try {
		host = new URL(info.frameUrl || info.pageUrl || tab.url).hostname;
	} catch {}
	await chrome.storage.session.set({ lastGenerated: { value, host, at: Date.now(), filled: !!res?.result } });
	if (info.menuItemId === 'coffer-fill-copy' || !res?.result) await copyFromBackground(value);
	chrome.action.setBadgeBackgroundColor({ color: '#c2427f' });
	chrome.action.setBadgeText({ text: 'new', tabId: tab.id });
});

// The popup asks the background to clear the clipboard later; an offscreen page does the
// clipboard work, since a service worker has no clipboard of its own.
chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name !== 'clear-clipboard') return;
	const { clipboardHash } = await chrome.storage.session.get('clipboardHash');
	if (!clipboardHash) return;
	await withOffscreen(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'clear-if', hash: clipboardHash }));
	await chrome.storage.session.remove('clipboardHash');
});

async function copyFromBackground(value) {
	await withOffscreen(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', value }));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	await chrome.storage.session.set({ clipboardHash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') });
	await chrome.alarms.create('clear-clipboard', { delayInMinutes: 0.5 });
}

let creating;
async function withOffscreen(fn) {
	const has = await chrome.offscreen.hasDocument?.();
	if (!has) {
		creating ??= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'Copy generated passwords and clear the clipboard after 30 seconds' });
		await creating;
		creating = undefined;
	}
	return fn();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
	if (msg?.target !== 'background') return;
	if (msg.type === 'clear-badge') chrome.action.setBadgeText({ text: '' });
	reply(true);
});
