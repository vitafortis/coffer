<script lang="ts" module>
	export type GeneratedValue = { value: string; type: import('#lib/types.ts').SecretType; meta: import('#lib/types.ts').SecretMeta };
	export type GeneratorKind = 'password' | 'key' | 'uuid' | 'keypair' | 'certificate';
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { LoaderCircle, RefreshCw, Sparkles } from '@lucide/svelte';
	import Switch from './Switch.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { DEFAULT_PASSWORD, generateKey, generatePassword, generateUuid, passwordBits, type KeyEncoding } from '#lib/generate.ts';

	/**
	 * Every generator in one place. Passwords, keys and UUIDs are made in the browser as the
	 * options change; key pairs and certificates on the server, when asked.
	 */
	let { kind, ongenerate }: { kind: GeneratorKind; ongenerate: (g: GeneratedValue) => void } = $props();

	const PREFS = 'coffer-generator';
	let pw = $state({ ...DEFAULT_PASSWORD });
	let keyBytes = $state(32);
	let keyEncoding = $state<KeyEncoding>('base64');

	let algorithm = $state('ecdsa-p256');
	let ssh = $state(true);
	let comment = $state('');
	let commonName = $state('');
	let sans = $state('');
	let organization = $state('');
	let days = $state(365);
	let ca = $state(false);
	let issuer = $state('');
	let cas = $state<{ id: string; ref: string; subject: string }[]>([]);
	let busy = $state(false);
	let error = $state('');

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(PREFS) ?? '{}');
			if (saved.pw) pw = { ...pw, ...saved.pw };
			if (saved.keyBytes) keyBytes = saved.keyBytes;
			if (saved.keyEncoding) keyEncoding = saved.keyEncoding;
		} catch {}
	});

	// Local kinds regenerate whenever an option changes, and remember the options.
	$effect(() => {
		if (kind !== 'password' && kind !== 'key' && kind !== 'uuid') return;
		const opts = { ...pw };
		try {
			localStorage.setItem(PREFS, JSON.stringify({ pw: opts, keyBytes, keyEncoding }));
		} catch {}
		regenerate();
	});

	$effect(() => {
		if (kind === 'keypair' && algorithm !== 'ed25519' && !algorithm.startsWith('rsa')) ssh = false;
	});

	$effect(() => {
		if (kind !== 'certificate') return;
		api.get<{ cas: typeof cas }>('/api/v1/cas').then((r) => (cas = r.cas)).catch(() => {});
	});

	function regenerate() {
		error = '';
		try {
			if (kind === 'password') ongenerate({ value: generatePassword(pw), type: 'password', meta: {} });
			else if (kind === 'key') ongenerate({ value: generateKey(keyBytes, keyEncoding), type: 'key', meta: {} });
			else if (kind === 'uuid') ongenerate({ value: generateUuid(), type: 'text', meta: {} });
		} catch (err) {
			error = errorMessage(err);
		}
	}

	async function serverGenerate() {
		busy = true;
		error = '';
		try {
			const body =
				kind === 'keypair'
					? { kind, algorithm, ssh: ssh && algorithm === 'ed25519', comment }
					: { kind, algorithm, commonName, organization, sans, days, ca, issuer: issuer || undefined };
			ongenerate(await api.post<GeneratedValue>('/api/v1/generate', body));
		} catch (err) {
			error = errorMessage(err);
		}
		busy = false;
	}

	const ALGORITHMS = [
		{ value: 'ecdsa-p256', label: 'ECDSA P-256' },
		{ value: 'ecdsa-p384', label: 'ECDSA P-384' },
		{ value: 'ed25519', label: 'Ed25519' },
		{ value: 'rsa-2048', label: 'RSA 2048' },
		{ value: 'rsa-3072', label: 'RSA 3072' },
		{ value: 'rsa-4096', label: 'RSA 4096' }
	];
</script>

