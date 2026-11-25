import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { decrypt, encrypt } from './crypto.ts';
import type {
	Activity,
	ApiToken,
	Environment,
	Project,
	ProjectSummary,
	Secret,
	SecretHit,
	SecretMeta,
	SecretType,
	SecretVersion,
	Settings,
	Share,
	ShareState,
	User,
	UserRole
} from '#lib/types.ts';

let handle: DatabaseSync | undefined;

/** How many old values each secret keeps, besides the current one. */
const KEEP_VERSIONS = 30;

/** Opens the store on first use, so importing this module (e.g. during build) has no side effects. */
function db(): DatabaseSync {
	if (handle) return handle;
	mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
	const dbPath = join(config.dataDir, 'coffer.db');
	handle = new DatabaseSync(dbPath);
	try {
		chmodSync(dbPath, 0o600);
	} catch {
		// Best effort — some mounted volumes don't support chmod.
	}
	handle.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;

		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE COLLATE NOCASE,
			name TEXT,
			role TEXT NOT NULL DEFAULT 'admin',
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL,
			last_login_at TEXT
		);

		CREATE TABLE IF NOT EXISTS auth_sessions (
			token_hash TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS api_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			prefix TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			read_only INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			last_used_at TEXT,
			expires_at TEXT
		);

		CREATE TABLE IF NOT EXISTS kv (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
			name TEXT NOT NULL,
			description TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS environments (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			slug TEXT NOT NULL COLLATE NOCASE,
			name TEXT NOT NULL,
			position INTEGER NOT NULL DEFAULT 0,
			UNIQUE (project_id, slug)
		);

		-- The value lives in secret_versions; the row says which version is current.
		CREATE TABLE IF NOT EXISTS secrets (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
			path TEXT NOT NULL DEFAULT '/',
			key TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'text',
			note TEXT,
			meta TEXT NOT NULL DEFAULT '{}',
			version INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			updated_by TEXT,
			UNIQUE (environment_id, path, key)
		);
		CREATE INDEX IF NOT EXISTS secrets_project ON secrets(project_id);

		CREATE TABLE IF NOT EXISTS secret_versions (
			secret_id TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
			version INTEGER NOT NULL,
			value TEXT NOT NULL,
			created_at TEXT NOT NULL,
			created_by TEXT,
			PRIMARY KEY (secret_id, version)
		);

		-- One-time links. ciphertext is wiped once the last view is used.
		CREATE TABLE IF NOT EXISTS shares (
			id TEXT PRIMARY KEY,
			ciphertext TEXT,
			label TEXT,
			source TEXT,
			created_by TEXT,
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			max_views INTEGER NOT NULL DEFAULT 1,
			views INTEGER NOT NULL DEFAULT 0,
			opened_at TEXT,
			revoked_at TEXT
		);

		CREATE TABLE IF NOT EXISTS activity (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			at TEXT NOT NULL,
			actor TEXT,
			action TEXT NOT NULL,
			target TEXT,
			detail TEXT
		);
	`);
	return handle;
}

const now = () => new Date().toISOString();

function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
	return db().prepare(sql).all(...params) as T[];
}
function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
	return db().prepare(sql).get(...params) as T | undefined;
}
function run(sql: string, ...params: SQLInputValue[]) {
	return db().prepare(sql).run(...params);
}

/** Runs `fn` in one transaction. */
export function tx<T>(fn: () => T): T {
	db().exec('BEGIN IMMEDIATE');
	try {
		const out = fn();
		db().exec('COMMIT');
		return out;
	} catch (err) {
		db().exec('ROLLBACK');
		throw err;
	}
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getKv<T>(key: string, fallback: T): T {
	const row = get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
	return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setKv(key: string, value: unknown) {
	run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function defaultSettings(): Settings {
	return { publicUrl: '', shareHours: 24 };
}

export function getSettings(): Settings {
	return { ...defaultSettings(), ...getKv<Partial<Settings>>('settings', {}) };
}

export function saveSettings(s: Settings) {
	setKv('settings', s);
}

// ── Users and sessions ───────────────────────────────────────────────────────

type UserRow = { id: string; email: string; name: string | null; role: UserRole; created_at: string; last_login_at: string | null };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at, lastLoginAt: r.last_login_at });
const USER_COLS = 'id, email, name, role, created_at, last_login_at';

export function listUsers(): User[] {
	return all<UserRow>(`SELECT ${USER_COLS} FROM users ORDER BY created_at`).map(toUser);
}

export function getUser(id: string): User | undefined {
	const r = get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id);
	return r && toUser(r);
}

export function countUsers(): number {
	return get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
}

export function countAdmins(): number {
	return get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")!.n;
}

export function findUserByEmail(email: string): User | undefined {
	const r = get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = ?`, email.trim());
	return r && toUser(r);
}

