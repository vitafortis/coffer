/**
 * Key pairs and certificates with nothing but node:crypto. Node can make keys and parse
 * certificates but not build them, so the few X.509 structures we need are encoded by hand
 * (DER below). Everything is checked by parsing the result back with X509Certificate.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';
import type { CertInfo, SecretMeta } from '#lib/types.ts';

export class PkiError extends Error {}

// ── DER ──────────────────────────────────────────────────────────────────────

function len(n: number): Buffer {
	if (n < 0x80) return Buffer.from([n]);
	const bytes: number[] = [];
	while (n > 0) {
		bytes.unshift(n & 0xff);
		n >>= 8;
	}
	return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, ...parts: Buffer[]) => {
	const body = Buffer.concat(parts);
	return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
const set = (...parts: Buffer[]) => tlv(0x31, ...parts);
const ctx = (n: number, ...parts: Buffer[]) => tlv(0xa0 + n, ...parts);
const NULL = Buffer.from([0x05, 0x00]);
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const octets = (b: Buffer) => tlv(0x04, b);
const bits = (b: Buffer) => tlv(0x03, Buffer.from([0]), b);
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));

function int(b: Buffer): Buffer {
	let i = 0;
	while (i < b.length - 1 && b[i] === 0) i++;
	b = b.subarray(i);
	return tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
}

function oid(dotted: string): Buffer {
	const [a, b, ...rest] = dotted.split('.').map(Number);
	const out = [40 * a + b];
	for (let n of rest) {
		const chunk = [n & 0x7f];
		while ((n >>= 7) > 0) chunk.unshift(0x80 | (n & 0x7f));
		out.push(...chunk);
	}
	return tlv(0x06, Buffer.from(out));
}

function time(d: Date): Buffer {
	const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
	// UTCTime through 2049, GeneralizedTime after (RFC 5280 4.1.2.5).
	return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
}

/** Reads one DER element: its full bytes and its content. */
function readTlv(buf: Buffer, at: number): { tag: number; start: number; end: number; content: Buffer } {
	const tag = buf[at];
	let n = buf[at + 1];
	let off = at + 2;
	if (n & 0x80) {
		const count = n & 0x7f;
		n = 0;
		for (let i = 0; i < count; i++) n = (n << 8) | buf[off + i];
		off += count;
	}
	return { tag, start: at, end: off + n, content: buf.subarray(off, off + n) };
}

