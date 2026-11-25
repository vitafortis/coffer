<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Eye, EyeOff, LoaderCircle, Sparkles } from '@lucide/svelte';
	import Dialog from './Dialog.svelte';
	import Generator, { type GeneratedValue, type GeneratorKind } from './Generator.svelte';
	import TypeIcon from './TypeIcon.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { toast } from '#lib/client/state.svelte.ts';
	import { keyError, normalizePath, pathError } from '#lib/paths.ts';
	import { SECRET_TYPES, type Environment, type Secret, type SecretType } from '#lib/types.ts';

	/**
	 * New secret, or edit one. Editing leaves the value alone unless a new one is typed or
	 * generated, so opening the editor doesn't read (and log) the value.
	 */
	let {
		open = $bindable(false),
		projectSlug,
		environments,
		envId,
		path = '/',
		secret = null,
		prefill = null,
		onsaved
	}: {
		open: boolean;
		projectSlug: string;
		environments: Environment[];
		envId: string;
		path?: string;
		secret?: Secret | null;
		prefill?: (GeneratedValue & { key?: string }) | null;
		onsaved?: (s: Secret) => void;
	} = $props();

	let key = $state('');
	let type = $state<SecretType>('text');
	let value = $state('');
	let note = $state('');
	let folder = $state('/');
	let env = $state('');
	let alsoIn = $state<string[]>([]);
	let reveal = $state(false);
	let generating = $state(false);
	let busy = $state(false);
	let error = $state('');

	const editing = $derived(!!secret);
	const multiline = $derived(type === 'note' || type === 'certificate' || type === 'keypair');
	const genKind = $derived<GeneratorKind | null>(type === 'password' ? 'password' : type === 'key' ? 'key' : type === 'certificate' ? 'certificate' : type === 'keypair' ? 'keypair' : type === 'text' ? 'uuid' : null);

	$effect(() => {
		if (!open) return;
		key = secret?.key ?? prefill?.key ?? '';
		type = secret?.type ?? prefill?.type ?? 'text';
		value = prefill?.value ?? '';
		note = secret?.note ?? '';
		folder = secret?.path ?? path;
		env = secret?.environmentId ?? envId;
		alsoIn = [];
		reveal = false;
		generating = false;
		error = '';
	});

	function generated(g: GeneratedValue) {
		value = g.value;
		if (g.type !== 'text') type = g.type;
		if (g.type === 'certificate' || g.type === 'keypair') generating = false;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		error = keyError(key.trim()) ?? pathError(normalizePath(folder)) ?? '';
		if (!editing && !value) error ||= 'A value is required';
		if (error) return;
		busy = true;
		try {
			let saved: Secret;
			if (secret) {
				saved = (
					await api.patch<{ secret: Secret }>(`/api/v1/secrets/${secret.id}`, {
						key: key.trim(),
						path: normalizePath(folder),
						type,
						note,
						...(value ? { value } : {})
					})
				).secret;
				toast('success', `Saved ${saved.key}`, value ? `Now version ${saved.version}.` : undefined);
			} else {
				const envSlug = environments.find((x) => x.id === env)!.slug;
				const res = await api.post<{ secrets: Secret[] }>(`/api/v1/projects/${projectSlug}/secrets`, {
					env: envSlug,
					path: normalizePath(folder),
					key: key.trim(),
					type,
					value,
					note: note || undefined,
					alsoIn: alsoIn.map((id) => environments.find((x) => x.id === id)!.slug)
				});
				saved = res.secrets[0];
				toast('success', `Added ${saved.key}`, res.secrets.length > 1 ? `In ${res.secrets.length} environments.` : undefined);
			}
			open = false;
			await invalidateAll();
			onsaved?.(saved);
		} catch (err) {
			error = errorMessage(err);
		}
		busy = false;
	}

	const placeholder = $derived(
		{
			text: 'https://…, an API token, an ID',
			password: '',
			note: 'Anything, over several lines',
			key: '',
			certificate: '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\n…',
			keypair: '-----BEGIN PRIVATE KEY-----\n…'
		}[type]
	);
</script>

