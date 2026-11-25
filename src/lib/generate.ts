/**
 * Random values, the same in the browser, the server and the extension (which has its own copy:
 * extension/generate.js). Everything comes from crypto.getRandomValues, with rejection sampling
 * so no character is likelier than another.
 */

export type PasswordOptions = {
	length: number;
	lower: boolean;
	upper: boolean;
	digits: boolean;
	symbols: boolean;
	/** Leave out look-alikes: 0 O o 1 l I | ` ' " */
	unambiguous: boolean;
};

export const DEFAULT_PASSWORD: PasswordOptions = { length: 24, lower: true, upper: true, digits: true, symbols: true, unambiguous: false };

const SETS = {
	lower: 'abcdefghijklmnopqrstuvwxyz',
	upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	digits: '0123456789',
	symbols: '!#$%&()*+,-./:;<=>?@[]^_{}~'
};
const AMBIGUOUS = /[0Oo1lI|`'"]/g;

/** A uniformly random integer in [0, max). */
export function randomInt(max: number): number {
	if (max <= 0 || max > 2 ** 32) throw new Error('randomInt: bad range');
	const limit = Math.floor(2 ** 32 / max) * max;
	const buf = new Uint32Array(1);
	for (;;) {
		crypto.getRandomValues(buf);
		if (buf[0] < limit) return buf[0] % max;
	}
}

export function generatePassword(opts: Partial<PasswordOptions> = {}): string {
	const o = { ...DEFAULT_PASSWORD, ...opts };
	const length = Math.min(Math.max(Math.trunc(o.length) || 0, 4), 512);
	const sets = (['lower', 'upper', 'digits', 'symbols'] as const)
		.filter((k) => o[k])
		.map((k) => (o.unambiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
	if (!sets.length) throw new Error('Pick at least one kind of character');
	const all = sets.join('');
	// One from each chosen set, so "digits and symbols" always has both, then shuffle.
	const chars = sets.map((s) => s[randomInt(s.length)]);
	while (chars.length < length) chars.push(all[randomInt(all.length)]);
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.slice(0, length).join('');
}

/** Bits of entropy of a password made with these options (roughly: length × log2(alphabet)). */
export function passwordBits(opts: Partial<PasswordOptions>): number {
	const o = { ...DEFAULT_PASSWORD, ...opts };
	const n = (['lower', 'upper', 'digits', 'symbols'] as const)
		.filter((k) => o[k])
		.reduce((sum, k) => sum + (o.unambiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]).length, 0);
	return n ? Math.floor(o.length * Math.log2(n)) : 0;
}

export type KeyEncoding = 'hex' | 'base64' | 'base64url';

export function randomBytesOf(n: number): Uint8Array {
	const b = new Uint8Array(Math.min(Math.max(Math.trunc(n) || 0, 1), 1024));
	crypto.getRandomValues(b);
	return b;
}

export function encodeBytes(b: Uint8Array, enc: KeyEncoding): string {
	if (enc === 'hex') return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
	let bin = '';
	for (const x of b) bin += String.fromCharCode(x);
	const s = btoa(bin);
	return enc === 'base64' ? s : s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random key: 32 bytes is right for HMAC-SHA256, AES-256 and JWT HS256 secrets. */
export function generateKey(bytes = 32, enc: KeyEncoding = 'base64'): string {
	return encodeBytes(randomBytesOf(bytes), enc);
}

export function generateUuid(): string {
	return crypto.randomUUID();
}

export type GenerateKind = 'password' | 'key' | 'uuid';