/** The subject Name of a certificate, as DER: the issuer of the certificates it signs. */
function subjectDer(certDer: Buffer): Buffer {
	const cert = readTlv(certDer, 0);
	const tbs = readTlv(cert.content, 0);
	const fields: { start: number; end: number; tag: number }[] = [];
	for (let at = 0; at < tbs.content.length; ) {
		const f = readTlv(tbs.content, at);
		fields.push(f);
		at = f.end;
	}
	// [0] version is optional; then serial, signature, issuer, validity, subject.
	const base = fields[0].tag === 0xa0 ? 1 : 0;
	const s = fields[base + 4];
	return tbs.content.subarray(s.start, s.end);
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export type KeyAlgorithm = 'ed25519' | 'ecdsa-p256' | 'ecdsa-p384' | 'rsa-2048' | 'rsa-3072' | 'rsa-4096';
export const KEY_ALGORITHMS: { value: KeyAlgorithm; label: string }[] = [
	{ value: 'ecdsa-p256', label: 'ECDSA P-256' },
	{ value: 'ecdsa-p384', label: 'ECDSA P-384' },
	{ value: 'ed25519', label: 'Ed25519' },
	{ value: 'rsa-2048', label: 'RSA 2048' },
	{ value: 'rsa-3072', label: 'RSA 3072' },
	{ value: 'rsa-4096', label: 'RSA 4096' }
];

function newKeyPair(alg: KeyAlgorithm): { privateKey: KeyObject; publicKey: KeyObject } {
	switch (alg) {
		case 'ed25519':
			return generateKeyPairSync('ed25519');
		case 'ecdsa-p256':
			return generateKeyPairSync('ec', { namedCurve: 'P-256' });
		case 'ecdsa-p384':
			return generateKeyPairSync('ec', { namedCurve: 'P-384' });
		case 'rsa-2048':
		case 'rsa-3072':
		case 'rsa-4096':
			return generateKeyPairSync('rsa', { modulusLength: Number(alg.slice(4)) });
		default:
			throw new PkiError(`Unknown key algorithm "${alg}"`);
	}
}

function algorithmOf(key: KeyObject): string {
	const t = key.asymmetricKeyType;
	if (t === 'ec') return `ECDSA ${key.asymmetricKeyDetails?.namedCurve === 'secp384r1' ? 'P-384' : key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? 'P-256' : key.asymmetricKeyDetails?.namedCurve}`;
	if (t === 'rsa') return `RSA ${key.asymmetricKeyDetails?.modulusLength}`;
	return t === 'ed25519' ? 'Ed25519' : String(t);
}

const sshString = (b: Buffer | string) => {
	const buf = typeof b === 'string' ? Buffer.from(b) : b;
	const l = Buffer.alloc(4);
	l.writeUInt32BE(buf.length);
	return Buffer.concat([l, buf]);
};
const sshMpint = (b: Buffer) => sshString(b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);

/** The authorized_keys line for an Ed25519 or RSA public key; undefined for ECDSA. */
export function opensshPublicKey(pub: KeyObject, comment = ''): string | undefined {
	const jwk = pub.export({ format: 'jwk' });
	let blob: Buffer;
	let type: string;
	if (pub.asymmetricKeyType === 'ed25519') {
		type = 'ssh-ed25519';
		blob = Buffer.concat([sshString(type), sshString(Buffer.from(jwk.x!, 'base64url'))]);
	} else if (pub.asymmetricKeyType === 'rsa') {
		type = 'ssh-rsa';
		blob = Buffer.concat([sshString(type), sshMpint(Buffer.from(jwk.e!, 'base64url')), sshMpint(Buffer.from(jwk.n!, 'base64url'))]);
	} else return undefined;
	return `${type} ${blob.toString('base64')}${comment ? ` ${comment}` : ''}`;
}

/** An unencrypted OpenSSH private key ("openssh-key-v1") for Ed25519, the format ssh-keygen writes. */
function opensshEd25519Private(priv: KeyObject, comment: string): string {
	const jwk = priv.export({ format: 'jwk' });
	const seed = Buffer.from(jwk.d!, 'base64url');
	const pk = Buffer.from(jwk.x!, 'base64url');
	const pubBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(pk)]);
	const check = randomBytes(4);
	let body = Buffer.concat([check, check, sshString('ssh-ed25519'), sshString(pk), sshString(Buffer.concat([seed, pk])), sshString(comment)]);
	const pad: number[] = [];
	for (let i = 1; (body.length + pad.length) % 8; i++) pad.push(i);
	body = Buffer.concat([body, Buffer.from(pad)]);
	const n = Buffer.alloc(4);
	n.writeUInt32BE(1);
	const blob = Buffer.concat([Buffer.from('openssh-key-v1\0'), sshString('none'), sshString('none'), sshString(''), n, sshString(pubBlob), sshString(body)]);
	const lines = blob.toString('base64').match(/.{1,70}/g)!.join('\n');
	return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

export type KeyPairResult = { value: string; meta: SecretMeta };

/** A new key pair: the private key is the secret's value, the public key goes in its details. */
export function generateKeyPair(alg: KeyAlgorithm, opts: { ssh?: boolean; comment?: string } = {}): KeyPairResult {
	const { privateKey, publicKey } = newKeyPair(alg);
	const comment = opts.comment?.trim() ?? '';
	const ssh = opts.ssh && alg === 'ed25519';
	const value = ssh ? opensshEd25519Private(privateKey, comment) : (privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
	const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
	return { value, meta: { algorithm: algorithmOf(privateKey), publicKey: (opts.ssh && opensshPublicKey(publicKey, comment)) || pem.trim() } };
}

/**
 * An OpenSSH private key ("openssh-key-v1") keeps its public key in the clear, ahead of the
 * (possibly encrypted) private part; the comment comes from the private part when it isn't encrypted.
 */
function describeOpenssh(pem: string): SecretMeta {
	const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
	const buf = Buffer.from(b64, 'base64');
	const magic = 'openssh-key-v1\0';
	if (buf.subarray(0, magic.length).toString('latin1') !== magic) throw new PkiError('That OpenSSH key could not be read');
	let at = magic.length;
	const next = () => {
		const n = buf.readUInt32BE(at);
		const out = buf.subarray(at + 4, at + 4 + n);
		at += 4 + n;
		return out;
	};
	try {
		const cipher = next().toString();
		next(); // kdf name
		next(); // kdf options
		at += 4; // number of keys
		const pub = next();
		const type = pub.subarray(4, 4 + pub.readUInt32BE(0)).toString();
		let comment = '';
		if (cipher === 'none') {
			const priv = next();
			let p = 8; // two check words
			const s = () => {
				const n = priv.readUInt32BE(p);
				const out = priv.subarray(p + 4, p + 4 + n);
				p += 4 + n;
				return out;
			};
			s(); // key type
			const fields = type === 'ssh-ed25519' ? 2 : type === 'ssh-rsa' ? 6 : type.startsWith('ecdsa-') ? 3 : 0;
			for (let i = 0; i < fields; i++) s();
			comment = fields ? s().toString() : '';
		}
		const names: Record<string, string> = { 'ssh-ed25519': 'Ed25519', 'ssh-rsa': 'RSA', 'ecdsa-sha2-nistp256': 'ECDSA P-256', 'ecdsa-sha2-nistp384': 'ECDSA P-384' };
		return { algorithm: `${names[type] ?? type} (OpenSSH${cipher === 'none' ? '' : ', passphrase'})`, publicKey: `${type} ${pub.toString('base64')}${comment ? ` ${comment}` : ''}` };
	} catch {
		throw new PkiError('That OpenSSH key could not be read');
	}
}

/** What a pasted private key is, and its public half. Throws PkiError when it isn't a key. */
export function describePrivateKey(pem: string): SecretMeta {
	let key: KeyObject;
	try {
		key = createPrivateKey(pem);
	} catch {
		if (/OPENSSH PRIVATE KEY/.test(pem)) return describeOpenssh(pem);
		throw new PkiError('That is not a PEM private key');
	}
	const pub = createPublicKey(key);
	return { algorithm: algorithmOf(key), publicKey: opensshPublicKey(pub) ?? (pub.export({ type: 'spki', format: 'pem' }) as string).trim() };
}

// ── Certificates ─────────────────────────────────────────────────────────────

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]+?-----END \1-----/g;

