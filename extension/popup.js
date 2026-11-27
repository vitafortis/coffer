import { DEFAULT_OPTIONS, generatePassword, passwordBits } from './generate.js';
import { api, failure, fillFocused, fillLogin, getConfig, scheduleClipboardClear } from './shared.js';

const $ = (id) => document.getElementById(id);
const TYPE_GLYPH = { text: 'T', password: '•', note: '¶', key: '⚿', certificate: '✓', keypair: '⌘' };
// Lucide's eye and copy, drawn inline (an extension page can't load the web app's icon set).
const svg = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EYE = svg('<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>');
const FILL = svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>');
const COPY = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');

let selected = 0;
let results = [];
let saving = null; // { value?, type, key, project?, env?, path?, url? }; no value: the form asks for one
let projects = [];
let current = null; // the project open in the Projects tab: { project, env }
let site = null; // the website the popup was opened on: { tabId, origin, host }

// ── Start ─────────────────────────────────────────────────────────────────────

const cfg = await getConfig();
if (cfg.url && cfg.token) showMain();
else showConnect();

/** The connect screen: first run, a dead token, or switching to another server. */
function showConnect(error = '', { switching = false } = {}) {
	$('main').hidden = true;
	$('connect').hidden = false;
	$('c-cancel').hidden = !switching;
	$('c-url').value = cfg.url || '';
	$('c-token').value = '';
	$('c-error').textContent = error;
	($('c-url').value ? $('c-token') : $('c-url')).focus();
}