export function getPasswordHash(userId: string): string | undefined {
	return get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId)?.password_hash;
}

export function createUser(input: { email: string; name?: string | null; passwordHash: string; role?: UserRole }): User {
	const id = randomUUID();
	// The first account is always an admin.
	const role: UserRole = countUsers() === 0 ? 'admin' : (input.role ?? 'member');
	run('INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, input.email.trim(), input.name ?? null, role, input.passwordHash, now());
	return getUser(id)!;
}

export function updateUser(id: string, patch: { name?: string | null; email?: string; passwordHash?: string; role?: UserRole }) {
	if (patch.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', patch.name, id);
	if (patch.email !== undefined) run('UPDATE users SET email = ? WHERE id = ?', patch.email.trim(), id);
	if (patch.passwordHash !== undefined) run('UPDATE users SET password_hash = ? WHERE id = ?', patch.passwordHash, id);
	if (patch.role !== undefined) run('UPDATE users SET role = ? WHERE id = ?', patch.role, id);
}

export function deleteUser(id: string): boolean {
	return Number(run('DELETE FROM users WHERE id = ?', id).changes) > 0;
}

export function touchUserLogin(id: string) {
	run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), id);
}

export function createAuthSession(tokenHash: string, userId: string, ttlMs: number) {
	run('DELETE FROM auth_sessions WHERE expires_at < ?', Date.now());
	run('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', tokenHash, userId, Date.now() + ttlMs);
}

