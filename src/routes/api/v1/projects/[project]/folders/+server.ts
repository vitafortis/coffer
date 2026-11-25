import { json } from '@sveltejs/kit';
import { actor, BadRequest, handler, requireWrite } from '#lib/server/http.ts';
import { checkPath, envOr404, projectOr404 } from '#lib/server/secrets.ts';
import { deleteFolder, logActivity } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Deletes a folder and everything in it, in one environment: ?env=prod&path=/db */
export const DELETE: RequestHandler = handler(({ params, url, locals }) => {
	requireWrite(locals);
	const project = projectOr404(params.project);
	const env = envOr404(project, url.searchParams.get('env'));
	const path = checkPath(url.searchParams.get('path'));
	if (path === '/') throw new BadRequest("The root folder can't be deleted");
	const deleted = deleteFolder(env.id, path);
	logActivity('folder.deleted', { actor: actor(locals), target: `${project.slug}/${env.slug}${path}`, detail: `${deleted} secrets` });
	return json({ deleted });
});
