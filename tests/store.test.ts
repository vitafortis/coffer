import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A fresh data folder for this run, set before the store is loaded.
const dir = mkdtempSync(join(tmpdir(), 'coffer-test-'));
process.env.COFFER_DATA_DIR = dir;

const store = await import('../src/lib/server/store.ts');
const { makeShare, openShare } = await import('../src/lib/server/shares.ts');
const { normalizePath, normalizeUrl, childFolders, keyError, pathError } = await import('../src/lib/paths.ts');
const { generatePassword, passwordBits } = await import('../src/lib/generate.ts');

const raw = () => new DatabaseSync(join(dir, 'coffer.db'));

test('values are encrypted at rest and bound to their row', () => {
	const p = store.createProject({ slug: 'app', name: 'App', description: null });
	const [dev] = store.listEnvironments(p.id);
	const s = store.createSecret({ projectId: p.id, environmentId: dev.id, path: '/', key: 'TOKEN', type: 'text', value: 'hunter2-very-secret', note: null, meta: {}, by: 'me' });
	assert.equal(store.readSecretValue(s.id), 'hunter2-very-secret');

	const db = raw();
	const row = db.prepare('SELECT value FROM secret_versions WHERE secret_id = ?').get(s.id) as { value: string };
	assert.match(row.value, /^v1:/);
	assert.ok(!readFileSync(join(dir, 'coffer.db')).includes('hunter2-very-secret'));

	// Copy the ciphertext onto another secret: it must not decrypt there.
	const other = store.createSecret({ projectId: p.id, environmentId: dev.id, path: '/', key: 'OTHER', type: 'text', value: 'x', note: null, meta: {}, by: 'me' });
	db.prepare('UPDATE secret_versions SET value = ? WHERE secret_id = ?').run(row.value, other.id);
	assert.throws(() => store.readSecretValue(other.id));
});

test('a new value is a new version; old ones stay readable', () => {
	const p = store.createProject({ slug: 'versions', name: 'Versions', description: null });
	const [dev] = store.listEnvironments(p.id);
	const s = store.createSecret({ projectId: p.id, environmentId: dev.id, path: '/db', key: 'PASS', type: 'password', value: 'one', note: null, meta: {}, by: 'a' });
	store.updateSecret(s.id, { value: 'two', by: 'b' });
	store.updateSecret(s.id, { value: 'two', by: 'b' }); // unchanged: no new version
	const after = store.updateSecret(s.id, { note: 'rotated', by: 'c' });
	assert.equal(after.version, 2);
	assert.equal(store.readSecretValue(s.id), 'two');
	assert.equal(store.readSecretValue(s.id, 1), 'one');
	assert.deepEqual(store.listSecretVersions(s.id).map((v) => v.version), [2, 1]);
});

test('folders and search', () => {
	const p = store.createProject({ slug: 'folders', name: 'Folders', description: null });
	const [dev, staging] = store.listEnvironments(p.id);
	for (const path of ['/', '/db', '/db/replica', '/cache'])
		store.createSecret({ projectId: p.id, environmentId: dev.id, path, key: 'K', type: 'text', value: 'v', note: null, meta: {}, by: null });
	store.createSecret({ projectId: p.id, environmentId: staging.id, path: '/db', key: 'STRIPE_KEY', type: 'key', value: 'v', note: 'billing', meta: {}, by: null });
	const folders = store.listFolders(p.id, dev.id).map((f) => f.path);
	assert.deepEqual(childFolders(folders, '/'), ['cache', 'db']);
	assert.deepEqual(childFolders(folders, '/db'), ['replica']);
	assert.equal(store.listSecrets(p.id, { environmentId: dev.id, path: '/db', deep: true }).length, 2);
	assert.equal(store.searchSecrets('stripe folders')[0].key, 'STRIPE_KEY');
	assert.equal(store.searchSecrets('billing staging')[0].envSlug, 'staging');
	// LIKE wildcards are literal.
	assert.equal(store.searchSecrets('%').length, 0);
	assert.equal(store.deleteFolder(dev.id, '/db'), 2);
	assert.equal(store.listSecrets(p.id, { environmentId: dev.id }).length, 2);
});