function pemBlocks(text: string): { type: string; pem: string }[] {
	return [...text.matchAll(PEM_BLOCK)].map((m) => ({ type: m[1], pem: m[0] }));
}

export function certInfo(cert: X509Certificate, hasKey: boolean): CertInfo {
	return {
		subject: cert.subject.replace(/\n/g, ', '),
		issuer: cert.issuer.replace(/\n/g, ', '),
		validFrom: new Date(cert.validFrom).toISOString(),
		validTo: new Date(cert.validTo).toISOString(),
		sans: (cert.subjectAltName ?? '')
			.split(/,\s*/)
			.filter(Boolean)
			.map((s) => s.replace(/^(DNS|IP Address):/, '')),
		fingerprint: cert.fingerprint256,
		selfSigned: cert.issuer === cert.subject && cert.verify(cert.publicKey),
		ca: cert.ca,
		hasKey
	};
}

/**
 * Reads a certificate secret: one or more PEM certificates (leaf first) and, optionally, the leaf's
 * private key. Throws PkiError with a useful message when it doesn't hold together.
 */
export function describeCertificate(text: string): SecretMeta {
	const blocks = pemBlocks(text);
	const certs = blocks.filter((b) => b.type === 'CERTIFICATE');
	if (!certs.length) throw new PkiError('Paste a PEM certificate (-----BEGIN CERTIFICATE-----)');
	let leaf: X509Certificate;
	try {
		leaf = new X509Certificate(certs[0].pem);
	} catch {
		throw new PkiError('The first certificate could not be read');
	}
	const keyBlock = blocks.find((b) => /PRIVATE KEY$/.test(b.type));
	if (keyBlock) {
		let key: KeyObject;
		try {
			key = createPrivateKey(keyBlock.pem);
		} catch {
			throw new PkiError('The private key could not be read (encrypted keys are not supported)');
		}
		if (!leaf.checkPrivateKey(key)) throw new PkiError("The private key doesn't belong to the first certificate");
	}
	return { cert: certInfo(leaf, !!keyBlock), algorithm: algorithmOf(leaf.publicKey) };
}

export type CertRequest = {
	commonName: string;
	organization?: string;
	/** DNS names and IP addresses. The common name is added when it looks like one. */
	sans?: string[];
	days: number;
	algorithm: KeyAlgorithm;
	/** A certificate authority rather than a server/client certificate. */
	ca?: boolean;
	/** The PEM (certificate + key) of a CA to sign with; self-signed when absent. */
	issuer?: string;
};

function sigAlg(key: KeyObject): { id: Buffer; hash: string | null } {
	const t = key.asymmetricKeyType;
	if (t === 'ed25519') return { id: seq(oid('1.3.101.112')), hash: null };
	if (t === 'ec') {
		const p384 = key.asymmetricKeyDetails?.namedCurve === 'secp384r1';
		return { id: seq(oid(p384 ? '1.2.840.10045.4.3.3' : '1.2.840.10045.4.3.2')), hash: p384 ? 'sha384' : 'sha256' };
	}
	if (t === 'rsa') return { id: seq(oid('1.2.840.113549.1.1.11'), NULL), hash: 'sha256' };
	throw new PkiError(`Can't sign with a ${t} key`);
}

function ipBytes(ip: string): Buffer {
	if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number));
	// IPv6: expand "::" and write eight 16-bit groups.
	const [head, tail = ''] = ip.split('::');
	const h = head ? head.split(':') : [];
	const t = tail ? tail.split(':') : [];
	const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
	return Buffer.concat(groups.map((g) => Buffer.from(g.padStart(4, '0'), 'hex')));
}

