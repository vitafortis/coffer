import { json } from '@sveltejs/kit';
import { actor, body, BadRequest, Conflict, handler, requireWrite, str } from '#lib/server/http.ts';
import { checkSlug, envOr404, projectOr404 } from '#lib/server/secrets.ts';
import { deleteEnvironment, getEnvironment, listEnvironments, logActivity, updateEnvironment } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireWrite(locals);
	const project = projectOr404(params.project);
	const env = envOr404(project, params.env);
	const b = await body(request);
	const slug = b.slug !== undefined ? checkSlug(str(b, 'slug', { required: true, max: 48 })!, 'environment slug') : undefined;
	if (slug && slug !== env.slug && getEnvironment(project.id, slug)) throw new Conflict(`${project.name} already has "${slug}"`);
	updateEnvironment(env.id, { slug, name: b.name !== undefined ? str(b, 'name', { required: true, max: 60 })! : undefined });
	logActivity('environment.updated', { actor: actor(locals), target: `${project.slug}/${slug ?? env.slug}` });
	return json({ environment: getEnvironment(project.id, env.id) });
});

export const DELETE: RequestHandler = handler(({ params, locals }) => {
	requireWrite(locals);
	const project = projectOr404(params.project);
	const env = envOr404(project, params.env);
	if (listEnvironments(project.id).length === 1) throw new BadRequest('A project needs at least one environment');
	deleteEnvironment(env.id);
	logActivity('environment.deleted', { actor: actor(locals), target: `${project.slug}/${env.slug}` });
	return json({ ok: true });
});
