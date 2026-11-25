import { json } from '@sveltejs/kit';
import { actor, body, BadRequest, Conflict, handler, list, requireWrite, str } from '#lib/server/http.ts';
import { checkKey, checkPath, checkType, describeValue, envOr404, MAX_VALUE, projectOr404 } from '#lib/server/secrets.ts';
import { createSecret, findSecret, listSecrets, logActivity, readSecretValue, updateSecret } from '#lib/server/store.ts';
import { secretRef } from '#lib/paths.ts';
import type { RequestHandler } from './$types';

/**
 * Lists secrets: ?env=prod narrows to one environment, ?path=/db to one folder (&deep=1 with
 * everything under it), ?key=NAME to one name. Values are left out unless ?values=1.
 */
export const GET: RequestHandler = handler(({ params, url, locals }) => {
	const project = projectOr404(params.project);
	const q = url.searchParams;
	const env = q.get('env') ? envOr404(project, q.get('env')) : undefined;
	const path = q.get('path') !== null ? checkPath(q.get('path')) : undefined;
	let secrets = listSecrets(project.id, { environmentId: env?.id, path, deep: q.get('deep') === '1' });
	if (q.get('key')) secrets = secrets.filter((s) => s.key === q.get('key'));
	if (q.get('values') !== '1') return json({ secrets });
	if (secrets.length) {
		const target = secrets.length === 1 ? secretRef(project.slug, env?.slug ?? '*', secrets[0].path, secrets[0].key) : `${project.slug}/${env?.slug ?? '*'}${path && path !== '/' ? path : ''}`;
		logActivity('secret.read', { actor: actor(locals), target, detail: secrets.length > 1 ? `${secrets.length} values` : null });
	}
	return json({ secrets: secrets.map((s) => ({ ...s, value: readSecretValue(s.id) })) });
});

/**
 * Creates a secret: { env, path, key, type, value, note }. `alsoIn: ["staging", "prod"]` creates
 * the same secret in other environments. `upsert: true` sets the value of one that exists
 * (the CLI's `coffer set`).
 */
export const POST: RequestHandler = handler(async ({ params, request, locals }) => {
	requireWrite(locals);
	const project = projectOr404(params.project);
	const b = await body(request);
	const env = envOr404(project, str(b, 'env'));
	const path = checkPath(str(b, 'path'));
	const key = checkKey(str(b, 'key', { max: 200 }));
	const type = checkType(str(b, 'type'));
	const value = str(b, 'value', { required: true, max: MAX_VALUE, trim: false })!;
	const note = str(b, 'note', { max: 2000 });
	const envs = [env, ...list(b, 'alsoIn').map((e) => envOr404(project, e)).filter((e) => e.id !== env.id)];
	const by = actor(locals);

	const existing = envs.map((e) => findSecret(e.id, path, key)).filter((s) => !!s);
	if (existing.length && !b.upsert) throw new Conflict(`${key} already exists in ${path === '/' ? 'this folder' : path}`);
	if (b.upsert && envs.length > 1) throw new BadRequest('upsert sets one environment at a time');

	const out = envs.map((e) => {
		const prior = findSecret(e.id, path, key);
		// Updating without a type keeps the secret's own (a certificate stays a certificate).
		const t = prior && b.type === undefined ? prior.type : type;
		const meta = describeValue(t, value);
		const s = prior
			? updateSecret(prior.id, { value, type: t, note: b.note !== undefined ? note : undefined, meta, by })
			: createSecret({ projectId: project.id, environmentId: e.id, path, key, type: t, value, note, meta, by });
		logActivity(prior ? 'secret.updated' : 'secret.created', { actor: by, target: secretRef(project.slug, e.slug, path, key), detail: prior ? `v${s.version}` : type });
		return s;
	});
	return json({ secrets: out }, { status: 201 });
});