const name = (cn: string, org?: string) =>
	seq(...[...(org ? [set(seq(oid('2.5.4.10'), utf8(org)))] : []), set(seq(oid('2.5.4.3'), utf8(cn)))]);

const looksLikeHost = (s: string) => isIP(s) > 0 || /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(s);

/** A new certificate and its key, as one PEM: certificate (then the issuer's), then the private key. */
export function issueCertificate(req: CertRequest): { value: string; meta: SecretMeta } {
	const cn = req.commonName.trim();
	if (!cn) throw new PkiError('A common name is required');
	const days = Math.trunc(req.days);
	if (!(days >= 1 && days <= 3650 * 3)) throw new PkiError('Validity must be 1 to 10950 days');

	let issuerName: Buffer;
	let signingKey: KeyObject;
	let issuerCert: X509Certificate | undefined;
	let issuerPem = '';
	const { privateKey, publicKey } = newKeyPair(req.algorithm);
	if (req.issuer) {
		const blocks = pemBlocks(req.issuer);
		const c = blocks.find((b) => b.type === 'CERTIFICATE');
		const k = blocks.find((b) => /PRIVATE KEY$/.test(b.type));
		if (!c || !k) throw new PkiError('The CA must hold its certificate and private key');
		issuerCert = new X509Certificate(c.pem);
		if (!issuerCert.ca) throw new PkiError('That certificate is not a CA');
		signingKey = createPrivateKey(k.pem);
		issuerName = subjectDer(issuerCert.raw);
		issuerPem = blocks.filter((b) => b.type === 'CERTIFICATE').map((b) => b.pem).join('\n') + '\n';
	} else {
		signingKey = privateKey;
		issuerName = name(cn, req.organization?.trim() || undefined);
	}

	const spki = publicKey.export({ type: 'spki', format: 'der' });
	const ski = createHash('sha1').update(spki).digest();
	const sans = [...new Set([...(looksLikeHost(cn) && !req.ca ? [cn] : []), ...(req.sans ?? []).map((s) => s.trim()).filter(Boolean)])];
	for (const s of sans) if (!looksLikeHost(s)) throw new PkiError(`"${s}" is not a host name or IP address`);

	const notBefore = new Date(Date.now() - 5 * 60_000);
	const notAfter = new Date(notBefore.getTime() + days * 86_400_000);
	const alg = sigAlg(signingKey);

	const ext = (id: string, critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
	const extensions = [
		ext('2.5.29.19', true, seq(...(req.ca ? [bool(true)] : []))),
		// keyUsage: CA → keyCertSign + cRLSign; leaf → digitalSignature + keyEncipherment.
		ext('2.5.29.15', true, req.ca ? tlv(0x03, Buffer.from([1, 0x06])) : tlv(0x03, Buffer.from([5, 0xa0]))),
		...(req.ca ? [] : [ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'), oid('1.3.6.1.5.5.7.3.2')))]),
		ext('2.5.29.14', false, octets(ski)),
		...(sans.length ? [ext('2.5.29.17', false, seq(...sans.map((s) => (isIP(s) ? tlv(0x87, ipBytes(s)) : tlv(0x82, Buffer.from(s))))))] : [])
	];
	if (issuerCert) {
		const issuerSki = createHash('sha1').update(issuerCert.publicKey.export({ type: 'spki', format: 'der' })).digest();
		extensions.push(ext('2.5.29.35', false, seq(tlv(0x80, issuerSki))));
	}

	const serial = randomBytes(16);
	serial[0] &= 0x7f;
	const tbs = seq(
		ctx(0, int(Buffer.from([2]))),
		int(serial),
		alg.id,
		issuerName,
		seq(time(notBefore), time(notAfter)),
		name(cn, req.organization?.trim() || undefined),
		spki,
		ctx(3, seq(...extensions))
	);
	const signature = sign(alg.hash, tbs, signingKey);
	const der = seq(tbs, alg.id, bits(signature));
	const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;

	// Check it the way everyone else will.
	const parsed = new X509Certificate(certPem);
	if (!parsed.verify(issuerCert ? issuerCert.publicKey : publicKey)) throw new PkiError('The new certificate failed to verify');

	const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
	return { value: certPem + issuerPem + keyPem, meta: { cert: certInfo(parsed, true), algorithm: algorithmOf(privateKey) } };
}

/** Whether a stored certificate value is a CA that can sign (has its key). */
export function isSigningCa(pem: string): boolean {
	try {
		const blocks = pemBlocks(pem);
		const c = blocks.find((b) => b.type === 'CERTIFICATE');
		return !!c && !!blocks.find((b) => /PRIVATE KEY$/.test(b.type)) && new X509Certificate(c.pem).ca;
	} catch {
		return false;
	}
}
