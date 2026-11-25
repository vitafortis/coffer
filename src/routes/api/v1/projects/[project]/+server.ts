import { json } from '@sveltejs/kit';
import { actor, body, Conflict, handler, requireWrite, str } from '#lib/server/http.ts';
import { checkSlug, projectOr404 } from '#lib/server/secrets.ts';
import { deleteProject, listEnvironments, listFolders, logActivity, slugTaken, updateProject } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(({ params }) => {
	const project = projectOr404(params.project);
	return json({ project, environments: listEnvironments(project.id), folders: listFolders(project.id) });
});

export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireWrite(locals);
	const project = projectOr404(params.project);
	const b = await body(request);
	const slug = b.slug !== undefined ? checkSlug(str(b, 'slug', { required: true, max: 48 })!) : undefined;
	if (slug && slugTaken(slug, project.id)) throw new Conflict(`A project called "${slug}" already exists`);
	updateProject(project.id, {
		slug,
		name: b.name !== undefined ? str(b, 'name', { required: true, max: 80 })! : undefined,
		description: b.description !== undefined ? str(b, 'description', { max: 500 }) : undefined
	});
	logActivity('project.updated', { actor: actor(locals), target: slug ?? project.slug });
	return json({ project: projectOr404(project.id) });
});

export const DELETE: RequestHandler = handler(({ params, locals }) => {
	requireWrite(locals);
	const project = projectOr404(params.project);
	deleteProject(project.id);
	logActivity('project.deleted', { actor: actor(locals), target: project.slug });
	return json({ ok: true });
});
