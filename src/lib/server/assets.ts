import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { getSettings } from './store.ts';

/** cli/ and extension/ sit next to the app: the repo root in development, /app in the image. */
const ROOT = resolve(process.env.COFFER_ASSETS_DIR ?? '.');

/** The address the CLI and extension should use: Settings' public URL, else this request's. */
export function serverUrl(origin: string): string {
	return getSettings().publicUrl.replace(/\/+$/, '') || origin;
}

export function cliScript(origin: string): string {
	return readFileSync(join(ROOT, 'cli', 'coffer.mjs'), 'utf8').replaceAll('__COFFER_URL__', serverUrl(origin));
}

export function extensionFiles(): { name: string; data: Buffer }[] {
	const dir = join(ROOT, 'extension');
	const out: { name: string; data: Buffer }[] = [];
	const walk = (d: string) => {
		for (const f of readdirSync(d).sort()) {
			const p = join(d, f);
			if (f.startsWith('.')) continue;
			if (statSync(p).isDirectory()) walk(p);
			else out.push({ name: `coffer-extension/${relative(dir, p)}`, data: readFileSync(p) });
		}
	};
	walk(dir);
	return out;
}
