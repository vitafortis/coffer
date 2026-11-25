<script lang="ts">
	import { goto } from '$app/navigation';
	import { Copy, Download, Fingerprint, Hash, Key, KeyRound, Link2, LoaderCircle, Save, ShieldCheck } from '@lucide/svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import Generator, { type GeneratedValue, type GeneratorKind } from '#lib/components/Generator.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { copyValue } from '#lib/client/secrets.ts';
	import { copyText } from '#lib/client/clipboard.ts';
	import { shareText, toast } from '#lib/client/state.svelte.ts';
	import { keyError, normalizePath } from '#lib/paths.ts';
	import type { Environment, Secret } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const KINDS: { value: GeneratorKind; label: string; icon: typeof Key; hint: string }[] = [
		{ value: 'password', label: 'Password', icon: KeyRound, hint: 'Random characters, made in your browser' },
		{ value: 'key', label: 'Key', icon: Key, hint: 'Random bytes for HMAC, AES or JWT secrets' },
		{ value: 'uuid', label: 'UUID', icon: Hash, hint: 'A random version 4 UUID' },
		{ value: 'keypair', label: 'Key pair', icon: Fingerprint, hint: 'Ed25519, ECDSA or RSA; SSH keys too' },
		{ value: 'certificate', label: 'Certificate', icon: ShieldCheck, hint: 'Self-signed, a CA, or issued by one of your CAs' }
	];

	let kind = $state<GeneratorKind>('password');
	let result = $state<GeneratedValue | null>(null);

	$effect(() => {
		void kind;
		result = null;
	});

	// ── Save to a project ──
	let saving = $state(false);
	let projectSlug = $state('');
	let envs = $state<Environment[]>([]);
	let envSlug = $state('');
	let folder = $state('/');
	let name = $state('');
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		if (!projectSlug) return;
		api.get<{ environments: Environment[] }>(`/api/v1/projects/${projectSlug}`).then((r) => {
			envs = r.environments;
			envSlug = r.environments[0]?.slug ?? '';
		});
	});

	function openSave() {
		projectSlug ||= data.projects[0]?.slug ?? '';
		name = '';
		error = '';
		saving = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		error = keyError(name.trim()) ?? '';
		if (error || !result) return;
		busy = true;
		try {
			const r = await api.post<{ secrets: Secret[] }>(`/api/v1/projects/${projectSlug}/secrets`, { env: envSlug, path: normalizePath(folder), key: name.trim(), type: result.type, value: result.value });
			saving = false;
			toast('success', `Saved ${name.trim()}`);
			goto(`/p/${projectSlug}?env=${envSlug}&path=${encodeURIComponent(normalizePath(folder))}&s=${r.secrets[0].id}`);
		} catch (err) {
			error = errorMessage(err);
		}
		busy = false;
	}

	function download() {
		if (!result) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([result.value], { type: 'application/x-pem-file' }));
		a.download = result.type === 'certificate' ? 'certificate.pem' : result.value.includes('OPENSSH') ? 'id_ed25519' : 'private-key.pem';
		a.click();
		URL.revokeObjectURL(a.href);
	}
</script>

<svelte:head><title>Generate · Coffer</title></svelte:head>

<PageHeader title="Generate" description="Make a password, key, key pair or certificate, then copy it, share it once, or save it to a project." />

