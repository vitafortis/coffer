import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { describeCertificate, describePrivateKey, generateKeyPair, isSigningCa, issueCertificate } from '../src/lib/server/pki.ts';

for (const algorithm of ['ecdsa-p256', 'ecdsa-p384', 'ed25519', 'rsa-2048'] as const) {
	test(`self-signed ${algorithm} certificate parses and verifies`, () => {
		const { value, meta } = issueCertificate({ commonName: 'app.internal', sans: ['10.0.0.5', '::1', '*.app.internal'], days: 90, algorithm });
		const cert = new X509Certificate(value);
		assert.ok(cert.verify(cert.publicKey));
		assert.ok(cert.checkPrivateKey(createPrivateKey(value)));
		assert.equal(cert.ca, false);
		assert.equal(meta.cert!.sans.length, 4);
		assert.ok(meta.cert!.sans.includes('10.0.0.5'));
		assert.ok(meta.cert!.sans.includes('app.internal'));
		assert.ok(meta.cert!.selfSigned);
		assert.deepEqual(describeCertificate(value).cert, meta.cert);
	});
}

test('a CA issues a leaf that verifies against it', () => {
	const ca = issueCertificate({ commonName: 'Coffer Test CA', organization: 'Us', days: 3650, algorithm: 'ecdsa-p384', ca: true });
	assert.ok(isSigningCa(ca.value));
	const leaf = issueCertificate({ commonName: 'db.internal', days: 30, algorithm: 'rsa-2048', issuer: ca.value });
	const caCert = new X509Certificate(ca.value);
	const leafCert = new X509Certificate(leaf.value);
	assert.ok(leafCert.verify(caCert.publicKey));
	assert.ok(leafCert.checkIssued(caCert));
	assert.match(leaf.meta.cert!.issuer, /CN=Coffer Test CA/);
	assert.ok(!leaf.meta.cert!.selfSigned);
	assert.ok(!isSigningCa(leaf.value));
	// The chain is stored with the leaf: leaf, CA, key.
	assert.equal(leaf.value.match(/BEGIN CERTIFICATE/g)!.length, 2);
});

test('a leaf cannot sign', () => {
	const leaf = issueCertificate({ commonName: 'x.internal', days: 1, algorithm: 'ecdsa-p256' });
	assert.throws(() => issueCertificate({ commonName: 'y', days: 1, algorithm: 'ecdsa-p256', issuer: leaf.value }), /not a CA/);
});

test('a key that belongs to another certificate is rejected', () => {
	const a = issueCertificate({ commonName: 'a.internal', days: 1, algorithm: 'ecdsa-p256' });
	const b = issueCertificate({ commonName: 'b.internal', days: 1, algorithm: 'ecdsa-p256' });
	const certA = a.value.split('-----BEGIN PRIVATE KEY-----')[0];
	const keyB = '-----BEGIN PRIVATE KEY-----' + b.value.split('-----BEGIN PRIVATE KEY-----')[1];
	assert.throws(() => describeCertificate(certA + keyB), /doesn't belong/);
});

test('ssh ed25519 key pair', () => {
	const { value, meta } = generateKeyPair('ed25519', { ssh: true, comment: 'me@host' });
	assert.match(value, /^-----BEGIN OPENSSH PRIVATE KEY-----/);
	assert.match(meta.publicKey!, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[\w+/]+ me@host$/);
});

test('pem key pairs describe themselves', () => {
	for (const alg of ['ecdsa-p256', 'rsa-2048', 'ed25519'] as const) {
		const { value, meta } = generateKeyPair(alg);
		assert.equal(describePrivateKey(value).algorithm, meta.algorithm);
	}
});

test('openssh private keys describe themselves, ours and ssh-keygen’s', async () => {
	const { value, meta } = generateKeyPair('ed25519', { ssh: true, comment: 'me@host' });
	assert.deepEqual(describePrivateKey(value), { algorithm: 'Ed25519 (OpenSSH)', publicKey: meta.publicKey });

	const { execFileSync } = await import('node:child_process');
	const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const dir = mkdtempSync(join(tmpdir(), 'coffer-ssh-'));
	try {
		for (const [type, pass, alg] of [['rsa', '', 'RSA (OpenSSH)'], ['ed25519', 'secret phrase', 'Ed25519 (OpenSSH, passphrase)'], ['ecdsa', '', 'ECDSA P-256 (OpenSSH)']]) {
			const f = join(dir, type);
			execFileSync('ssh-keygen', ['-q', '-t', type, '-N', pass, '-C', 'kg@test', '-f', f]);
			const d = describePrivateKey(readFileSync(f, 'utf8'));
			assert.equal(d.algorithm, alg);
			const pub = readFileSync(`${f}.pub`, 'utf8').trim();
			// Encrypted keys hide their comment; the key itself must match.
			assert.equal(d.publicKey!.split(' ').slice(0, 2).join(' '), pub.split(' ').slice(0, 2).join(' '));
			if (!pass) assert.equal(d.publicKey, pub);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
