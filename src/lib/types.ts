export type UserRole = 'admin' | 'member';

export type User = {
	id: string;
	email: string;
	name: string | null;
	role: UserRole;
	createdAt: string;
	lastLoginAt: string | null;
};

/** The signed-in person, as the browser sees them. */
export type Viewer = { id: string; email: string; name: string | null; admin: boolean };

/** Personal access tokens for the CLI and the browser extension. The token itself is shown once. */
export type ApiToken = {
	id: string;
	userId: string;
	name: string;
	/** The first characters of the token, so people can tell their tokens apart. */
	prefix: string;
	readOnly: boolean;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
};

export type Project = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ProjectSummary = Project & { environments: Environment[]; secretCount: number };

export type Environment = {
	id: string;
	projectId: string;
	slug: string;
	name: string;
	position: number;
};

/**
 * What a secret holds. The type only changes how it is shown, generated and checked:
 * every value is a string, encrypted the same way.
 */
export type SecretType = 'text' | 'password' | 'note' | 'key' | 'certificate' | 'keypair';

export const SECRET_TYPES: { value: SecretType; label: string; hint: string }[] = [
	{ value: 'text', label: 'Text', hint: 'A single-line value: a URL, a token, an ID' },
	{ value: 'password', label: 'Password', hint: 'Generated or typed; masked everywhere' },
	{ value: 'note', label: 'Note', hint: 'Multi-line text: a config file, recovery codes' },
	{ value: 'key', label: 'Key', hint: 'Random bytes as hex or base64: signing keys, JWT secrets' },
	{ value: 'certificate', label: 'Certificate', hint: 'A PEM certificate (chain) with its private key' },
	{ value: 'keypair', label: 'Key pair', hint: 'A PEM private key, with its public key shown alongside' }
];

/** Facts read from a certificate when it is saved, so lists can show expiry without decrypting. */
export type CertInfo = {
	subject: string;
	issuer: string;
	validFrom: string;
	validTo: string;
	sans: string[];
	fingerprint: string;
	selfSigned: boolean;
	/** A certificate authority; with `hasKey`, Coffer can issue certificates from it. */
	ca: boolean;
	hasKey: boolean;
};

export type SecretMeta = {
	cert?: CertInfo;
	/** Key pairs: the public half, which isn't secret. */
	publicKey?: string;
	algorithm?: string;
};

/** A secret without its value. */
export type Secret = {
	id: string;
	projectId: string;
	environmentId: string;
	/** Folder, "/" or "/db/replica". */
	path: string;
	key: string;
	type: SecretType;
	note: string | null;
	meta: SecretMeta;
	version: number;
	createdAt: string;
	updatedAt: string;
	updatedBy: string | null;
};

export type SecretVersion = {
	version: number;
	createdAt: string;
	createdBy: string | null;
};

/** A search hit for the extension and the command palette. */
export type SecretHit = Secret & { projectSlug: string; projectName: string; envSlug: string; envName: string };

export type ShareState = 'active' | 'opened' | 'expired' | 'revoked';

/** One-time links. The value is encrypted with a key that only the link holds. */
export type Share = {
	id: string;
	label: string | null;
	/** Where it came from, when it was shared from a stored secret. */
	source: string | null;
	createdBy: string | null;
	createdAt: string;
	expiresAt: string;
	maxViews: number;
	views: number;
	openedAt: string | null;
	revokedAt: string | null;
	state: ShareState;
};

export type Settings = {
	/** Where links point, e.g. https://coffer.example.com. Blank: the address the request came in on. */
	publicUrl: string;
	/** Default lifetime of a new one-time link, in hours. */
	shareHours: number;
};

export type Activity = {
	id: number;
	at: string;
	actor: string | null;
	action: string;
	target: string | null;
	detail: string | null;
};
