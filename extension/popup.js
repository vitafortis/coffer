import { DEFAULT_OPTIONS, generatePassword, passwordBits } from './generate.js';
import { api, fillFocused, getConfig, scheduleClipboardClear } from './shared.js';

const $ = (id) => document.getElementById(id);
const TYPE_GLYPH = { text: 'T', password: '•', note: '¶', key: '⚿', certificate: '✓', keypair: '⌘' };
// Lucide's eye and copy, drawn inline (an extension page can't load the web app's icon set).
const svg = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EYE = svg('<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>');
const COPY = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');

let selected = 0;
let results = [];
let saving = null; // { value, type, key }

// ── Start ─────────────────────────────────────────────────────────────────────

const cfg = await getConfig();
if (cfg.url && cfg.token) showMain();
else showConnect();

function showConnect(error = '') {
	$('main').hidden = true;
	$('connect').hidden = false;
	$('c-url').value = cfg.url || '';
	$('c-error').textContent = error;
	($('c-url').value ? $('c-token') : $('c-url')).focus();
}

$('connect-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	$('c-error').textContent = '';
	let url;
	try {
		url = new URL($('c-url').value.trim()).origin;
	} catch {
		$('c-error').textContent = 'Enter the address you open Coffer at';
		return;
	}
	// Ask for access to just this one site.
	const granted = await chrome.permissions.request({ origins: [`${url}/*`] });
	if (!granted) {
		$('c-error').textContent = 'Coffer needs permission to talk to that address';
		return;
	}
	const token = $('c-token').value.trim();
	try {
		const res = await fetch(`${url}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
		const me = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(me.message ?? `${res.status} ${res.statusText}`);
		await chrome.storage.local.set({ url, token, email: me.email });
		Object.assign(cfg, { url, token, email: me.email });
		$('c-token').value = '';
		showMain();
	} catch (err) {
		$('c-error').textContent = err.message.includes('fetch') ? `Can't reach ${url}` : err.message;
	}
});

async function showMain() {
	$('connect').hidden = true;
	$('main').hidden = false;
	$('who').textContent = `${cfg.email || 'Connected'} · ${new URL(cfg.url).host}`;
	chrome.runtime.sendMessage({ target: 'background', type: 'clear-badge' }).catch(() => {});
	await showLastGenerated();
	loadOptions();
	$('q').focus();
	search('');
}

$('disconnect').addEventListener('click', async () => {
	await chrome.storage.local.remove(['token', 'email']);
	cfg.token = '';
	showConnect();
});

$('open-web').addEventListener('click', () => chrome.tabs.create({ url: cfg.url }));

// ── Tabs ──────────────────────────────────────────────────────────────────────

for (const b of document.querySelectorAll('.tabs button')) {
	b.addEventListener('click', () => {
		for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('active', x === b);
		$('tab-search').hidden = b.dataset.tab !== 'search';
		$('tab-generate').hidden = b.dataset.tab !== 'generate';
		if (b.dataset.tab === 'generate') regenerate();
		else $('q').focus();
	});
}

// ── Search ────────────────────────────────────────────────────────────────────

let timer;
$('q').addEventListener('input', () => {
	clearTimeout(timer);
	timer = setTimeout(() => search($('q').value), 120);
});

$('q').addEventListener('keydown', (e) => {
	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
		e.preventDefault();
		selected = Math.max(0, Math.min(results.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
		render();
	} else if (e.key === 'Enter' && results[selected]) {
		e.preventDefault();
		copySecret(results[selected]);
	}
});

async function search(q) {
	try {
		results = (await api(`/api/v1/search?limit=40&q=${encodeURIComponent(q.trim())}`)).results;
		selected = 0;
		render();
	} catch (err) {
		if (err.status === 401) return showConnect('That token no longer works. Make a new one in Coffer.');
		toast(err.message, true);
	}
}

const ref = (s) => `${s.projectSlug}/${s.envSlug}${s.path === '/' ? '' : s.path}`;

function render() {
	const ul = $('results');
	ul.replaceChildren();
	$('s-empty').hidden = results.length > 0;
	$('s-empty').textContent = $('q').value.trim() ? 'Nothing matches.' : 'No secrets yet.';
	results.forEach((s, i) => {
		const li = document.createElement('li');
		li.className = i === selected ? 'sel' : '';
		li.title = 'Click or Enter to copy';
		li.innerHTML = `<span class="t"></span><div class="txt"><div class="k"></div><div class="w"></div></div><div class="acts"><button class="icon" data-a="show" title="Show">${EYE}</button><button class="icon" data-a="copy" title="Copy">${COPY}</button></div>`;
		li.querySelector('.t').textContent = TYPE_GLYPH[s.type] ?? 'T';
		li.querySelector('.k').textContent = s.key;
		li.querySelector('.w').textContent = ref(s) + (s.note ? ` · ${s.note}` : '');
		li.addEventListener('click', (e) => {
			const a = e.target.closest('button')?.dataset.a;
			if (a === 'show') return reveal(s, li);
			copySecret(s);
		});
		li.addEventListener('mouseenter', () => {
			selected = i;
			for (const [j, x] of [...ul.children].entries()) x.className = j === i ? 'sel' : '';
		});
		ul.append(li);
	});
	ul.children[selected]?.scrollIntoView({ block: 'nearest' });
}

async function reveal(s, li) {
	const box = li.querySelector('.v');
	if (box) return box.remove();
	try {
		const { value } = await api(`/api/v1/secrets/${s.id}/value`);
		const v = document.createElement('div');
		v.className = 'v';
		v.textContent = value;
		li.querySelector('.txt').append(v);
	} catch (err) {
		toast(err.message, true);
	}
}

async function copySecret(s) {
	try {
		const { value } = await api(`/api/v1/secrets/${s.id}/value`);
		await copy(value, s.key);
	} catch (err) {
		toast(err.message, true);
	}
}

async function copy(value, label) {
	await navigator.clipboard.writeText(value);
	await scheduleClipboardClear(value);
	toast(`Copied ${label}. Clears in 30 seconds.`);
}

// ── Generate ──────────────────────────────────────────────────────────────────

const OPTION_IDS = ['lower', 'upper', 'digits', 'symbols', 'unambiguous'];

function loadOptions() {
	const o = { ...DEFAULT_OPTIONS, ...cfg.options };
	$('g-length').value = o.length;
	for (const k of OPTION_IDS) $(`g-${k}`).checked = !!o[k];
}

function options() {
	return { length: Number($('g-length').value), ...Object.fromEntries(OPTION_IDS.map((k) => [k, $(`g-${k}`).checked])) };
}

function regenerate() {
	const o = options();
	$('g-len-label').textContent = o.length;
	$('g-bits').textContent = `~${passwordBits(o)} bits`;
	try {
		$('g-value').textContent = generatePassword(o);
	} catch (err) {
		$('g-value').textContent = err.message;
	}
	// Remembered, and used by the right-click "Fill with a new password" too.
	cfg.options = o;
	chrome.storage.local.set({ options: o });
}

for (const id of ['g-length', ...OPTION_IDS.map((k) => `g-${k}`)]) $(id).addEventListener('input', regenerate);
$('g-again').addEventListener('click', regenerate);
$('g-copy').addEventListener('click', () => copy($('g-value').textContent, 'the password'));

$('g-fill').addEventListener('click', async () => {
	const value = $('g-value').textContent;
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	try {
		const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: fillFocused, args: [value] });
		if (!results.some((r) => r.result)) return toast('Click into a field on the page first, then try again.', true);
		let host = '';
		try {
			host = new URL(tab.url).hostname;
		} catch {}
		await chrome.storage.session.set({ lastGenerated: { value, host, at: Date.now(), filled: true } });
		toast('Filled. Save it so you don’t lose it.');
		openSave({ value, type: 'password', key: keyFor(host) });
	} catch {
		toast('This page can’t be filled (browser pages and the web store are off limits).', true);
	}
});