<div class="grid gap-6 px-4 pb-10 sm:px-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
	<div class="space-y-3">
		<div class="grid grid-cols-5 gap-1 rounded-xl border border-border bg-surface p-1 lg:grid-cols-1">
			{#each KINDS as k (k.value)}
				<button
					class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] transition-colors max-lg:flex-col max-lg:gap-1 max-lg:text-xs {kind === k.value ? 'bg-card text-foreground shadow-surface' : 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (kind = k.value)}
				>
					<k.icon class="size-4 shrink-0 {kind === k.value ? 'text-primary' : ''}" />
					<span class="min-w-0">
						<span class="block font-medium">{k.label}</span>
						<span class="block truncate text-[0.6875rem] text-muted-foreground max-lg:hidden">{k.hint}</span>
					</span>
				</button>
			{/each}
		</div>
		{#key kind}
			<Generator {kind} ongenerate={(g) => (result = g)} />
		{/key}
	</div>

	<div class="card flex min-h-64 flex-col p-4">
		{#if result}
			{#if result.value.includes('\n')}
				<pre class="max-h-[55vh] flex-1 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[0.6875rem] break-all whitespace-pre-wrap select-all">{result.value}</pre>
			{:else}
				<div class="rounded-lg border border-border bg-surface px-4 py-4 font-mono text-base break-all select-all">{result.value}</div>
			{/if}
			{#if result.meta.publicKey}
				<p class="label mt-4 mb-1">Public key {result.meta.algorithm ? `· ${result.meta.algorithm}` : ''}</p>
				<div class="flex items-start gap-1">
					<pre class="max-h-40 flex-1 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[0.6875rem] break-all whitespace-pre-wrap select-all">{result.meta.publicKey}</pre>
					<button class="btn btn-ghost btn-icon btn-sm" title="Copy public key" onclick={() => copyText(result!.meta.publicKey!, 'Copied the public key')}><Copy /></button>
				</div>
			{/if}
			{#if result.meta.cert}
				<dl class="mt-4 grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 text-xs">
					<dt class="text-muted-foreground">Subject</dt><dd class="break-all">{result.meta.cert.subject}</dd>
					<dt class="text-muted-foreground">Issuer</dt><dd class="break-all">{result.meta.cert.selfSigned ? 'Self-signed' : result.meta.cert.issuer}</dd>
					{#if result.meta.cert.sans.length}<dt class="text-muted-foreground">Names</dt><dd class="font-mono break-all">{result.meta.cert.sans.join(', ')}</dd>{/if}
					<dt class="text-muted-foreground">Valid until</dt><dd>{new Date(result.meta.cert.validTo).toLocaleString()}</dd>
					<dt class="text-muted-foreground">SHA-256</dt><dd class="hash break-all">{result.meta.cert.fingerprint}</dd>
				</dl>
			{/if}
			<div class="mt-4 flex flex-wrap gap-2">
				<button class="btn btn-primary" onclick={() => copyValue(result!.value, 'the value')}><Copy />Copy</button>
				<button class="btn btn-secondary" onclick={openSave} disabled={!data.projects.length}><Save />Save to a project</button>
				<button class="btn btn-secondary" onclick={() => shareText(result!.value, KINDS.find((k) => k.value === kind)?.label)}><Link2 />One-time link</button>
				{#if result.value.includes('\n')}<button class="btn btn-ghost" onclick={download}><Download />Download</button>{/if}
			</div>
		{:else}
			<div class="grid flex-1 place-items-center text-center text-[0.8125rem] text-muted-foreground">
				{kind === 'keypair' || kind === 'certificate' ? 'Choose the options, then generate.' : 'Generating…'}
			</div>
		{/if}
	</div>
</div>

<Dialog bind:open={saving} title="Save to a project" width="max-w-md">
	<form id="save-form" class="space-y-3" onsubmit={save}>
		<div>
			<label class="label" for="g-name">Name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="g-name" class="input font-mono text-xs" bind:value={name} placeholder="SESSION_SECRET" autofocus required />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="label" for="g-project">Project</label>
				<select id="g-project" class="input" bind:value={projectSlug}>
					{#each data.projects as p (p.id)}<option value={p.slug}>{p.name}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="g-env">Environment</label>
				<select id="g-env" class="input" bind:value={envSlug}>
					{#each envs as e (e.id)}<option value={e.slug}>{e.name}</option>{/each}
				</select>
			</div>
		</div>
		<div>
			<label class="label" for="g-folder">Folder</label>
			<input id="g-folder" class="input font-mono text-xs" bind:value={folder} />
		</div>
		{#if error}<p class="text-xs text-danger">{error}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (saving = false)}>Cancel</button>
		<button class="btn btn-primary" form="save-form" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}Save</button>
	{/snippet}
</Dialog>
