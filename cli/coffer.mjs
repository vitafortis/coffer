#!/usr/bin/env node
// coffer: read, store, generate and share secrets from a terminal. One file, Node 20+, no packages.
// Server: __COFFER_URL__ (override with COFFER_URL or `coffer login <url>`)
//
//   coffer login                      sign in with an API token (Coffer > Settings > API tokens)
//   coffer use billing-api prod       default project and environment
//   coffer ls [folder]                list secrets (names only)
//   coffer get DATABASE_URL           print a value (also: coffer get billing-api/prod/db/URL)
//   coffer set API_KEY                prompt for a value (or: coffer set API_KEY value, or pipe it in)
//   coffer gen password -l 32         generate (password, key, uuid, keypair, cert); --save NAME stores it
//   coffer share DATABASE_URL         a one-time link to a stored secret; `coffer share -` shares stdin
//   coffer open <link>                read a one-time link
//
// Run `coffer help` for everything.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomInt, randomUUID, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION = '0.1.0';
const BAKED_URL = '__COFFER_URL__';
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'coffer');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const HELP = `coffer ${VERSION} — secrets from the terminal

Signing in
  coffer login [url]                  paste an API token (Settings > API tokens in the web app)
  coffer logout                       forget the token
  coffer whoami                       who the token belongs to

Choosing where
  coffer projects                     list projects
  coffer envs [project]               list a project's environments
  coffer use <project> [env]          set the defaults for -p and -e
  Every command takes -p/--project, -e/--env and --path (a folder, default /).
  Or name a secret in full: project/env/folder/NAME, e.g. billing/prod/db/PASSWORD.

Secrets
  coffer ls [folder] [--deep]         names, types and versions (no values)
  coffer get <name> [-c] [-v N]       print the value (-c: copy instead, cleared after 30s; -v: old version)
  coffer set <name> [value|-]         store a value: argument, - for stdin, or a hidden prompt
        [--type text|password|note|key|certificate|keypair] [--note "…"] [--url site]
        [--file path]                 read the value from a file (certificates, keys)
  coffer rm <name>                    delete (asks first; -y to skip)
  coffer history <name>               versions and who made them

Generating
  coffer gen password [-l 24] [--no-symbols] [--no-upper] [--no-lower] [--no-digits] [--unambiguous]
  coffer gen key [--bytes 32] [--hex | --base64url]
  coffer gen uuid
  coffer gen keypair [--alg ed25519|ecdsa-p256|ecdsa-p384|rsa-2048|rsa-4096] [--ssh] [--comment c]
  coffer gen cert --cn api.internal [--san a,b] [--days 365] [--alg …] [--ca] [--issuer project/env/CA]
  Add --save <name> to store it instead of printing it.

Sharing
  coffer share <name>                 a one-time link to a stored secret
  coffer share -                      a one-time link to whatever is piped in
        [--expires 1h|1d|3d|7d|30d] [--views 1] [--label "…"]
  coffer open <link>                  print what a one-time link holds (uses one view)

Environment: COFFER_URL, COFFER_TOKEN, COFFER_PROJECT, COFFER_ENV override the config file
(${CONFIG_FILE}).`;

// ── Arguments ─────────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['-p', '--project', '-e', '--env', '--path', '-l', '--length', '--bytes', '--type', '--note', '--url', '--file', '--expires', '--views', '--label', '--alg', '--comment', '--cn', '--san', '--days', '--org', '--issuer', '--save', '-v', '--version-of']);
const ALIASES = { '-p': 'project', '-e': 'env', '-l': 'length', '-c': 'copy', '-y': 'yes', '-v': 'version-of', '-h': 'help', '-q': 'quiet' };

function parseArgs(argv) {
	const pos = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--') {
			pos.push(...argv.slice(i + 1));
			break;
		}
		if (a.startsWith('-') && a !== '-') {
			let [name, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
			const key = ALIASES[name] ?? name.replace(/^--/, '');
			if (VALUE_FLAGS.has(name)) {
				const v = inline ?? argv[++i];
				if (v === undefined) fail(`${name} needs a value`);
				flags[key] = v;
			} else flags[key] = inline ?? true;
		} else pos.push(a);
	}
	return { pos, flags };
}