$('g-save').addEventListener('click', () => openSave({ value: $('g-value').textContent, type: 'password', key: '' }));

// ── The password made from the right-click menu ──────────────────────────────

async function showLastGenerated() {
	const { lastGenerated: g } = await chrome.storage.session.get('lastGenerated');
	// Offered for 15 minutes after it was made.
	if (!g || Date.now() - g.at > 15 * 60_000) return ($('last').hidden = true);
	$('last').hidden = false;
	$('last-host').textContent = g.host || 'this page';
	$('last-filled').textContent = g.filled ? '' : ' (copied: the field couldn’t be filled)';
	$('last-save').onclick = () => openSave({ value: g.value, type: 'password', key: keyFor(g.host) });
	$('last-dismiss').onclick = async () => {
		await chrome.storage.session.remove('lastGenerated');
		$('last').hidden = true;
	};
}

const keyFor = (host) => (host ? `${host.replace(/^www\./, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_PASSWORD` : '');

// ── Save ──────────────────────────────────────────────────────────────────────

let projects = [];

async function openSave(item) {
	saving = item;
	$('save').hidden = false;
	$('sv-key').value = item.key || '';
	$('sv-error').textContent = '';
	try {
		projects = (await api('/api/v1/projects')).projects;
	} catch (err) {
		$('sv-error').textContent = err.message;
		return;
	}
	if (!projects.length) {
		$('sv-error').textContent = 'Make a project in Coffer first.';
		return;
	}
	const last = (await chrome.storage.local.get('lastSave')).lastSave ?? {};
	$('sv-project').replaceChildren(...projects.map((p) => new Option(p.name, p.slug, false, p.slug === last.project)));
	fillEnvs(last.env);
	$('sv-path').value = last.path ?? '/';
	$('sv-key').focus();
}

function fillEnvs(prefer) {
	const p = projects.find((x) => x.slug === $('sv-project').value) ?? projects[0];
	$('sv-env').replaceChildren(...p.environments.map((e) => new Option(e.name, e.slug, false, e.slug === prefer)));
}

$('sv-project').addEventListener('change', () => fillEnvs());
$('sv-cancel').addEventListener('click', () => ($('save').hidden = true));

$('save').addEventListener('submit', async (e) => {
	e.preventDefault();
	$('sv-error').textContent = '';
	const project = $('sv-project').value;
	const env = $('sv-env').value;
	const path = $('sv-path').value || '/';
	try {
		await api(`/api/v1/projects/${encodeURIComponent(project)}/secrets`, {
			method: 'POST',
			body: { env, path, key: $('sv-key').value.trim(), type: saving.type, value: saving.value, note: $('sv-note').value || undefined }
		});
		await chrome.storage.local.set({ lastSave: { project, env, path } });
		await chrome.storage.session.remove('lastGenerated');
		$('save').hidden = true;
		$('last').hidden = true;
		toast(`Saved ${$('sv-key').value.trim()} to ${project}/${env}`);
		search($('q').value);
	} catch (err) {
		$('sv-error').textContent = err.message;
	}
});

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function toast(msg, error = false) {
	const t = $('toast');
	t.textContent = msg;
	t.className = `toast${error ? ' error' : ''}`;
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (t.hidden = true), error ? 4000 : 2200);
}
