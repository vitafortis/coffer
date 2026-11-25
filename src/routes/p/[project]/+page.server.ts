import { error } from '@sveltejs/kit';
import { normalizePath, pathError } from '#lib/paths.ts';
import { getEnvironment, getProject, listEnvironments, listFolders, listSecrets } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

/** ?env=prod picks the environment (or "all" for the side-by-side overview), ?path=/db the folder. */
export const load: PageServerLoad = ({ params, url }) => {
	const project = getProject(params.project);
	if (!project) error(404, `No project "${params.project}"`);
	const environments = listEnvironments(project.id);
	const overview = url.searchParams.get('env') === 'all';
	const env = overview ? null : (getEnvironment(project.id, url.searchParams.get('env') ?? '') ?? environments[0]);
	const path = normalizePath(url.searchParams.get('path'));
	if (pathError(path)) error(400, pathError(path)!);
	return {
		project,
		environments,
		env,
		path,
		overview,
		// Every folder that holds secrets, in this environment (or any, for the overview).
		folders: listFolders(project.id, env?.id).map((f) => f.path),
		secrets: listSecrets(project.id, { environmentId: env?.id, path })
	};
};