<Dialog bind:open title={editing ? `Edit ${secret?.key}` : 'New secret'} width="max-w-2xl">
	<form id="secret-form" class="space-y-4" onsubmit={save} autocomplete="off">
		<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 max-sm:grid-cols-1">
			<div>
				<label class="label" for="s-key">Name</label>
				<!-- svelte-ignore a11y_autofocus -->
				<input id="s-key" class="input font-mono text-xs" bind:value={key} autofocus={!editing} placeholder="DATABASE_URL" spellcheck="false" maxlength="128" required />
			</div>
			<div>
				<span class="label">Type</span>
				<div class="flex h-9 items-center gap-0.5 rounded-lg border border-input bg-background p-0.5" role="radiogroup" aria-label="Type">
					{#each SECRET_TYPES as t (t.value)}
						<button
							type="button"
							role="radio"
							aria-checked={type === t.value}
							title="{t.label}: {t.hint}"
							class="grid h-full w-8 place-items-center rounded-md transition-colors {type === t.value ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:text-foreground'}"
							onclick={() => {
								type = t.value;
								generating = false;
							}}><TypeIcon type={t.value} class="size-3.5" /></button
						>
					{/each}
				</div>
			</div>
		</div>

		<div>
			<div class="mb-1.5 flex items-center justify-between gap-2">
				<label class="text-xs font-medium text-muted-foreground" for="s-value">
					{SECRET_TYPES.find((t) => t.value === type)?.label} value
					{#if editing}<span class="font-normal">— leave empty to keep the current one</span>{/if}
				</label>
				{#if genKind}
					<button type="button" class="btn btn-ghost btn-sm -my-1 text-primary" onclick={() => (generating = !generating)}>
						<Sparkles />{generating ? 'Hide generator' : genKind === 'uuid' ? 'UUID' : 'Generate'}
					</button>
				{/if}
			</div>
			{#if multiline}
				<textarea id="s-value" class="input h-40 resize-y py-2 font-mono text-xs" bind:value {placeholder} spellcheck="false" autocomplete="off"></textarea>
			{:else}
				<div class="relative">
					<input
						id="s-value"
						class="input pr-10 font-mono text-xs"
						type={type === 'password' && !reveal ? 'password' : 'text'}
						bind:value
						{placeholder}
						spellcheck="false"
						autocomplete="new-password"
						data-1p-ignore
						data-lpignore="true"
					/>
					<button type="button" class="btn btn-ghost btn-icon btn-sm absolute top-1 right-1" title={reveal ? 'Hide' : 'Show'} onclick={() => (reveal = !reveal)}>
						{#if reveal}<EyeOff />{:else}<Eye />{/if}
					</button>
				</div>
			{/if}
			{#if generating && genKind}
				<div class="mt-2"><Generator kind={genKind} ongenerate={generated} /></div>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
			<div>
				<label class="label" for="s-env">Environment</label>
				<select id="s-env" class="input" bind:value={env} disabled={editing}>
					{#each environments as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="s-folder">Folder</label>
				<input id="s-folder" class="input font-mono text-xs" bind:value={folder} placeholder="/" spellcheck="false" />
			</div>
		</div>

		{#if !editing && environments.length > 1}
			<div>
				<span class="label">Also add to</span>
				<div class="flex flex-wrap gap-1.5">
					{#each environments.filter((e) => e.id !== env) as e (e.id)}
						<label class="badge h-7 cursor-pointer gap-1.5 px-2.5 text-xs {alsoIn.includes(e.id) ? 'badge-primary' : ''}">
							<input type="checkbox" class="sr-only" value={e.id} bind:group={alsoIn} />{e.name}
						</label>
					{/each}
				</div>
			</div>
		{/if}

		<div>
			<label class="label" for="s-note">Note</label>
			<input id="s-note" class="input" bind:value={note} maxlength="2000" placeholder="What it's for, who owns it, when to rotate" />
		</div>
		{#if error}<p class="text-xs text-danger">{error}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (open = false)}>Cancel</button>
		<button class="btn btn-primary" form="secret-form" disabled={busy}>
			{#if busy}<LoaderCircle class="animate-spin" />{/if}{editing ? 'Save' : 'Add secret'}
		</button>
	{/snippet}
</Dialog>
