import { json } from '@sveltejs/kit';
import { PkiError } from './pki.ts';

export class BadRequest extends Error {}
export class NotFound extends Error {}
export class Conflict extends Error {}
export class Forbidden extends Error {}

/** Wraps an API handler so thrown errors become JSON responses with useful messages. */
export function handler<E>(fn: (event: E) => Promise<Response> | Response) {
	return async (event: E) => {
		try {
			return await fn(event);
		} catch (err) {
			if (err instanceof Response) return err;
			if (err instanceof BadRequest || err instanceof PkiError) return json({ message: err.message }, { status: 400 });
			if (err instanceof NotFound) return json({ message: err.message }, { status: 404 });
			if (err instanceof Conflict) return json({ message: err.message }, { status: 409 });
			if (err instanceof Forbidden) return json({ message: err.message }, { status: 403 });
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			// A unique constraint means someone else just made the same thing.
			if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) return json({ message: 'That already exists' }, { status: 409 });
			console.error('[coffer]', err);
			return json({ message: 'Something went wrong on the server' }, { status: 500 });
		}
	};
}

/** Users and server settings are for admins. */
export function requireAdmin(locals: App.Locals) {
	if (locals.user?.role !== 'admin') throw new Forbidden('Only an admin can change this');
	if (locals.via?.kind === 'token') throw new Forbidden('Sign in to the web app to change this');
}

/** Read-only tokens can read and share, but not change anything stored. */
export function requireWrite(locals: App.Locals) {
	if (locals.via?.kind === 'token' && locals.via.token.readOnly) throw new Forbidden('This token is read-only');
}

/** Account and token management only from the web app, so a leaked token can't mint more. */
export function requireSession(locals: App.Locals) {
	if (locals.via?.kind !== 'session') throw new Forbidden('Sign in to the web app to change this');
}

/** Who did it, for the activity log: the person, and the token when it was one. */
export function actor(locals: App.Locals): string | null {
	const u = locals.user;
	if (!u) return null;
	return locals.via?.kind === 'token' ? `${u.email} (token: ${locals.via.token.name})` : u.email;
}

/** The request's JSON body as an object, or a 400. */
export async function body(request: Request): Promise<Record<string, unknown>> {
	const b = await request.json().catch(() => null);
	if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequest('Expected a JSON object');
	return b as Record<string, unknown>;
}

export function str(b: Record<string, unknown>, key: string, { required = false, max = 500, trim = true } = {}): string | null {
	const v = b[key];
	if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
		if (required) throw new BadRequest(`"${key}" is required`);
		return null;
	}
	if (typeof v !== 'string') throw new BadRequest(`"${key}" must be a string`);
	if (v.length > max) throw new BadRequest(`"${key}" is too long (at most ${max.toLocaleString()} characters)`);
	return trim ? v.trim() : v;
}

export function int(b: Record<string, unknown>, key: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | null {
	const v = b[key];
	if (v === undefined || v === null || v === '') return null;
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`"${key}" must be a whole number from ${min} to ${max}`);
	return n;
}

export function bool(b: Record<string, unknown>, key: string): boolean | null {
	const v = b[key];
	if (v === undefined || v === null) return null;
	if (typeof v !== 'boolean') throw new BadRequest(`"${key}" must be true or false`);
	return v;
}

/** A list from a JSON array or a comma/newline-separated string. */
export function list(b: Record<string, unknown>, key: string): string[] {
	const v = b[key];
	const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : [];
	return items.map((x) => String(x).trim()).filter(Boolean).slice(0, 1000);
}
