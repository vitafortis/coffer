import { json } from '@sveltejs/kit';
import { actor, body, BadRequest, Conflict, handler, requireWrite, str } from '#lib/server/http.ts';
import { checkSlug } from '#lib/server/secrets.ts';
import { createProject, listProjects, logActivity, slugTaken } from '#lib/server/store.ts';
import { slugify } from '#lib/paths.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(() => json({ projects: listProjects() }));

export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireWrite(locals);
	const b = await body(request);
	const name = str(b, 'name', { required: true, max: 80 })!;
	const slug = checkSlug(str(b, 'slug', { max: 48 }) ?? slugify(name));
	if (!slug) throw new BadRequest('Give the project a name with some letters or digits');
	if (slugTaken(slug)) throw new Conflict(`A project called "${slug}" already exists`);
	const envs = Array.isArray(b.environments)
		? (b.environments as unknown[]).map((e) => {
				const n = String(e).trim();
				return { slug: checkSlug(slugify(n), 'environment slug'), name: n };
			})
		: undefined;
	if (envs && !envs.length) throw new BadRequest('A project needs at least one environment');
	const project = createProject({ slug, name, description: str(b, 'description', { max: 500 }), environments: envs });
	logActivity('project.created', { actor: actor(locals), target: project.slug });
	return json({ project }, { status: 201 });
});
