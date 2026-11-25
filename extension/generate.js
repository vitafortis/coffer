// Passwords, the same rules as the web app (src/lib/generate.ts) and the CLI.

export const DEFAULT_OPTIONS = { length: 24, lower: true, upper: true, digits: true, symbols: true, unambiguous: false };

const SETS = {
	lower: 'abcdefghijklmnopqrstuvwxyz',
	upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	digits: '0123456789',
	symbols: '!#$%&()*+,-./:;<=>?@[]^_{}~'
};
const AMBIGUOUS = /[0Oo1lI|`'"]/g;

function randomInt(max) {
	const limit = Math.floor(2 ** 32 / max) * max;
	const buf = new Uint32Array(1);
	for (;;) {
		crypto.getRandomValues(buf);
		if (buf[0] < limit) return buf[0] % max;
	}
}

export function generatePassword(opts = {}) {
	const o = { ...DEFAULT_OPTIONS, ...opts };
	const length = Math.min(Math.max(Math.trunc(o.length) || 0, 4), 512);
	const sets = ['lower', 'upper', 'digits', 'symbols'].filter((k) => o[k]).map((k) => (o.unambiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
	if (!sets.length) throw new Error('Pick at least one kind of character');
	const all = sets.join('');
	const chars = sets.map((s) => s[randomInt(s.length)]);
	while (chars.length < length) chars.push(all[randomInt(all.length)]);
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.slice(0, length).join('');
}

export function passwordBits(opts = {}) {
	const o = { ...DEFAULT_OPTIONS, ...opts };
	const n = ['lower', 'upper', 'digits', 'symbols'].filter((k) => o[k]).reduce((sum, k) => sum + (o.unambiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]).length, 0);
	return n ? Math.floor(o.length * Math.log2(n)) : 0;
}