<div class="space-y-3 rounded-xl border border-border bg-surface p-3.5 text-[0.8125rem]">
	{#if kind === 'password'}
		<div>
			<div class="mb-1.5 flex items-center justify-between">
				<label class="text-xs font-medium text-muted-foreground" for="gen-length">Length</label>
				<span class="font-mono text-xs tabular-nums">{pw.length} <span class="text-muted-foreground">· ~{passwordBits(pw)} bits</span></span>
			</div>
			<input id="gen-length" type="range" min="8" max="128" bind:value={pw.length} class="w-full accent-[var(--primary)]" />
		</div>
		<div class="grid grid-cols-2 gap-x-4 gap-y-2">
			{#each [['lower', 'a–z'], ['upper', 'A–Z'], ['digits', '0–9'], ['symbols', '!#$%…']] as [k, l] (k)}
				<label class="flex items-center justify-between gap-2">
					<span>{l}</span>
					<Switch bind:checked={pw[k as 'lower']} label={l} />
				</label>
			{/each}
			<label class="col-span-2 flex items-center justify-between gap-2">
				<span>Avoid look-alikes <span class="text-xs text-muted-foreground">(0 O 1 l I)</span></span>
				<Switch bind:checked={pw.unambiguous} label="Avoid look-alikes" />
			</label>
		</div>
		<button type="button" class="btn btn-secondary btn-sm" onclick={regenerate}><RefreshCw />Regenerate</button>
	{:else if kind === 'key'}
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="label" for="gen-bytes">Size</label>
				<select id="gen-bytes" class="input" bind:value={keyBytes}>
					{#each [16, 24, 32, 48, 64] as n (n)}<option value={n}>{n} bytes ({n * 8} bits)</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="gen-enc">Encoding</label>
				<select id="gen-enc" class="input" bind:value={keyEncoding}>
					<option value="base64">Base64</option>
					<option value="base64url">Base64 (URL-safe)</option>
					<option value="hex">Hex</option>
				</select>
			</div>
		</div>
		<button type="button" class="btn btn-secondary btn-sm" onclick={regenerate}><RefreshCw />Regenerate</button>
	{:else if kind === 'uuid'}
		<button type="button" class="btn btn-secondary btn-sm" onclick={regenerate}><RefreshCw />New UUID</button>
	{:else if kind === 'keypair'}
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="label" for="gen-alg">Algorithm</label>
				<select id="gen-alg" class="input" bind:value={algorithm}>
					{#each ALGORITHMS as a (a.value)}<option value={a.value}>{a.label}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="gen-comment">Comment</label>
				<input id="gen-comment" class="input" bind:value={comment} placeholder="deploy@ci" />
			</div>
		</div>
		{#if algorithm === 'ed25519' || algorithm.startsWith('rsa')}
			<label class="flex items-center justify-between gap-2">
				<span>For SSH <span class="text-xs text-muted-foreground">({algorithm === 'ed25519' ? 'OpenSSH private key, ' : ''}authorized_keys line)</span></span>
				<Switch bind:checked={ssh} label="For SSH" />
			</label>
		{/if}
		<button type="button" class="btn btn-primary btn-sm" disabled={busy} onclick={serverGenerate}>
			{#if busy}<LoaderCircle class="animate-spin" />{:else}<Sparkles />{/if}Generate key pair
		</button>
	{:else if kind === 'certificate'}
		<div class="grid grid-cols-2 gap-3">
			<div class="col-span-2">
				<label class="label" for="gen-cn">Common name</label>
				<input id="gen-cn" class="input" bind:value={commonName} placeholder={ca ? 'Internal Root CA' : 'api.internal'} required />
			</div>
			{#if !ca}
				<div class="col-span-2">
					<label class="label" for="gen-sans">Other names <span class="font-normal">(host names and IPs, comma-separated)</span></label>
					<input id="gen-sans" class="input font-mono text-xs" bind:value={sans} placeholder="*.api.internal, 10.0.0.12" />
				</div>
			{/if}
			<div>
				<label class="label" for="gen-org">Organization</label>
				<input id="gen-org" class="input" bind:value={organization} placeholder="Optional" />
			</div>
			<div>
				<label class="label" for="gen-days">Valid for (days)</label>
				<input id="gen-days" class="input" type="number" min="1" max="10950" bind:value={days} />
			</div>
			<div>
				<label class="label" for="gen-calg">Key</label>
				<select id="gen-calg" class="input" bind:value={algorithm}>
					{#each ALGORITHMS as a (a.value)}<option value={a.value}>{a.label}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="gen-issuer">Signed by</label>
				<select id="gen-issuer" class="input" bind:value={issuer}>
					<option value="">Itself (self-signed)</option>
					{#each cas as c (c.id)}<option value={c.id}>{c.ref}</option>{/each}
				</select>
			</div>
		</div>
		<label class="flex items-center justify-between gap-2">
			<span>Certificate authority <span class="text-xs text-muted-foreground">(signs other certificates)</span></span>
			<Switch bind:checked={ca} label="Certificate authority" />
		</label>
		<button type="button" class="btn btn-primary btn-sm" disabled={busy || !commonName.trim()} onclick={serverGenerate}>
			{#if busy}<LoaderCircle class="animate-spin" />{:else}<Sparkles />{/if}Generate certificate
		</button>
	{/if}
	{#if error}<p class="text-xs text-danger">{error}</p>{/if}
</div>
