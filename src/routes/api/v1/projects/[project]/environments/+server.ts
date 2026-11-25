import { json } from '@sveltejs/kit';
import { actor, body, Conflict, handler, requireWrite, str } from '#lib/server/http.ts';
import { checkSlug, projectOr404 } from '#lib/server/secrets.ts';
import { createEnvironment, getEnvironment, logActivity } from '#lib/server/store.ts';
import { slugify } from '#lib/paths.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = handler(async ({ params, request, locals }) => {
	requireWrite(locals);
	const project = projectOr404(params.project);
	const b = await body(request);
	const name = str(b, 'name', { required: true, max: 60 })!;
	const slug = checkSlug(str(b, 'slug', { max: 48 }) ?? slugify(name), 'environment slug');
	if (getEnvironment(project.id, slug)) throw new Conflict(`${project.name} already has "${slug}"`);
	const environment = createEnvironment(project.id, slug, name);
	logActivity('environment.created', { actor: actor(locals), target: `${project.slug}/${slug}` });
	return json({ environment }, { status: 201 });
});
