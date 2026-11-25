import { json, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { authenticate } from '#lib/server/auth.ts';
import { publicUrl } from '#lib/server/origin.ts';
import { purgeShares } from '#lib/server/store.ts';

export const init: ServerInit = () => {
	// Wipe what expired links still hold, every few minutes.
	setInterval(() => purgeShares(), 5 * 60_000).unref();
};

// One-time links (/s/…) open without signing in: the key in the link is the permission.
// /cli serves the CLI and its installer, which hold nothing secret.
const PUBLIC = ['/login', '/setup', '/api/auth/', '/api/health', '/s/', '/api/v1/shares/open', '/cli'];

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const method = event.request.method;
	const isApi = pathname.startsWith('/api/');
	const authorization = event.request.headers.get('authorization');

	// The browser extension calls from its own origin with a token; let it through CORS.
	if (isApi && method === 'OPTIONS') return cors(new Response(null, { status: 204 }), event.request);

	// JSON APIs must come from our own host when they ride on the session cookie. Browsers always
	// send Origin on cross-site and non-GET requests, so a mismatch means a forged request. Token
	// requests carry no cookie to abuse, so they may come from anywhere (CLI, extension).
	if (isApi && method !== 'GET' && !authorization) {
		const origin = event.request.headers.get('origin');
		if (origin) {
			const h = event.request.headers;
			const allowed = [event.url.host, h.get('host'), h.get('x-forwarded-host')].filter(Boolean);
			let host = '';
			try {
				host = new URL(origin).host;
			} catch {}
			if (!allowed.includes(host)) return json({ message: 'Cross-origin request blocked' }, { status: 403 });
		}
	}

	const visible = publicUrl(event.url, event.request.headers);
	event.locals.origin = visible.origin;
	event.locals.secure = visible.protocol === 'https:';
	try {
		event.locals.ip = event.getClientAddress();
	} catch {}

	const { state, user, via } = authenticate(event.cookies, authorization);
	event.locals.auth = state;
	event.locals.user = user;
	event.locals.via = via;

	if (!PUBLIC.some((p) => pathname.startsWith(p))) {
		if (state === 'setup') {
			if (isApi) return json({ message: 'Setup required' }, { status: 401 });
			redirect(303, '/setup');
		}
		if (state === 'anonymous') {
			if (isApi) return cors(json({ message: authorization ? 'That token is not valid (revoked or expired?)' : 'Not signed in' }, { status: 401 }), event.request);
			redirect(303, `/login?next=${encodeURIComponent(pathname + event.url.search)}`);
		}
		// API tokens are for the API, not for browsing the app as someone.
		if (via?.kind === 'token' && !pathname.startsWith('/api/v1/')) return json({ message: 'API tokens only work on /api/v1' }, { status: 403 });
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	// Secret values pass through these pages and responses: never cache them.
	if (isApi || pathname.startsWith('/s/') || pathname.startsWith('/p/')) response.headers.set('Cache-Control', 'no-store');
	return authorization || method === 'OPTIONS' ? cors(response, event.request) : response;
};

/**
 * CORS for token requests only: the extension (chrome-extension://…) sends a Bearer token,
 * never cookies, so allowing any origin here doesn't expose sessions.
 */
function cors(response: Response, request: Request): Response {
	const origin = request.headers.get('origin');
	if (!origin) return response;
	try {
		response.headers.set('Access-Control-Allow-Origin', origin);
		response.headers.set('Access-Control-Allow-Headers', 'authorization, content-type');
		response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
		response.headers.set('Access-Control-Max-Age', '600');
		response.headers.append('Vary', 'Origin');
	} catch {
		// Some responses (redirects) have immutable headers.
	}
	return response;
}
