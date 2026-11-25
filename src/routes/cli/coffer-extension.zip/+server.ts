import { extensionFiles } from '#lib/server/assets.ts';
import { zip } from '#lib/server/zip.ts';
import type { RequestHandler } from './$types';

/** The browser extension, to unzip and load unpacked (chrome://extensions, Developer mode). */
export const GET: RequestHandler = () =>
	new Response(new Uint8Array(zip(extensionFiles())), {
		headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="coffer-extension.zip"', 'cache-control': 'no-cache' }
	});
