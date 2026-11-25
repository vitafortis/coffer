import { cliScript } from '#lib/server/assets.ts';
import type { RequestHandler } from './$types';

/** The CLI, pointed at this server. Public: it holds no secrets. */
export const GET: RequestHandler = ({ locals }) =>
	new Response(cliScript(locals.origin), {
		headers: { 'content-type': 'text/javascript; charset=utf-8', 'content-disposition': 'inline; filename="coffer"', 'cache-control': 'no-cache' }
	});
