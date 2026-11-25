/** Names and folders, the same rules in the browser, the server and the CLI. */

export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SEGMENT_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** "db/replica", "/db/replica/" and " /db//replica " all become "/db/replica"; "" becomes "/". */
export function normalizePath(input: string | null | undefined): string {
	const parts = (input ?? '').split('/').map((s) => s.trim()).filter(Boolean);
	return '/' + parts.join('/');
}

export function pathError(path: string): string | null {
	if (path === '/') return null;
	const parts = path.slice(1).split('/');
	if (parts.length > 8) return 'Folders nest at most 8 deep';
	for (const p of parts) if (!SEGMENT_RE.test(p) || p === '.' || p === '..') return `"${p}" can't be a folder name (letters, digits, _ . - only)`;
	return null;
}

export function keyError(key: string): string | null {
	if (!key) return 'A name is required';
	if (!KEY_RE.test(key)) return 'Names start with a letter or _, then letters, digits, _ . - (at most 128)';
	return null;
}

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/[\s_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 48);
}

/** The folders directly inside `path`, from the list of every folder that holds secrets. */
export function childFolders(all: string[], path: string): string[] {
	const prefix = path === '/' ? '/' : `${path}/`;
	const out = new Set<string>();
	for (const p of all) {
		if (p === path || !p.startsWith(prefix)) continue;
		out.add(p.slice(prefix.length).split('/')[0]);
	}
	return [...out].sort((a, b) => a.localeCompare(b));
}

export const joinPath = (path: string, name: string) => (path === '/' ? `/${name}` : `${path}/${name}`);

/** "project/env/folder/KEY": how the CLI and the activity log name a secret. */
export function secretRef(projectSlug: string, envSlug: string, path: string, key: string): string {
	return `${projectSlug}/${envSlug}${path === '/' ? '' : path}/${key}`;
}