$('connect-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	$('c-error').textContent = '';
	let url;
	try {
		// Any address: a host, a port, or a path if Coffer sits under one (https://example.com/coffer).
		const u = new URL($('c-url').value.trim());
		if (!/^https?:$/.test(u.protocol)) throw new Error();
		url = u.origin + u.pathname.replace(/\/+$/, '');
	} catch {
		$('c-error').textContent = 'Enter the address you open Coffer at';
		return;
	}
	// Ask for access to just this one site.
	const granted = await chrome.permissions.request({ origins: [`${new URL(url).origin}/*`] });
	if (!granted) {
		$('c-error').textContent = 'Coffer needs permission to talk to that address';
		return;
	}
	const token = $('c-token').value.trim();
	try {
		const res = await fetch(`${url}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
		if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) throw await failure(res);
		const me = await res.json();
		// Switching servers: let go of the old one's site access.
		const old = cfg.url && new URL(cfg.url).origin;
		if (old && old !== new URL(url).origin) await chrome.permissions.remove({ origins: [`${old}/*`] }).catch(() => {});
		await chrome.storage.local.set({ url, token, email: me.email });
		await chrome.storage.local.remove('lastSave');
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
	site = await currentSite();
	loadOptions();
	$('q').focus();
	search('');
}

$('who').addEventListener('click', () => showConnect('', { switching: true }));
$('c-cancel').addEventListener('click', () => {
	if (cfg.url && cfg.token) showMain();
});

$('disconnect').addEventListener('click', async () => {
	await chrome.storage.local.remove(['token', 'email']);
	cfg.token = '';
	showConnect();
});

$('open-web').addEventListener('click', () => chrome.tabs.create({ url: cfg.url }));
$('new-secret').addEventListener('click', () => openSave({ type: 'text', key: '', project: current?.project.slug, env: current?.env }));

// ── Tabs ──────────────────────────────────────────────────────────────────────

for (const b of document.querySelectorAll('.tabs button')) {
	b.addEventListener('click', () => {
		for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('active', x === b);
		for (const t of ['search', 'projects', 'generate']) $(`tab-${t}`).hidden = b.dataset.tab !== t;
		if (b.dataset.tab === 'generate') regenerate();
		else if (b.dataset.tab === 'projects') showProjects();
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
		// With nothing typed, the secrets for this site come first.
		const [hits, here] = await Promise.all([
			api(`/api/v1/search?limit=40&q=${encodeURIComponent(q.trim())}`),
			!q.trim() && site ? api(`/api/v1/search?host=${encodeURIComponent(site.host)}`) : { results: [] }
		]);
		results = [...here.results, ...hits.results.filter((s) => !here.results.some((h) => h.id === s.id))];
		$('site').hidden = !here.results.length;
		$('site').textContent = `${here.results.length} for ${site?.host}`;
		selected = 0;
		render();
	} catch (err) {
		failed(err);
	}
}

function failed(err) {
	if (err.status === 401 && !err.proxy) return showConnect('That token no longer works. Make a new one in Coffer.');
	toast(err.message, true);
}

const ref = (s) => `${s.projectSlug}/${s.envSlug}${s.path === '/' ? '' : s.path}`;

function render() {
	const ul = $('results');
	ul.replaceChildren();
	$('s-empty').hidden = results.length > 0;
	$('s-empty').textContent = $('q').value.trim() ? 'Nothing matches.' : 'No secrets yet.';
	results.forEach((s, i) => {
		const li = secretRow(s, ref(s));
		li.className = i === selected ? 'sel' : '';
		li.title = 'Click or Enter to copy';
		li.addEventListener('mouseenter', () => {
			selected = i;
			for (const [j, x] of [...ul.children].entries()) x.className = j === i ? 'sel' : '';
		});
		ul.append(li);
	});
	ul.children[selected]?.scrollIntoView({ block: 'nearest' });
}

/** One secret in a list: click to copy, the eye to show its value, and fill when it's for this site. */
function secretRow(s, where) {
	const li = document.createElement('li');
	li.title = 'Click to copy';
	const fill = onSite(s) && (s.type === 'password' || s.type === 'text') ? `<button class="icon" data-a="fill" title="Fill in page">${FILL}</button>` : '';
	li.innerHTML = `<span class="t"></span><div class="txt"><div class="k"></div><div class="w"></div></div><div class="acts">${fill}<button class="icon" data-a="show" title="Show">${EYE}</button><button class="icon" data-a="copy" title="Copy">${COPY}</button></div>`;
	const t = li.querySelector('.t');
	if (s.url) {
		// Chrome's own favicon cache: no request leaves the browser, so sites never visited show a globe.
		const img = new Image(16, 16);
		img.alt = '';
		img.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(s.url)}&size=32`);
		t.append(img);
		t.classList.add('fav');
		t.title = hostOf(s.url) ?? '';
	} else t.textContent = TYPE_GLYPH[s.type] ?? 'T';
	li.querySelector('.k').textContent = s.key;
	li.querySelector('.w').textContent = [where, s.note].filter(Boolean).join(' · ');
	li.addEventListener('click', (e) => {
		const a = e.target.closest('button')?.dataset.a;
		if (a === 'show') return reveal(s, li);
		if (a === 'fill') return fillSecret(s);
		copySecret(s);
	});
	return li;
}

// ── This site ─────────────────────────────────────────────────────────────────

/** The page the popup was opened on, when it's a website (clicking the toolbar button lends access to it). */
async function currentSite() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	const u = parseUrl(tab?.url);
	return u && /^https?:$/.test(u.protocol) ? { tabId: tab.id, origin: u.origin, host: u.hostname.replace(/^www\./, '') } : null;
}

function parseUrl(url) {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

const hostOf = (url) => parseUrl(url)?.hostname.toLowerCase().replace(/^www\./, '') || null;

/** A secret for this site: its URL is on the page's host or a domain above it, as the server matches. */
function onSite(s) {
	const h = site && s.url && hostOf(s.url);
	return !!h && (site.host === h || site.host.endsWith(`.${h}`));
}

async function fillSecret(s) {
	try {
		const { value } = await api(`/api/v1/secrets/${s.id}/value`);
		const res = await chrome.scripting.executeScript({ target: { tabId: site.tabId, allFrames: true }, func: fillLogin, args: [value, s.type === 'password'] });
		if (!res.some((r) => r.result)) return toast('Click into the field to fill, then try again.', true);
		window.close();
	} catch (err) {
		toast(err.message, true);
	}
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

// ── Projects ──────────────────────────────────────────────────────────────────

async function loadProjects() {
	projects = (await api('/api/v1/projects')).projects;
}

async function showProjects() {
	try {
		await loadProjects();
	} catch (err) {
		return failed(err);
	}
	if (current) return openProject(current.project.slug, current.env);
	$('p-view').hidden = true;
	const ul = $('p-list');
	ul.hidden = false;
	ul.replaceChildren(
		...projects.map((p) => {
			const li = document.createElement('li');
			li.innerHTML = `<span class="t">▤</span><div class="txt"><div class="k"></div><div class="w"></div></div><span class="n"></span>`;
			li.querySelector('.k').textContent = p.name;
			li.querySelector('.w').textContent = p.environments.map((e) => e.name).join(' · ');
			li.querySelector('.n').textContent = p.secretCount;
			li.addEventListener('click', () => openProject(p.slug));
			return li;
		})
	);
	$('p-empty').hidden = projects.length > 0;
	$('p-empty').textContent = 'No projects yet. Make one in Coffer.';
}

async function openProject(slug, envSlug) {
	const project = projects.find((p) => p.slug === slug);
	if (!project) return ((current = null), showProjects());
	const env = project.environments.find((e) => e.slug === envSlug) ?? project.environments[0];
	current = { project, env: env?.slug };
	$('p-list').hidden = true;
	$('p-view').hidden = false;
	$('p-name').textContent = project.name;
	$('p-envs').replaceChildren(
		...project.environments.map((e) => {
			const b = document.createElement('button');
			b.textContent = e.name;
			b.className = e.slug === current.env ? 'active' : '';
			b.addEventListener('click', () => openProject(slug, e.slug));
			return b;
		})
	);
	let secrets = [];
	try {
		if (env) secrets = (await api(`/api/v1/projects/${encodeURIComponent(slug)}/secrets?env=${encodeURIComponent(env.slug)}`)).secrets;
	} catch (err) {
		return failed(err);
	}
	$('p-secrets').replaceChildren(...secrets.map((s) => secretRow(s, s.path === '/' ? '' : s.path)));
	$('p-empty').hidden = secrets.length > 0;
	$('p-empty').textContent = `No secrets in ${env?.name ?? 'this project'} yet.`;
}

$('p-back').addEventListener('click', () => {
	current = null;
	showProjects();
});
$('p-new').addEventListener('click', () => openSave({ type: 'text', key: '', project: current.project.slug, env: current.env }));

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
		openSave({ value, type: 'password', key: keyFor(host), url: site?.origin });
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
	$('last-save').onclick = () => openSave({ value: g.value, type: 'password', key: keyFor(g.host), url: g.host ? `https://${g.host}` : undefined });
	$('last-dismiss').onclick = async () => {
		await chrome.storage.session.remove('lastGenerated');
		$('last').hidden = true;
	};
}

const keyFor = (host) => (host ? `${host.replace(/^www\./, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_PASSWORD` : '');

// ── Save ──────────────────────────────────────────────────────────────────────

async function openSave(item) {
	saving = item;
	const asking = item.value === undefined;
	$('save').hidden = false;
	$('sv-title').textContent = asking ? 'New secret' : 'Save to a project';
	$('sv-value-row').hidden = !asking;
	$('sv-value').value = '';
	$('sv-type').value = item.type;
	$('sv-key').value = item.key || '';
	$('sv-note').value = '';
	$('sv-url').value = item.url ?? '';
	$('sv-url-here').hidden = !site;
	$('sv-error').textContent = '';
	try {
		await loadProjects();
	} catch (err) {
		$('sv-error').textContent = err.message;
		return;
	}
	if (!projects.length) {
		$('sv-error').textContent = 'Make a project in Coffer first.';
		return;
	}
	const last = (await chrome.storage.local.get('lastSave')).lastSave ?? {};
	const project = item.project ?? last.project;
	$('sv-project').replaceChildren(...projects.map((p) => new Option(p.name, p.slug, false, p.slug === project)));
	fillEnvs(item.project ? item.env : last.env);
	$('sv-path').value = item.path ?? last.path ?? '/';
	$('sv-key').focus();
}

function fillEnvs(prefer) {
	const p = projects.find((x) => x.slug === $('sv-project').value) ?? projects[0];
	$('sv-env').replaceChildren(...p.environments.map((e) => new Option(e.name, e.slug, false, e.slug === prefer)));
}

$('sv-project').addEventListener('change', () => fillEnvs());
$('sv-url-here').addEventListener('click', () => ($('sv-url').value = site.origin));
$('sv-cancel').addEventListener('click', () => ($('save').hidden = true));

$('save').addEventListener('submit', async (e) => {
	e.preventDefault();
	$('sv-error').textContent = '';
	const project = $('sv-project').value;
	const env = $('sv-env').value;
	const path = $('sv-path').value || '/';
	const value = saving.value ?? $('sv-value').value;
	const type = saving.value === undefined ? $('sv-type').value : saving.type;
	if (!value) return ($('sv-error').textContent = 'Enter a value');
	try {
		await api(`/api/v1/projects/${encodeURIComponent(project)}/secrets`, {
			method: 'POST',
			body: { env, path, key: $('sv-key').value.trim(), type, value, note: $('sv-note').value || undefined, url: $('sv-url').value.trim() || undefined }
		});
		await chrome.storage.local.set({ lastSave: { project, env, path } });
		await chrome.storage.session.remove('lastGenerated');
		$('save').hidden = true;
		$('last').hidden = true;
		toast(`Saved ${$('sv-key').value.trim()} to ${project}/${env}`);
		$('sv-value').value = '';
		search($('q').value);
		if (!$('tab-projects').hidden) showProjects();
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
	// Long enough to read: the proxy message is a couple of sentences.
	toastTimer = setTimeout(() => (t.hidden = true), Math.max(error ? 4000 : 2200, msg.length * 45));
}
