import { resolve } from 'node:path';

const env = (name: string): string | undefined => process.env[`COFFER_${name}`];

const adminEmail = env('ADMIN_EMAIL');
const adminPassword = env('ADMIN_PASSWORD');

export const config = {
	dataDir: resolve(env('DATA_DIR') ?? './data'),
	/** Optional master secret. When unset, a random key is generated in the data dir. */
	secretKey: env('SECRET_KEY'),
	/** Creates the first account on start (skips the setup wizard). */
	bootstrapAdmin:
		adminEmail && adminPassword
			? { email: adminEmail.trim(), password: adminPassword, name: env('ADMIN_NAME')?.trim() || null }
			: undefined
};