export function authSessionUser(tokenHash: string): User | undefined {
	const r = get<UserRow>(
		`SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
		tokenHash,
		Date.now()
	);
	return r && toUser(r);
}

export function deleteAuthSession(tokenHash: string) {
	run('DELETE FROM auth_sessions WHERE token_hash = ?', tokenHash);
}

export function deleteUserAuthSessions(userId: string, except?: string) {
	run('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', userId, except ?? '');
}

// ── API tokens ───────────────────────────────────────────────────────────────

type TokenRow = { id: string; user_id: string; name: string; prefix: string; read_only: number; created_at: string; last_used_at: string | null; expires_at: string | null };
const toToken = (r: TokenRow): ApiToken => ({
	id: r.id,
	userId: r.user_id,
	name: r.name,
	prefix: r.prefix,
	readOnly: !!r.read_only,
	createdAt: r.created_at,
	lastUsedAt: r.last_used_at,
	expiresAt: r.expires_at
});

export function listTokens(userId: string): ApiToken[] {
	return all<TokenRow>('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC', userId).map(toToken);
}

export function createToken(input: { userId: string; name: string; prefix: string; tokenHash: string; readOnly: boolean; expiresAt: string | null }): ApiToken {
	const id = randomUUID();
	run(
		'INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, read_only, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		id,
		input.userId,
		input.name,
		input.prefix,
		input.tokenHash,
		input.readOnly ? 1 : 0,
		now(),
		input.expiresAt
	);
	return toToken(get<TokenRow>('SELECT * FROM api_tokens WHERE id = ?', id)!);
}

/** The token's owner, when the token exists and hasn't expired; marks it used. */
export function tokenUser(tokenHash: string): { user: User; token: ApiToken } | undefined {
	const t = get<TokenRow>('SELECT * FROM api_tokens WHERE token_hash = ?', tokenHash);
	if (!t || (t.expires_at && Date.parse(t.expires_at) < Date.now())) return undefined;
	const user = getUser(t.user_id);
	if (!user) return undefined;
	// Once a minute is plenty for "last used".
	if (!t.last_used_at || Date.now() - Date.parse(t.last_used_at) > 60_000) run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', now(), t.id);
	return { user, token: toToken(t) };
}

export function deleteToken(id: string, userId: string): boolean {
	return Number(run('DELETE FROM api_tokens WHERE id = ? AND user_id = ?', id, userId).changes) > 0;
}

// ── Projects and environments ────────────────────────────────────────────────

type ProjectRow = { id: string; slug: string; name: string; description: string | null; created_at: string; updated_at: string };
const toProject = (r: ProjectRow): Project => ({ id: r.id, slug: r.slug, name: r.name, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at });

type EnvRow = { id: string; project_id: string; slug: string; name: string; position: number };
const toEnv = (r: EnvRow): Environment => ({ id: r.id, projectId: r.project_id, slug: r.slug, name: r.name, position: r.position });

export const DEFAULT_ENVIRONMENTS = [
	{ slug: 'dev', name: 'Development' },
	{ slug: 'staging', name: 'Staging' },
	{ slug: 'prod', name: 'Production' }
];

export function listProjects(): ProjectSummary[] {
	const projects = all<ProjectRow>('SELECT * FROM projects ORDER BY name COLLATE NOCASE').map(toProject);
	const envs = all<EnvRow>('SELECT * FROM environments ORDER BY position, name').map(toEnv);
	const counts = new Map(all<{ project_id: string; n: number }>('SELECT project_id, COUNT(*) AS n FROM secrets GROUP BY project_id').map((r) => [r.project_id, r.n]));
	return projects.map((p) => ({ ...p, environments: envs.filter((e) => e.projectId === p.id), secretCount: counts.get(p.id) ?? 0 }));
}

export function getProject(idOrSlug: string): Project | undefined {
	const r = get<ProjectRow>('SELECT * FROM projects WHERE id = ? OR slug = ?', idOrSlug, idOrSlug);
	return r && toProject(r);
}

export function createProject(input: { slug: string; name: string; description: string | null; environments?: { slug: string; name: string }[] }): Project {
	const id = randomUUID();
	const at = now();
	tx(() => {
		run('INSERT INTO projects (id, slug, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, input.slug, input.name, input.description, at, at);
		(input.environments ?? DEFAULT_ENVIRONMENTS).forEach((e, i) => createEnvironmentRow(id, e.slug, e.name, i));
	});
	return getProject(id)!;
}

export function updateProject(id: string, patch: { slug?: string; name?: string; description?: string | null }) {
	if (patch.slug !== undefined) run('UPDATE projects SET slug = ? WHERE id = ?', patch.slug, id);
	if (patch.name !== undefined) run('UPDATE projects SET name = ? WHERE id = ?', patch.name, id);
	if (patch.description !== undefined) run('UPDATE projects SET description = ? WHERE id = ?', patch.description, id);
	touchProject(id);
}

function touchProject(id: string) {
	run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), id);
}

export function deleteProject(id: string): boolean {
	return Number(run('DELETE FROM projects WHERE id = ?', id).changes) > 0;
}

export function slugTaken(slug: string, exceptId = ''): boolean {
	return !!get('SELECT 1 FROM projects WHERE slug = ? AND id != ?', slug, exceptId);
}

export function listEnvironments(projectId: string): Environment[] {
	return all<EnvRow>('SELECT * FROM environments WHERE project_id = ? ORDER BY position, name', projectId).map(toEnv);
}

export function getEnvironment(projectId: string, idOrSlug: string): Environment | undefined {
	const r = get<EnvRow>('SELECT * FROM environments WHERE project_id = ? AND (id = ? OR slug = ?)', projectId, idOrSlug, idOrSlug);
	return r && toEnv(r);
}

function createEnvironmentRow(projectId: string, slug: string, name: string, position: number): string {
	const id = randomUUID();
	run('INSERT INTO environments (id, project_id, slug, name, position) VALUES (?, ?, ?, ?, ?)', id, projectId, slug, name, position);
	return id;
}

export function createEnvironment(projectId: string, slug: string, name: string): Environment {
	const pos = get<{ n: number | null }>('SELECT MAX(position) AS n FROM environments WHERE project_id = ?', projectId)!.n ?? -1;
	const id = createEnvironmentRow(projectId, slug, name, pos + 1);
	touchProject(projectId);
	return toEnv(get<EnvRow>('SELECT * FROM environments WHERE id = ?', id)!);
}

export function updateEnvironment(id: string, patch: { slug?: string; name?: string }) {
	if (patch.slug !== undefined) run('UPDATE environments SET slug = ? WHERE id = ?', patch.slug, id);
	if (patch.name !== undefined) run('UPDATE environments SET name = ? WHERE id = ?', patch.name, id);
}

export function deleteEnvironment(id: string): boolean {
	return Number(run('DELETE FROM environments WHERE id = ?', id).changes) > 0;
}

// ── Secrets ──────────────────────────────────────────────────────────────────

type SecretRow = {
	id: string;
	project_id: string;
	environment_id: string;
	path: string;
	key: string;
	type: SecretType;
	note: string | null;
	meta: string;
	version: number;
	created_at: string;
	updated_at: string;
	updated_by: string | null;
};
const toSecret = (r: SecretRow): Secret => ({
	id: r.id,
	projectId: r.project_id,
	environmentId: r.environment_id,
	path: r.path,
	key: r.key,
	type: r.type,
	note: r.note,
	meta: JSON.parse(r.meta) as SecretMeta,
	version: r.version,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
	updatedBy: r.updated_by
});

const valueContext = (secretId: string, version: number) => `secret:${secretId}:${version}`;

/** Secrets in a project, optionally one environment, with every folder under `path` when `deep`. */
export function listSecrets(projectId: string, opts: { environmentId?: string; path?: string; deep?: boolean } = {}): Secret[] {
	const where = ['project_id = ?'];
	const params: SQLInputValue[] = [projectId];
	if (opts.environmentId) {
		where.push('environment_id = ?');
		params.push(opts.environmentId);
	}
	if (opts.path) {
		if (opts.deep) {
			where.push("(path = ? OR path LIKE ? ESCAPE '\\')");
			params.push(opts.path, `${likeEscape(opts.path === '/' ? '' : opts.path)}/%`);
		} else {
			where.push('path = ?');
			params.push(opts.path);
		}
	}
	return all<SecretRow>(`SELECT * FROM secrets WHERE ${where.join(' AND ')} ORDER BY path, key COLLATE NOCASE`, ...params).map(toSecret);
}

/** Every folder in an environment (or the whole project), each with how many secrets it holds directly. */
export function listFolders(projectId: string, environmentId?: string): { path: string; count: number }[] {
	return environmentId
		? all('SELECT path, COUNT(*) AS count FROM secrets WHERE project_id = ? AND environment_id = ? GROUP BY path ORDER BY path', projectId, environmentId)
		: all('SELECT path, COUNT(*) AS count FROM secrets WHERE project_id = ? GROUP BY path ORDER BY path', projectId);
}

export function getSecret(id: string): Secret | undefined {
	const r = get<SecretRow>('SELECT * FROM secrets WHERE id = ?', id);
	return r && toSecret(r);
}

export function findSecret(environmentId: string, path: string, key: string): Secret | undefined {
	const r = get<SecretRow>('SELECT * FROM secrets WHERE environment_id = ? AND path = ? AND key = ?', environmentId, path, key);
	return r && toSecret(r);
}

/** The current value, or an old one. */
export function readSecretValue(id: string, version?: number): string | undefined {
	const s = getSecret(id);
	if (!s) return undefined;
	const v = version ?? s.version;
	const row = get<{ value: string }>('SELECT value FROM secret_versions WHERE secret_id = ? AND version = ?', id, v);
	return row ? decrypt(row.value, valueContext(id, v)) : undefined;
}

export function listSecretVersions(id: string): SecretVersion[] {
	return all<{ version: number; created_at: string; created_by: string | null }>(
		'SELECT version, created_at, created_by FROM secret_versions WHERE secret_id = ? ORDER BY version DESC',
		id
	).map((r) => ({ version: r.version, createdAt: r.created_at, createdBy: r.created_by }));
}

export type SecretInput = { type: SecretType; note: string | null; meta: SecretMeta; value: string };

export function createSecret(input: SecretInput & { projectId: string; environmentId: string; path: string; key: string; by: string | null }): Secret {
	const id = randomUUID();
	const at = now();
	tx(() => {
		run(
			'INSERT INTO secrets (id, project_id, environment_id, path, key, type, note, meta, version, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
			id,
			input.projectId,
			input.environmentId,
			input.path,
			input.key,
			input.type,
			input.note,
			JSON.stringify(input.meta),
			at,
			at,
			input.by
		);
		run('INSERT INTO secret_versions (secret_id, version, value, created_at, created_by) VALUES (?, 1, ?, ?, ?)', id, encrypt(input.value, valueContext(id, 1)), at, input.by);
		touchProject(input.projectId);
	});
	return getSecret(id)!;
}

/**
 * Changes a secret. A new value becomes a new version (the old one is kept for history);
 * key, path, type and note changes don't.
 */
export function updateSecret(id: string, patch: Partial<SecretInput> & { key?: string; path?: string; by: string | null }): Secret {
	const s = getSecret(id);
	if (!s) throw new Error('No such secret');
	const at = now();
	tx(() => {
		if (patch.key !== undefined) run('UPDATE secrets SET key = ? WHERE id = ?', patch.key, id);
		if (patch.path !== undefined) run('UPDATE secrets SET path = ? WHERE id = ?', patch.path, id);
		if (patch.type !== undefined) run('UPDATE secrets SET type = ? WHERE id = ?', patch.type, id);
		if (patch.note !== undefined) run('UPDATE secrets SET note = ? WHERE id = ?', patch.note, id);
		if (patch.meta !== undefined) run('UPDATE secrets SET meta = ? WHERE id = ?', JSON.stringify(patch.meta), id);
		if (patch.value !== undefined && patch.value !== readSecretValue(id)) {
			const v = s.version + 1;
			run('INSERT INTO secret_versions (secret_id, version, value, created_at, created_by) VALUES (?, ?, ?, ?, ?)', id, v, encrypt(patch.value, valueContext(id, v)), at, patch.by);
			run('UPDATE secrets SET version = ? WHERE id = ?', v, id);
			run('DELETE FROM secret_versions WHERE secret_id = ? AND version <= ?', id, v - KEEP_VERSIONS - 1);
		}
		run('UPDATE secrets SET updated_at = ?, updated_by = ? WHERE id = ?', at, patch.by, id);
		touchProject(s.projectId);
	});
	return getSecret(id)!;
}

export function deleteSecret(id: string): boolean {
	return Number(run('DELETE FROM secrets WHERE id = ?', id).changes) > 0;
}

/** Deletes a folder and everything under it, in one environment. */
export function deleteFolder(environmentId: string, path: string): number {
	return Number(run("DELETE FROM secrets WHERE environment_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')", environmentId, path, `${likeEscape(path)}/%`).changes);
}

function likeEscape(s: string): string {
	return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Finds secrets by key, folder, note or project, for the extension and the command palette. */
export function searchSecrets(q: string, limit = 50): SecretHit[] {
	const terms = q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
	const where: string[] = [];
	const params: SQLInputValue[] = [];
	for (const t of terms) {
		const like = `%${likeEscape(t)}%`;
		where.push("(s.key LIKE ? ESCAPE '\\' OR s.path LIKE ? ESCAPE '\\' OR IFNULL(s.note, '') LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR p.slug LIKE ? ESCAPE '\\' OR e.slug LIKE ? ESCAPE '\\')");
		params.push(like, like, like, like, like, like);
	}
	const rows = all<SecretRow & { p_slug: string; p_name: string; e_slug: string; e_name: string }>(
		`SELECT s.*, p.slug AS p_slug, p.name AS p_name, e.slug AS e_slug, e.name AS e_name
		 FROM secrets s JOIN projects p ON p.id = s.project_id JOIN environments e ON e.id = s.environment_id
		 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
		 ORDER BY s.updated_at DESC LIMIT ?`,
		...params,
		limit
	);
	return rows.map((r) => ({ ...toSecret(r), projectSlug: r.p_slug, projectName: r.p_name, envSlug: r.e_slug, envName: r.e_name }));
}

/** Certificates that expire before `before`, soonest first: the home page's warning. */
export function expiringCertificates(before: Date): SecretHit[] {
	return searchSecrets('', 10_000)
		.filter((s) => s.type === 'certificate' && s.meta.cert && Date.parse(s.meta.cert.validTo) < before.getTime())
		.sort((a, b) => Date.parse(a.meta.cert!.validTo) - Date.parse(b.meta.cert!.validTo));
}

// ── One-time links ───────────────────────────────────────────────────────────

type ShareRow = {
	id: string;
	ciphertext: string | null;
	label: string | null;
	source: string | null;
	created_by: string | null;
	created_at: string;
	expires_at: string;
	max_views: number;
	views: number;
	opened_at: string | null;
	revoked_at: string | null;
};

export function shareState(r: { revoked_at: string | null; expires_at: string; views: number; max_views: number }, at = Date.now()): ShareState {
	if (r.revoked_at) return 'revoked';
	if (r.views >= r.max_views) return 'opened';
	if (Date.parse(r.expires_at) <= at) return 'expired';
	return 'active';
}

const toShare = (r: ShareRow): Share => ({
	id: r.id,
	label: r.label,
	source: r.source,
	createdBy: r.created_by,
	createdAt: r.created_at,
	expiresAt: r.expires_at,
	maxViews: r.max_views,
	views: r.views,
	openedAt: r.opened_at,
	revokedAt: r.revoked_at,
	state: shareState(r)
});

/** Wipes ciphertext that can no longer be opened, so expired shares don't linger. */
export function purgeShares() {
	run('UPDATE shares SET ciphertext = NULL WHERE ciphertext IS NOT NULL AND (revoked_at IS NOT NULL OR views >= max_views OR expires_at <= ?)', now());
}

export function listShares(createdBy?: string): Share[] {
	purgeShares();
	return (
		createdBy
			? all<ShareRow>('SELECT * FROM shares WHERE created_by = ? ORDER BY created_at DESC LIMIT 500', createdBy)
			: all<ShareRow>('SELECT * FROM shares ORDER BY created_at DESC LIMIT 500')
	).map(toShare);
}

export function getShare(id: string): (Share & { ciphertext: string | null }) | undefined {
	const r = get<ShareRow>('SELECT * FROM shares WHERE id = ?', id);
	return r && { ...toShare(r), ciphertext: r.ciphertext };
}

export function createShare(input: { id: string; ciphertext: string; label: string | null; source: string | null; createdBy: string | null; expiresAt: string; maxViews: number }): Share {
	run(
		'INSERT INTO shares (id, ciphertext, label, source, created_by, created_at, expires_at, max_views) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		input.id,
		input.ciphertext,
		input.label,
		input.source,
		input.createdBy,
		now(),
		input.expiresAt,
		input.maxViews
	);
	return getShare(input.id)!;
}

/**
 * Takes one view, atomically: only while the link is active. The last view wipes the
 * ciphertext in the same statement, so nothing is left to open.
 */
export function claimShareView(id: string): boolean {
	const at = now();
	const res = run(
		`UPDATE shares SET views = views + 1, opened_at = COALESCE(opened_at, ?),
		   ciphertext = CASE WHEN views + 1 >= max_views THEN NULL ELSE ciphertext END
		 WHERE id = ? AND revoked_at IS NULL AND views < max_views AND expires_at > ? AND ciphertext IS NOT NULL`,
		at,
		id,
		at
	);
	return Number(res.changes) === 1;
}

export function revokeShare(id: string): boolean {
	return Number(run('UPDATE shares SET revoked_at = ?, ciphertext = NULL WHERE id = ? AND revoked_at IS NULL', now(), id).changes) > 0;
}

export function deleteShare(id: string): boolean {
	return Number(run('DELETE FROM shares WHERE id = ?', id).changes) > 0;
}

// ── Activity ─────────────────────────────────────────────────────────────────

export function logActivity(action: string, opts: { actor?: string | null; target?: string | null; detail?: string | null } = {}) {
	run('INSERT INTO activity (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)', now(), opts.actor ?? null, action, opts.target ?? null, opts.detail ?? null);
	// Keep the log bounded.
	if (Math.random() < 0.01) run('DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 20000');
}

export function listActivity(limit = 300, target?: string): Activity[] {
	return (
		target
			? all<Activity>("SELECT * FROM activity WHERE target = ? OR target LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?", target, `${likeEscape(target)}/%`, limit)
			: all<Activity>('SELECT * FROM activity ORDER BY id DESC LIMIT ?', limit)
	);
}

export function totals(): { projects: number; secrets: number; activeShares: number } {
	return {
		projects: get<{ n: number }>('SELECT COUNT(*) AS n FROM projects')!.n,
		secrets: get<{ n: number }>('SELECT COUNT(*) AS n FROM secrets')!.n,
		activeShares: get<{ n: number }>('SELECT COUNT(*) AS n FROM shares WHERE revoked_at IS NULL AND views < max_views AND expires_at > ?', now())!.n
	};
}