test('one-time links open once, need the key, and wipe themselves', () => {
	const { share, url } = makeShare({ value: 'the secret', label: 'x', source: null, createdBy: 'me', hours: 1, maxViews: 1 }, 'http://coffer.test');
	const [, id, key] = url.match(/\/s\/([\w-]+)#([\w-]+)$/)!;
	assert.equal(id, share.id);

	// The database alone can't open it: the key isn't stored anywhere.
	const stored = raw().prepare('SELECT * FROM shares WHERE id = ?').get(id) as Record<string, string>;
	assert.ok(!JSON.stringify(stored).includes(key));
	assert.ok(!JSON.stringify(stored).includes('the secret'));

	const wrong = openShare(id, 'A'.repeat(43));
	assert.equal(wrong.ok, false);
	assert.equal(!wrong.ok && wrong.status, 403);

	const first = openShare(id, key);
	assert.ok(first.ok && first.value === 'the secret' && first.remaining === 0);
	const second = openShare(id, key);
	assert.equal(!second.ok && second.status, 410);
	assert.equal((raw().prepare('SELECT ciphertext FROM shares WHERE id = ?').get(id) as { ciphertext: string | null }).ciphertext, null);
});

test('links with several views, expiry and revoking', () => {
	const multi = makeShare({ value: 'v', label: null, source: null, createdBy: null, hours: 1, maxViews: 2 }, 'http://x');
	const [, id, key] = multi.url.match(/\/s\/([\w-]+)#([\w-]+)$/)!;
	assert.ok(openShare(id, key).ok);
	assert.ok(openShare(id, key).ok);
	assert.equal(openShare(id, key).ok, false);

	const old = makeShare({ value: 'v', label: null, source: null, createdBy: null, hours: 1, maxViews: 1 }, 'http://x');
	const [, oid, okey] = old.url.match(/\/s\/([\w-]+)#([\w-]+)$/)!;
	raw().prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), oid);
	assert.equal(store.getShare(oid)!.state, 'expired');
	assert.equal(!openShare(oid, okey).ok && 'expired', 'expired');
	store.purgeShares();
	assert.equal(store.getShare(oid)!.ciphertext, null);

	const r = makeShare({ value: 'v', label: null, source: null, createdBy: null, hours: 1, maxViews: 1 }, 'http://x');
	const [, rid, rkey] = r.url.match(/\/s\/([\w-]+)#([\w-]+)$/)!;
	store.revokeShare(rid);
	assert.equal(store.getShare(rid)!.state, 'revoked');
	assert.equal(openShare(rid, rkey).ok, false);
});

test('names and folders', () => {
	assert.equal(normalizePath(' db//replica/ '), '/db/replica');
	assert.equal(normalizePath(''), '/');
	assert.ok(pathError('/a/../b'));
	assert.ok(pathError('/with space'));
	assert.equal(pathError('/db/replica-2'), null);
	assert.equal(keyError('DATABASE_URL'), null);
	assert.ok(keyError('1BAD'));
	assert.ok(keyError('has space'));
});

test('passwords use every chosen set and nothing else', () => {
	for (let i = 0; i < 200; i++) {
		const pw = generatePassword({ length: 8, symbols: false, unambiguous: true });
		assert.equal(pw.length, 8);
		assert.match(pw, /[a-z]/);
		assert.match(pw, /[A-Z]/);
		assert.match(pw, /[0-9]/);
		assert.doesNotMatch(pw, /[^A-Za-z0-9]|[0Oo1lI]/);
	}
	assert.equal(passwordBits({ length: 24 }), 155);
});

test('secrets are found by the site they sign in to', () => {
	const p = store.createProject({ slug: 'sites', name: 'Sites', description: null });
	const [dev] = store.listEnvironments(p.id);
	const add = (key: string, url: string | null) =>
		store.createSecret({ projectId: p.id, environmentId: dev.id, path: '/', key, type: 'password', value: 'x', note: null, url, meta: {}, by: 'me' });
	add('GITHUB', 'https://github.com');
	add('GITLAB_WWW', 'https://www.gitlab.com/users/sign_in');
	add('APP_ONLY', 'https://app.example.com');
	add('NO_URL', null);

	const keys = (host: string) => store.secretsForHost(host).map((s) => s.key).sort();
	assert.deepEqual(keys('github.com'), ['GITHUB']);
	assert.deepEqual(keys('gist.github.com'), ['GITHUB'], 'a parent domain matches its subdomains');
	assert.deepEqual(keys('gitlab.com'), ['GITLAB_WWW'], 'www. is ignored on both sides');
	assert.deepEqual(keys('example.com'), [], 'a subdomain does not match its parent');
	assert.deepEqual(keys('evilgithub.com'), []);
	assert.deepEqual(keys('github.com.evil.io'), []);

	const s = store.updateSecret(store.searchSecrets('GITHUB')[0].id, { url: null, by: 'me' });
	assert.equal(s.url, null);
	assert.deepEqual(keys('github.com'), []);
});

test('URLs are checked and tidied', () => {
	assert.equal(normalizeUrl('github.com'), 'https://github.com');
	assert.equal(normalizeUrl(' https://GitHub.com/ '), 'https://github.com');
	assert.equal(normalizeUrl('http://localhost:8080/login?next=1'), 'http://localhost:8080/login?next=1');
	assert.equal(normalizeUrl(''), null);
	assert.equal(normalizeUrl('ftp://example.com'), undefined);
	assert.equal(normalizeUrl('javascript://alert(1)'), undefined);
	assert.equal(normalizeUrl('https://'), undefined);
});
