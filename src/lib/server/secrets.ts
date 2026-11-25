import { keyError, normalizePath, pathError, secretRef, SLUG_RE } from '#lib/paths.ts';
import { SECRET_TYPES, type Environment, type Project, type Secret, type SecretMeta, type SecretType } from '#lib/types.ts';
import { BadRequest, NotFound } from './http.ts';
import { describeCertificate, describePrivateKey } from './pki.ts';
import { getEnvironment, getProject, getSecret } from './store.ts';

/** 256 KB: enough for a certificate chain or a config file, not for files. */
export const MAX_VALUE = 256 * 1024;

export function projectOr404(idOrSlug: string): Project {
	const p = getProject(idOrSlug);
	if (!p) throw new NotFound(`No project "${idOrSlug}"`);
	return p;
}

export function envOr404(project: Project, idOrSlug: string | null | undefined): Environment {
	if (!idOrSlug) throw new BadRequest('Say which environment ("env")');
	const e = getEnvironment(project.id, idOrSlug);
	if (!e) throw new NotFound(`No environment "${idOrSlug}" in ${project.slug}`);
	return e;
}

export function secretOr404(id: string): Secret {
	const s = getSecret(id);
	if (!s) throw new NotFound('No such secret');
	return s;
}

export function checkSlug(slug: string, what = 'slug'): string {
	if (!SLUG_RE.test(slug)) throw new BadRequest(`The ${what} must be lowercase letters, digits and dashes`);
	return slug;
}

export function checkKey(key: string | null): string {
	const err = keyError(key ?? '');
	if (err) throw new BadRequest(err);
	return key!;
}

export function checkPath(path: string | null | undefined): string {
	const p = normalizePath(path);
	const err = pathError(p);
	if (err) throw new BadRequest(err);
	return p;
}

export function checkType(type: string | null): SecretType {
	const t = (type ?? 'text') as SecretType;
	if (!SECRET_TYPES.some((x) => x.value === t)) throw new BadRequest(`Unknown type "${type}"`);
	return t;
}

/**
 * Checks a value against its type and works out what to show about it without decrypting:
 * a certificate's subject and expiry, a key's algorithm and public half.
 */
export function describeValue(type: SecretType, value: string): SecretMeta {
	if (value.length > MAX_VALUE) throw new BadRequest('That value is too large (at most 256 KB)');
	if (type === 'certificate') return describeCertificate(value);
	if (type === 'keypair') return describePrivateKey(value);
	if ((type === 'text' || type === 'password' || type === 'key') && /[\r\n]/.test(value.replace(/\n$/, ''))) {
		throw new BadRequest('This type holds one line; use a Note for multi-line values');
	}
	return {};
}

/** A secret's full name, for the activity log. */
export function refOf(s: Secret): string {
	const p = getProject(s.projectId);
	const e = p && getEnvironment(p.id, s.environmentId);
	return p && e ? secretRef(p.slug, e.slug, s.path, s.key) : s.key;
}