// ── Output ────────────────────────────────────────────────────────────────────

const tty = process.stdout.isTTY;
const color = (n) => (s) => (tty && !process.env.NO_COLOR ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const dim = color(2);
const bold = color(1);
const red = color(31);
const green = color(32);
const pink = color(35);

function fail(msg, code = 1) {
	process.stderr.write(`${red('coffer:')} ${msg}\n`);
	process.exit(code);
}
const note = (msg) => process.stderr.write(`${dim(msg)}\n`);

function table(rows, head) {
	const all = head ? [head, ...rows] : rows;
	const widths = all[0].map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').replace(/\x1b\[\d+m/g, '').length)));
	const line = (r) => r.map((c, i) => String(c ?? '') + ' '.repeat(Math.max(0, widths[i] - String(c ?? '').replace(/\x1b\[\d+m/g, '').length))).join('  ').trimEnd();
	if (head) console.log(dim(line(head)));
	for (const r of rows) console.log(line(r));
}

function ago(iso) {
	const s = (Date.now() - Date.parse(iso)) / 1000;
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

// ── Config ────────────────────────────────────────────────────────────────────

function readConfig() {
	try {
		return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
	} catch {
		return {};
	}
}

function writeConfig(cfg) {
	mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
	writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
	try {
		chmodSync(CONFIG_FILE, 0o600);
	} catch {}
}

const cfg = readConfig();
const baseUrl = () => (process.env.COFFER_URL || cfg.url || (BAKED_URL.startsWith('http') ? BAKED_URL : '')).replace(/\/+$/, '');
const token = () => process.env.COFFER_TOKEN || cfg.token || '';

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function call(method, path, body, { auth = true, url = baseUrl() } = {}) {
	if (!url) fail('No server yet: run `coffer login <url>`');
	if (auth && !token()) fail('Not signed in: run `coffer login`');
	let res;
	try {
		res = await fetch(url + path, {
			method,
			headers: { ...(auth ? { authorization: `Bearer ${token()}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), 'user-agent': `coffer-cli/${VERSION}` },
			body: body ? JSON.stringify(body) : undefined
		});
	} catch (err) {
		fail(`Can't reach ${url}: ${err.cause?.code ?? err.message}`);
	}
	const data = await res.json().catch(() => ({}));
	if (!res.ok) fail(data.message ?? `${res.status} ${res.statusText}`, res.status === 401 ? 3 : 1);
	return data;
}

const enc = encodeURIComponent;

// ── Where: project, environment, folder, name ────────────────────────────────

function normalizePath(p) {
	return '/' + String(p ?? '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
}

/** A name, or a full reference project/env/folder…/NAME. */
function where(flags, name) {
	if (name && name.includes('/')) {
		const parts = name.split('/').filter(Boolean);
		if (parts.length < 3) fail(`"${name}": a full name is project/env/NAME or project/env/folder/NAME`);
		return { project: parts[0], env: parts[1], path: normalizePath(parts.slice(2, -1).join('/')), key: parts.at(-1) };
	}
	const project = flags.project || process.env.COFFER_PROJECT || cfg.project;
	const env = flags.env || process.env.COFFER_ENV || cfg.env;
	if (!project) fail('Which project? Use -p <project>, or set a default with `coffer use <project> <env>`');
	if (!env) fail('Which environment? Use -e <env>, or set a default with `coffer use <project> <env>`');
	return { project, env, path: normalizePath(flags.path), key: name };
}

async function findOne(w) {
	const { secrets } = await call('GET', `/api/v1/projects/${enc(w.project)}/secrets?env=${enc(w.env)}&path=${enc(w.path)}&key=${enc(w.key)}`);
	if (!secrets.length) fail(`No ${w.key} in ${w.project}/${w.env}${w.path === '/' ? '' : w.path}`, 4);
	return secrets[0];
}

// ── Input ─────────────────────────────────────────────────────────────────────

async function readStdin() {
	const chunks = [];
	for await (const c of process.stdin) chunks.push(c);
	return Buffer.concat(chunks).toString('utf8');
}

/** Reads a line without echoing it. */
function promptHidden(question) {
	return new Promise((resolve) => {
		if (!process.stdin.isTTY) return readStdin().then((s) => resolve(s.replace(/\r?\n$/, '')));
		process.stderr.write(question);
		const stdin = process.stdin;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');
		let value = '';
		const onData = (ch) => {
			for (const c of ch) {
				if (c === '\r' || c === '\n' || c === '\u0004') {
					stdin.setRawMode(false);
					stdin.pause();
					stdin.off('data', onData);
					process.stderr.write('\n');
					return resolve(value);
				}
				if (c === '\u0003') {
					process.stderr.write('\n');
					process.exit(130);
				}
				if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
				else value += c;
			}
		};
		stdin.on('data', onData);
	});
}

function prompt(question, def = '') {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stderr });
		rl.question(def ? `${question} ${dim(`(${def})`)} ` : `${question} `, (a) => {
			rl.close();
			resolve(a.trim() || def);
		});
	});
}

async function confirm(question, flags) {
	if (flags.yes) return true;
	if (!process.stdin.isTTY) fail(`${question} — pass -y to confirm when not at a terminal`);
	return /^y(es)?$/i.test(await prompt(`${question} [y/N]`));
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

function clipboardCommand() {
	if (process.platform === 'darwin') return ['pbcopy', []];
	if (process.platform === 'win32') return ['clip', []];
	if (process.env.WAYLAND_DISPLAY) return ['wl-copy', []];
	return ['xclip', ['-selection', 'clipboard']];
}

function copy(text) {
	const [cmd, args] = clipboardCommand();
	const r = spawnSync(cmd, args, { input: text });
	if (r.error || r.status !== 0) fail(`Couldn't copy (is ${cmd} installed?)`);
}

function pasteCommand() {
	if (process.platform === 'darwin') return ['pbpaste', []];
	if (process.platform === 'win32') return ['powershell', ['-NoProfile', '-Command', 'Get-Clipboard']];
	if (process.env.WAYLAND_DISPLAY) return ['wl-paste', ['-n']];
	return ['xclip', ['-selection', 'clipboard', '-o']];
}

/**
 * Copies, then clears the clipboard 30 seconds later if it still holds the value. A detached
 * helper does the clearing so the command can exit; it only gets the value's hash.
 */
function copyAndClear(text) {
	copy(text);
	const hash = createHash('sha256').update(text).digest('hex');
	const helper = `
		const { spawnSync } = require('node:child_process');
		const { createHash } = require('node:crypto');
		setTimeout(() => {
			const now = spawnSync(${JSON.stringify(pasteCommand()[0])}, ${JSON.stringify(pasteCommand()[1])}).stdout?.toString() ?? '';
			if (createHash('sha256').update(now.replace(/\r?\n$/, '')).digest('hex') === ${JSON.stringify(hash)} || createHash('sha256').update(now).digest('hex') === ${JSON.stringify(hash)})
				spawnSync(${JSON.stringify(clipboardCommand()[0])}, ${JSON.stringify(clipboardCommand()[1])}, { input: '' });
		}, 30000);`;
	try {
		spawn(process.execPath, ['-e', helper], { detached: true, stdio: 'ignore' }).unref();
		note('Copied. The clipboard clears in 30 seconds.');
	} catch {
		note('Copied. Clear your clipboard when you are done.');
	}
}

// ── Local generators (same rules as the web app) ─────────────────────────────

const SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!#$%&()*+,-./:;<=>?@[]^_{}~' };

function genPassword(flags) {
	const length = Math.min(Math.max(Number(flags.length ?? 24) || 24, 4), 512);
	const sets = ['lower', 'upper', 'digits', 'symbols']
		.filter((k) => !flags[`no-${k}`])
		.map((k) => (flags.unambiguous ? SETS[k].replace(/[0Oo1lI|`'"]/g, '') : SETS[k]));
	if (!sets.length) fail('Leave at least one kind of character');
	const all = sets.join('');
	const chars = sets.map((s) => s[randomInt(s.length)]);
	while (chars.length < length) chars.push(all[randomInt(all.length)]);
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.slice(0, length).join('');
}

function genKey(flags) {
	const b = randomBytes(Math.min(Math.max(Number(flags.bytes ?? 32) || 32, 8), 512));
	return flags.hex ? b.toString('hex') : flags.base64url ? b.toString('base64url') : b.toString('base64');
}

// ── Commands ──────────────────────────────────────────────────────────────────

const commands = {
	async login({ pos }) {
		const url = (pos[0] || (await prompt('Coffer URL:', baseUrl()))).replace(/\/+$/, '');
		if (!/^https?:\/\//.test(url)) fail('The URL starts with https:// (or http://)');
		note(`Make a token at ${url}/settings#tokens`);
		const t = (await promptHidden('API token: ')).trim();
		if (!t) fail('No token given');
		const res = await fetch(`${url}/api/v1/me`, { headers: { authorization: `Bearer ${t}` } }).catch((err) => fail(`Can't reach ${url}: ${err.cause?.code ?? err.message}`));
		const me = await res.json().catch(() => ({}));
		if (!res.ok) fail(me.message ?? `${res.status} ${res.statusText}`);
		writeConfig({ ...cfg, url, token: t });
		console.log(`${green('✓')} Signed in to ${url} as ${bold(me.email)}${me.token?.readOnly ? dim(' (read-only token)') : ''}`);
		if (!cfg.project) note('Next: `coffer projects`, then `coffer use <project> <env>`.');
	},

	async logout() {
		const { token: _t, ...rest } = cfg;
		writeConfig(rest);
		console.log('Signed out. (The token still works until you revoke it in Settings > API tokens.)');
	},

	async whoami() {
		const me = await call('GET', '/api/v1/me');
		console.log(`${me.email}${me.name ? ` (${me.name})` : ''} on ${baseUrl()}`);
		if (me.token) console.log(dim(`token "${me.token.name}"${me.token.readOnly ? ', read-only' : ''}${me.token.expiresAt ? `, expires ${me.token.expiresAt.slice(0, 10)}` : ''}`));
		if (cfg.project) console.log(dim(`defaults: -p ${cfg.project} -e ${cfg.env ?? '?'}`));
	},

	async projects() {
		const { projects } = await call('GET', '/api/v1/projects');
		if (!projects.length) return note('No projects yet. Make one in the web app.');
		table(
			projects.map((p) => [p.slug === cfg.project ? pink(p.slug) : p.slug, p.name, p.environments.map((e) => e.slug).join(', '), String(p.secretCount)]),
			['PROJECT', 'NAME', 'ENVIRONMENTS', 'SECRETS']
		);
	},

	async envs({ pos, flags }) {
		const project = pos[0] || flags.project || cfg.project;
		if (!project) fail('Which project?');
		const { environments } = await call('GET', `/api/v1/projects/${enc(project)}`);
		table(environments.map((e) => [e.slug === cfg.env && project === cfg.project ? pink(e.slug) : e.slug, e.name]), ['ENV', 'NAME']);
	},

	async use({ pos }) {
		const [project, env] = pos;
		if (!project) fail('Usage: coffer use <project> [env]');
		const { project: p, environments } = await call('GET', `/api/v1/projects/${enc(project)}`);
		const e = env ? environments.find((x) => x.slug === env) : environments[0];
		if (!e) fail(`${p.slug} has no environment "${env}" (it has: ${environments.map((x) => x.slug).join(', ')})`);
		writeConfig({ ...cfg, project: p.slug, env: e.slug });
		console.log(`Using ${bold(p.slug)} / ${bold(e.slug)}`);
	},

	async ls({ pos, flags }) {
		const w = where(flags);
		const path = pos[0] ? normalizePath(pos[0]) : w.path;
		const [{ secrets }, { folders }] = await Promise.all([
			call('GET', `/api/v1/projects/${enc(w.project)}/secrets?env=${enc(w.env)}&path=${enc(path)}${flags.deep ? '&deep=1' : ''}`),
			call('GET', `/api/v1/projects/${enc(w.project)}`)
		]);
		const prefix = path === '/' ? '/' : `${path}/`;
		const sub = flags.deep ? [] : [...new Set(folders.map((f) => f.path).filter((p) => p.startsWith(prefix) && p !== path).map((p) => p.slice(prefix.length).split('/')[0]))].sort();
		if (!secrets.length && !sub.length) return note(`Nothing in ${w.project}/${w.env}${path === '/' ? '' : path}`);
		for (const f of sub) console.log(pink(`${f}/`));
		if (secrets.length)
			table(
				secrets.map((s) => [flags.deep && s.path !== path ? `${s.path.slice(prefix.length - (path === '/' ? 1 : 0))}/${s.key}`.replace(/^\//, '') : s.key, s.type, `v${s.version}`, ago(s.updatedAt), s.note ?? '']),
				sub.length ? undefined : ['NAME', 'TYPE', 'VER', 'UPDATED', 'NOTE']
			);
	},

	async get({ pos, flags }) {
		if (!pos[0]) fail('Usage: coffer get <name>');
		const w = where(flags, pos[0]);
		const s = await findOne(w);
		const { value } = await call('GET', `/api/v1/secrets/${s.id}/value${flags['version-of'] ? `?version=${enc(flags['version-of'])}` : ''}`);
		if (flags.copy) return copyAndClear(value);
		process.stdout.write(value);
		// A trailing newline for people, none for pipes ($(coffer get X)).
		if (tty && !value.endsWith('\n')) process.stdout.write('\n');
	},

	async set({ pos, flags }) {
		if (!pos[0]) fail('Usage: coffer set <name> [value|-]');
		const w = where(flags, pos[0]);
		let value;
		if (flags.file) value = readFileSync(flags.file, 'utf8');
		else if (pos[1] === '-' || (pos[1] === undefined && !process.stdin.isTTY)) value = await readStdin();
		else if (pos[1] !== undefined) value = pos[1];
		else value = await promptHidden(`Value for ${w.key}: `);
		// One-line values from pipes (echo x | coffer set K) lose their trailing newline.
		if (/^[^\n]*\r?\n$/.test(value)) value = value.replace(/\r?\n$/, '');
		const type =
			flags.type ??
			(/-----BEGIN CERTIFICATE-----/.test(value) ? 'certificate' : /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ? 'keypair' : value.includes('\n') ? 'note' : undefined);
		if (!value) fail('Empty value: nothing stored');
		const { secrets } = await call('POST', `/api/v1/projects/${enc(w.project)}/secrets`, {
			env: w.env,
			path: w.path,
			key: w.key,
			value,
			upsert: true,
			...(type ? { type } : {}),
			...(flags.note !== undefined ? { note: flags.note } : {}),
			...(flags.url !== undefined ? { url: flags.url } : {})
		});
		const s = secrets[0];
		console.log(`${green('✓')} ${w.key} ${s.version > 1 ? `updated (v${s.version})` : 'stored'} in ${w.project}/${w.env}${w.path === '/' ? '' : w.path}`);
	},

	async rm({ pos, flags }) {
		if (!pos[0]) fail('Usage: coffer rm <name>');
		const w = where(flags, pos[0]);
		const s = await findOne(w);
		if (!(await confirm(`Delete ${w.key} from ${w.project}/${w.env}, with its history?`, flags))) return note('Kept.');
		await call('DELETE', `/api/v1/secrets/${s.id}`);
		console.log(`${green('✓')} Deleted ${w.key}`);
	},

	async history({ pos, flags }) {
		if (!pos[0]) fail('Usage: coffer history <name>');
		const s = await findOne(where(flags, pos[0]));
		const { versions } = await call('GET', `/api/v1/secrets/${s.id}/versions`);
		table(versions.map((v) => [v.version === s.version ? pink(`v${v.version}`) : `v${v.version}`, ago(v.createdAt), v.createdBy ?? '']), ['VER', 'WHEN', 'BY']);
		note(`coffer get ${pos[0]} -v <n> prints an old value.`);
	},

	async gen({ pos, flags }) {
		const kind = pos[0] ?? 'password';
		let value;
		let type = kind;
		let meta = {};
		if (kind === 'password') value = genPassword(flags);
		else if (kind === 'key') value = genKey(flags);
		else if (kind === 'uuid') (value = randomUUID()), (type = 'text');
		else if (kind === 'keypair' || kind === 'cert' || kind === 'certificate') {
			let issuer;
			if (flags.issuer) issuer = (await findOne(where(flags, flags.issuer))).id;
			const r = await call(
				'POST',
				'/api/v1/generate',
				kind === 'keypair'
					? { kind: 'keypair', algorithm: flags.alg ?? 'ed25519', ssh: !!flags.ssh, comment: flags.comment }
					: { kind: 'certificate', commonName: flags.cn ?? pos[1], sans: flags.san ?? '', days: Number(flags.days ?? 365), algorithm: flags.alg ?? 'ecdsa-p256', ca: !!flags.ca, organization: flags.org, issuer }
			);
			({ value, type, meta } = r);
		} else fail(`Can't generate "${kind}": password, key, uuid, keypair or cert`);

		if (flags.save) {
			const w = where(flags, flags.save);
			const { secrets } = await call('POST', `/api/v1/projects/${enc(w.project)}/secrets`, { env: w.env, path: w.path, key: w.key, type, value, upsert: true });
			console.log(`${green('✓')} Generated and stored ${w.key} (v${secrets[0].version}) in ${w.project}/${w.env}${w.path === '/' ? '' : w.path}`);
			if (meta.publicKey) console.log(meta.publicKey);
			return;
		}
		if (flags.copy) return copyAndClear(value);
		process.stdout.write(value.endsWith('\n') ? value : value + '\n');
		if (meta.publicKey) process.stderr.write(`\n${dim('Public key:')}\n${meta.publicKey}\n`);
	},

	async share({ pos, flags }) {
		if (!pos[0]) fail('Usage: coffer share <name> | coffer share -');
		const hours = { '1h': 1, '1d': 24, '24h': 24, '3d': 72, '7d': 168, '1w': 168, '30d': 720 }[flags.expires ?? '1d'];
		if (!hours) fail('--expires is 1h, 1d, 3d, 7d or 30d');
		const body = { hours, views: Number(flags.views ?? 1), label: flags.label };
		if (pos[0] === '-') {
			const value = await readStdin();
			if (!value.trim()) fail('Nothing on stdin to share');
			Object.assign(body, { value });
		} else {
			const w = where(flags, pos[0]);
			Object.assign(body, { secretId: (await findOne(w)).id, label: flags.label ?? w.key });
		}
		const { url, share } = await call('POST', '/api/v1/shares', body);
		console.log(url);
		note(`Opens ${share.maxViews === 1 ? 'once' : `${share.maxViews} times`}, expires ${share.expiresAt.replace('T', ' ').slice(0, 16)} UTC. This link is not shown again.`);
		if (tty && !flags['no-copy']) {
			try {
				copy(url);
				note('Link copied.');
			} catch {}
		}
	},

	async open({ pos }) {
		const link = pos[0];
		const m = link?.match(/^(https?:\/\/[^#]+?)\/s\/([\w-]+)#([\w-]+)$/);
		if (!m) fail('Usage: coffer open <the whole link, including the part after #>');
		const r = await call('POST', '/api/v1/shares/open', { id: m[2], key: m[3] }, { auth: false, url: m[1] });
		process.stdout.write(r.value);
		if (tty && !r.value.endsWith('\n')) process.stdout.write('\n');
		note(r.remaining ? `${r.remaining} view${r.remaining === 1 ? '' : 's'} left on this link.` : 'That was the last view: the link no longer works.');
	},

	help() {
		console.log(HELP);
	}
};
commands.list = commands.ls;
commands.read = commands.get;
commands.delete = commands.rm;
commands.generate = commands.gen;

// ── Main ──────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === '-h' || cmd === '--help') commands.help();
else if (cmd === '--version' || cmd === 'version') console.log(VERSION);
else if (!commands[cmd]) fail(`Unknown command "${cmd}". Try \`coffer help\`.`);
else {
	const args = parseArgs(rest);
	if (args.flags.help) commands.help();
	else await commands[cmd](args);
}
