// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** The release version, e.g. 0.1.42 (set at build time). */
	const __APP_VERSION__: string;
	namespace App {
		interface Error {
			message: string;
		}
		interface Locals {
			auth: import('#lib/server/auth.ts').AuthState;
			user: import('#lib/types.ts').User | null;
			/** A browser session or an API token; null when not signed in. */
			via: import('#lib/server/auth.ts').AuthVia | null;
			/** Origin the browser used (see origin.ts); use instead of url.origin. */
			origin: string;
			/** Whether the browser connection is https, for Secure cookies. */
			secure: boolean;
			/** Client address, for throttles. */
			ip?: string;
		}
	}
}

export {};
