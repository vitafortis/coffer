import { json } from '@sveltejs/kit';
import { body, BadRequest, bool, handler, int, list, str } from '#lib/server/http.ts';
import { generateKeyPair, issueCertificate, KEY_ALGORITHMS, type KeyAlgorithm } from '#lib/server/pki.ts';
import { secretOr404 } from '#lib/server/secrets.ts';
import { readSecretValue } from '#lib/server/store.ts';
import { generateKey, generatePassword, generateUuid, type KeyEncoding } from '#lib/generate.ts';
import type { RequestHandler } from './$types';

/**
 * Makes a value without storing it: { kind: "password" | "key" | "uuid" | "keypair" | "certificate", … }.
 * Saving it is a separate step, so the same generator serves "fill this field" and "new secret".
 */
export const POST: RequestHandler = handler(async ({ request }) => {
	const b = await body(request);
	const kind = str(b, 'kind', { required: true });
	const algorithm = (str(b, 'algorithm') ?? 'ecdsa-p256') as KeyAlgorithm;
	if ((kind === 'keypair' || kind === 'certificate') && !KEY_ALGORITHMS.some((a) => a.value === algorithm)) throw new BadRequest(`Unknown algorithm "${algorithm}"`);
	switch (kind) {
		case 'password':
			return json({
				value: generatePassword({
					length: int(b, 'length', { min: 4, max: 512 }) ?? undefined,
					lower: bool(b, 'lower') ?? undefined,
					upper: bool(b, 'upper') ?? undefined,
					digits: bool(b, 'digits') ?? undefined,
					symbols: bool(b, 'symbols') ?? undefined,
					unambiguous: bool(b, 'unambiguous') ?? undefined
				}),
				type: 'password',
				meta: {}
			});
		case 'key': {
			const enc = (str(b, 'encoding') ?? 'base64') as KeyEncoding;
			if (!['hex', 'base64', 'base64url'].includes(enc)) throw new BadRequest('encoding is hex, base64 or base64url');
			return json({ value: generateKey(int(b, 'bytes', { min: 8, max: 512 }) ?? 32, enc), type: 'key', meta: {} });
		}
		case 'uuid':
			return json({ value: generateUuid(), type: 'text', meta: {} });
		case 'keypair':
			return json({ ...generateKeyPair(algorithm, { ssh: bool(b, 'ssh') ?? false, comment: str(b, 'comment', { max: 200 }) ?? '' }), type: 'keypair' });
		case 'certificate': {
			const issuerId = str(b, 'issuer');
			const issuer = issuerId ? readSecretValue(secretOr404(issuerId).id) : undefined;
			const out = issueCertificate({
				commonName: str(b, 'commonName', { required: true, max: 200 })!,
				organization: str(b, 'organization', { max: 200 }) ?? undefined,
				sans: list(b, 'sans'),
				days: int(b, 'days', { min: 1, max: 10950 }) ?? 365,
				algorithm,
				ca: bool(b, 'ca') ?? false,
				issuer
			});
			return json({ ...out, type: 'certificate' });
		}
		default:
			throw new BadRequest('kind is password, key, uuid, keypair or certificate');
	}
});
