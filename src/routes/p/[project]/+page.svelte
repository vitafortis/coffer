<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Check,
		ChevronRight,
		Copy,
		Ellipsis,
		Eye,
		EyeOff,
		Folder,
		FolderPlus,
		History,
		Layers,
		Link2,
		Pencil,
		Plus,
		Settings2,
		Terminal,
		Trash2,
		X
	} from '@lucide/svelte';
	import CertBadge from '#lib/components/CertBadge.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import HistoryDialog from '#lib/components/HistoryDialog.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import ProjectDialog from '#lib/components/ProjectDialog.svelte';
	import SecretDialog from '#lib/components/SecretDialog.svelte';
	import TypeIcon from '#lib/components/TypeIcon.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { copyText } from '#lib/client/clipboard.ts';
	import { copySecret, copyValue, readValue } from '#lib/client/secrets.ts';
	import { confirmAction, shareSecret, toast } from '#lib/client/state.svelte.ts';
	import { ago, dateTime, plural } from '#lib/client/format.ts';
	import { childFolders, joinPath, secretRef, SLUG_RE, slugify } from '#lib/paths.ts';
	import type { Environment, Secret } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const project = $derived(data.project);
	const crumbs = $derived(data.path === '/' ? [] : data.path.slice(1).split('/'));
	const subfolders = $derived(childFolders(data.folders, data.path));
	const envSlug = $derived(data.env?.slug ?? 'all');

	let editorOpen = $state(false);
	let editing = $state<Secret | null>(null);
	let history = $state<Secret | null>(null);
	let projectOpen = $state(false);
	let envsOpen = $state(false);
	let revealed = $state<Record<string, string>>({});
	let filter = $state('');

	// The highlighted secret (from search), scrolled into view once.
	const focusId = $derived(page.url.searchParams.get('s'));
	$effect(() => {
		if (focusId) queueMicrotask(() => document.getElementById(`secret-${focusId}`)?.scrollIntoView({ block: 'center' }));
	});

	// Hide revealed values when leaving the folder or environment.
	$effect(() => {
		void data.env?.id;
		void data.path;
		revealed = {};
	});

	function href(env: string, path: string) {
		const q = new URLSearchParams({ env });
		if (path !== '/') q.set('path', path);
		return `/p/${project.slug}?${q}`;
	}

	const visible = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return q ? data.secrets.filter((s) => `${s.key} ${s.note ?? ''} ${s.url ?? ''}`.toLowerCase().includes(q)) : data.secrets;
	});

	async function toggleReveal(s: Secret) {
		if (revealed[s.id] !== undefined) {
			delete revealed[s.id];
			return;
		}
		try {
			revealed[s.id] = await readValue(s.id);
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	async function remove(s: Secret) {
		const ok = await confirmAction({
			title: `Delete ${s.key}?`,
			body: `It and its history are deleted from ${data.env?.name ?? 'this environment'}. This can't be undone.`,
			detail: secretRef(project.slug, envSlug, s.path, s.key),
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		try {
			await api.del(`/api/v1/secrets/${s.id}`);
			toast('success', `Deleted ${s.key}`);
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	async function newFolder() {
		const name = prompt('Folder name (letters, digits, _ . -)');
		if (!name?.trim()) return;
		const clean = name.trim().replace(/^\/+|\/+$/g, '');
		goto(href(envSlug === 'all' ? data.environments[0].slug : envSlug, joinPath(data.path, clean)));
	}

	async function deleteFolder() {
		const ok = await confirmAction({
			title: `Delete the folder ${data.path}?`,
			body: `Every secret in it and in its subfolders is deleted from ${data.env!.name}. This can't be undone.`,
			confirmLabel: 'Delete folder',
			danger: true
		});
		if (!ok) return;
		try {
			const r = await api.del<{ deleted: number }>(`/api/v1/projects/${project.slug}/folders?env=${data.env!.slug}&path=${encodeURIComponent(data.path)}`);
			toast('success', `Deleted ${plural(r.deleted, 'secret')}`);
			goto(href(data.env!.slug, data.path.split('/').slice(0, -1).join('/') || '/'));
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	async function deleteProject() {
		const ok = await confirmAction({
			title: `Delete ${project.name}?`,
			body: `Every secret in every environment of ${project.name} is deleted. One-time links already made keep working until they're used or expire. This can't be undone.`,
			detail: project.slug,
			confirmLabel: 'Delete project',
			danger: true
		});
		if (!ok) return;
		try {
			await api.del(`/api/v1/projects/${project.id}`);
			toast('success', `Deleted ${project.name}`);
			await invalidateAll();
			goto('/');
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	function rowMenu(s: Secret) {
		return [
			{ label: 'Edit', icon: Pencil, onclick: () => ((editing = s), (editorOpen = true)) },
			{ label: 'Share with a one-time link', icon: Link2, onclick: () => shareSecret(s.id, s.key) },
			{ label: 'History', hint: `Version ${s.version}`, icon: History, onclick: () => (history = s) },
			{ label: 'Copy CLI command', hint: 'coffer get …', icon: Terminal, onclick: () => copyText(cliGet(s), 'Copied the command') },
			...(s.meta.publicKey ? [{ label: 'Copy public key', icon: Copy, onclick: () => copyText(s.meta.publicKey!, 'Copied the public key') }] : []),
			'separator' as const,
			{ label: 'Delete', icon: Trash2, danger: true, onclick: () => remove(s) }
		];
	}

	const cliGet = (s: Secret) => `coffer get ${s.key} -p ${project.slug} -e ${envSlug}${s.path === '/' ? '' : ` --path ${s.path}`}`;

	// ── Overview: each name in this folder, across environments ──
	const overviewRows = $derived.by(() => {
		if (!data.overview) return [];
		const byKey = new Map<string, Map<string, Secret>>();
		for (const s of data.secrets) {
			if (!byKey.has(s.key)) byKey.set(s.key, new Map());
			byKey.get(s.key)!.set(s.environmentId, s);
		}
		return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b));
	});

	// ── Environments ──
	let newEnv = $state('');
	let envError = $state('');
	async function addEnv(e: SubmitEvent) {
		e.preventDefault();
		envError = '';
		try {
			await api.post(`/api/v1/projects/${project.slug}/environments`, { name: newEnv.trim() });
			newEnv = '';
			invalidateAll();
		} catch (err) {
			envError = errorMessage(err);
		}
	}
	async function renameEnv(env: Environment) {
		const name = prompt(`Rename ${env.name} to`, env.name);
		if (!name?.trim() || name.trim() === env.name) return;
		const slug = prompt('Short name, used by the CLI (-e)', SLUG_RE.test(slugify(name)) ? slugify(name) : env.slug);
		if (!slug) return;
		try {
			await api.patch(`/api/v1/projects/${project.slug}/environments/${env.id}`, { name: name.trim(), slug: slug.trim() });
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}
	async function deleteEnv(env: Environment) {
		const ok = await confirmAction({ title: `Delete ${env.name}?`, body: `Every secret in ${env.name} is deleted. This can't be undone.`, confirmLabel: 'Delete environment', danger: true });
		if (!ok) return;
		try {
			await api.del(`/api/v1/projects/${project.slug}/environments/${env.id}`);
			if (data.env?.id === env.id) goto(`/p/${project.slug}`);
			else invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	async function copyFromEnv(s: Secret, to: Environment) {
		try {
			const value = await readValue(s.id);
			await api.post(`/api/v1/projects/${project.slug}/secrets`, { env: to.slug, path: s.path, key: s.key, type: s.type, note: s.note ?? undefined, url: s.url ?? undefined, value });
			toast('success', `Copied ${s.key} to ${to.name}`);
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}
</script>

<svelte:head><title>{project.name} · Coffer</title></svelte:head>

<div class="relative">
	<div class="glow-top pointer-events-none absolute inset-x-0 -top-10 h-64"></div>
	<header class="relative flex flex-wrap items-end justify-between gap-4 px-4 pt-5 pb-3 sm:px-8 sm:pt-6">
		<div class="min-w-0">
			<p class="hash text-muted-foreground">{project.slug}</p>
			<h1 class="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
			{#if project.description}<p class="mt-1 text-sm text-muted-foreground">{project.description}</p>{/if}
		</div>
		<div class="flex items-center gap-2">
			<Menu
				items={[
					{ label: 'Project settings', hint: 'Name, short name, description', icon: Settings2, onclick: () => (projectOpen = true) },
					{ label: 'Environments', hint: 'Add, rename, remove', icon: Layers, onclick: () => (envsOpen = true) },
					'separator',
					{ label: 'Delete project', icon: Trash2, danger: true, onclick: deleteProject }
				]}
			>
				{#snippet trigger({ toggle })}<button class="btn btn-secondary btn-icon" title="Project" onclick={toggle}><Ellipsis /></button>{/snippet}
			</Menu>
			<button class="btn btn-primary" onclick={() => ((editing = null), (editorOpen = true))}><Plus />New secret</button>
		</div>
	</header>

	<!-- Environments -->
	<div class="relative flex items-center gap-1 overflow-x-auto border-b border-border px-4 sm:px-8">
		{#each data.environments as e (e.id)}
			{@const active = data.env?.id === e.id}
			<a href={href(e.slug, data.path)} class="relative shrink-0 px-3 py-2.5 text-[0.8125rem] font-medium transition-colors {active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}">
				{e.name}
				<span class="ml-1 hash text-muted-foreground/70">{e.slug}</span>
				{#if active}<span class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"></span>{/if}
			</a>
		{/each}
		{#if data.environments.length > 1}
			<a href={href('all', data.path)} class="relative ml-auto flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-[0.8125rem] font-medium transition-colors {data.overview ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}">
				<Layers class="size-3.5" />Compare
				{#if data.overview}<span class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"></span>{/if}
			</a>
		{/if}
	</div>
</div>

<div class="px-4 py-4 sm:px-8">
	<!-- Folder path -->
	<div class="mb-3 flex flex-wrap items-center gap-2">
		<nav class="flex min-w-0 flex-wrap items-center gap-0.5 font-mono text-xs" aria-label="Folder">
			<a href={href(envSlug, '/')} class="rounded px-1.5 py-1 hover:bg-accent {crumbs.length ? 'text-muted-foreground' : 'text-foreground'}">/</a>
			{#each crumbs as c, i (i)}
				<ChevronRight class="size-3 text-muted-foreground/60" />
				<a href={href(envSlug, '/' + crumbs.slice(0, i + 1).join('/'))} class="rounded px-1.5 py-1 hover:bg-accent {i === crumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground'}">{c}</a>
			{/each}
		</nav>
		<div class="ml-auto flex items-center gap-2">
			{#if !data.overview}
				<input class="input h-8 w-48 text-xs max-sm:w-36" placeholder="Filter this folder" bind:value={filter} />
			{/if}
			<button class="btn btn-secondary btn-sm" onclick={newFolder}><FolderPlus />Folder</button>
			{#if data.path !== '/' && data.env}
				<button class="btn btn-ghost btn-icon btn-sm" title="Delete this folder" onclick={deleteFolder}><Trash2 /></button>
			{/if}
		</div>
	</div>

	<div class="card overflow-hidden">
		{#if subfolders.length}
			<ul class="divide-y divide-border border-b border-border">
				{#each subfolders as f (f)}
					<li>
						<a href={href(envSlug, joinPath(data.path, f))} class="flex items-center gap-3 px-4 py-2.5 text-[0.8125rem] hover:bg-accent/50">
							<Folder class="size-4 text-primary" />
							<span class="font-mono text-xs font-medium">{f}/</span>
							<ChevronRight class="ml-auto size-3.5 text-muted-foreground" />
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.overview}
			{#if overviewRows.length}
				<div class="overflow-x-auto">
					<table class="w-full text-[0.8125rem]">
						<thead>
							<tr class="border-b border-border text-left text-xs text-muted-foreground">
								<th class="px-4 py-2 font-medium">Name</th>
								{#each data.environments as e (e.id)}<th class="px-3 py-2 text-center font-medium">{e.name}</th>{/each}
							</tr>
						</thead>
						<tbody class="divide-y divide-border">
							{#each overviewRows as [key, byEnv] (key)}
								{@const any = [...byEnv.values()][0]}
								<tr class="hover:bg-accent/30">
									<td class="px-4 py-2"><span class="flex items-center gap-2"><TypeIcon type={any.type} class="size-3.5 shrink-0 text-muted-foreground" /><span class="font-mono text-xs font-medium">{key}</span></span></td>
									{#each data.environments as e (e.id)}
										{@const s = byEnv.get(e.id)}
										<td class="px-3 py-2 text-center">
											{#if s}
												<a href="{href(e.slug, data.path)}&s={s.id}" class="inline-flex items-center gap-1 text-xs text-success" title="v{s.version}, updated {ago(s.updatedAt)}"><Check class="size-3.5" />v{s.version}</a>
											{:else}
												<Menu items={[...byEnv.entries()].map(([envId, src]) => ({ label: `Copy from ${data.environments.find((x) => x.id === envId)?.name}`, icon: Copy, onclick: () => copyFromEnv(src, e) }))} align="right">
													{#snippet trigger({ toggle })}
														<button class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-warning hover:bg-warning/10" title="Missing in {e.name}" onclick={toggle}><X class="size-3.5" />missing</button>
													{/snippet}
												</Menu>
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if !subfolders.length}
				<EmptyState icon={Layers} title="Nothing in this folder yet" body="Secrets added to any environment show up here side by side, so missing ones stand out." />
			{/if}
		{:else if visible.length}
			<ul class="divide-y divide-border">
				{#each visible as s (s.id)}
					{@const shown = revealed[s.id]}
					{@const multiline = s.type === 'note' || s.type === 'certificate' || s.type === 'keypair'}
					<li id="secret-{s.id}" class="group px-4 py-2.5 transition-colors {focusId === s.id ? 'bg-primary-soft' : 'hover:bg-accent/30'}">
						<div class="flex items-center gap-3">
							<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" title={s.type}><TypeIcon type={s.type} class="size-3.5" /></span>
							<div class="w-[clamp(8rem,28%,18rem)] min-w-0 shrink-0">
								<button class="block max-w-full truncate text-left font-mono text-xs font-medium hover:text-primary" title="Copy {s.key}" onclick={() => copySecret(s.id, s.key)}>{s.key}</button>
								<p class="truncate text-[0.6875rem] text-muted-foreground" title={dateTime(s.updatedAt)}>v{s.version} · {ago(s.updatedAt)}{s.updatedBy ? ` · ${s.updatedBy}` : ''}</p>
							</div>
							<div class="min-w-0 flex-1">
								{#if shown !== undefined && !multiline}
									<span class="block truncate font-mono text-xs select-all">{shown}</span>
								{:else if s.type === 'certificate' && s.meta.cert}
									<span class="flex min-w-0 items-center gap-1.5">
										<span class="truncate text-xs" title={s.meta.cert.subject}>{s.meta.cert.subject.replace(/^.*CN=/, '')}</span>
										<CertBadge cert={s.meta.cert} />
									</span>
								{:else if s.type === 'keypair'}
									<span class="truncate text-xs text-muted-foreground">{s.meta.algorithm ?? 'Private key'}</span>
								{:else}
									<span class="masked font-mono text-xs">••••••••••••</span>
								{/if}
								{#if s.url || s.note}
									<p class="truncate text-[0.6875rem] text-muted-foreground">
										{#if s.url}<a href={s.url} target="_blank" rel="noopener noreferrer" class="hover:text-primary hover:underline">{s.url.replace(/^https?:\/\/(www\.)?/, '')}</a>{/if}{s.url && s.note ? ' · ' : ''}{s.note ?? ''}
									</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
								<button class="btn btn-ghost btn-icon btn-sm" title={shown !== undefined ? 'Hide' : 'Show'} onclick={() => toggleReveal(s)}>
									{#if shown !== undefined}<EyeOff />{:else}<Eye />{/if}
								</button>
								<button class="btn btn-ghost btn-icon btn-sm" title="Copy value" onclick={() => (shown !== undefined ? copyValue(shown, s.key) : copySecret(s.id, s.key))}><Copy /></button>
								<button class="btn btn-ghost btn-icon btn-sm max-sm:hidden" title="Share with a one-time link" onclick={() => shareSecret(s.id, s.key)}><Link2 /></button>
								<Menu items={rowMenu(s)}>
									{#snippet trigger({ toggle })}<button class="btn btn-ghost btn-icon btn-sm" title="More" onclick={toggle}><Ellipsis /></button>{/snippet}
								</Menu>
							</div>
						</div>
						{#if shown !== undefined && multiline}
							<pre class="mt-2 ml-10 max-h-72 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[0.6875rem] break-all whitespace-pre-wrap select-all">{shown}</pre>
						{/if}
						{#if shown !== undefined && s.meta.publicKey}
							<div class="mt-2 ml-10">
								<p class="label mb-1">Public key</p>
								<pre class="max-h-40 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[0.6875rem] break-all whitespace-pre-wrap select-all">{s.meta.publicKey}</pre>
							</div>
						{/if}
						{#if shown !== undefined && s.meta.cert}
							<dl class="mt-2 ml-10 grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 text-xs">
								<dt class="text-muted-foreground">Subject</dt><dd class="break-all">{s.meta.cert.subject}</dd>
								<dt class="text-muted-foreground">Issuer</dt><dd class="break-all">{s.meta.cert.selfSigned ? 'Self-signed' : s.meta.cert.issuer}</dd>
								{#if s.meta.cert.sans.length}<dt class="text-muted-foreground">Names</dt><dd class="font-mono break-all">{s.meta.cert.sans.join(', ')}</dd>{/if}
								<dt class="text-muted-foreground">Valid</dt><dd>{dateTime(s.meta.cert.validFrom)} – {dateTime(s.meta.cert.validTo)}</dd>
								<dt class="text-muted-foreground">Key</dt><dd>{s.meta.algorithm}{s.meta.cert.hasKey ? ', private key included' : ', no private key stored'}</dd>
								<dt class="text-muted-foreground">SHA-256</dt><dd class="hash break-all">{s.meta.cert.fingerprint}</dd>
							</dl>
						{/if}
					</li>
				{/each}
			</ul>
		{:else if !subfolders.length || filter}
			<EmptyState
				icon={Layers}
				title={filter ? `Nothing matches “${filter}”` : `No secrets in ${data.path === '/' ? data.env?.name : data.path} yet`}
				body={filter ? undefined : 'Add a password, API key, note, key pair or certificate. Values are encrypted before they are stored.'}
			>
				{#snippet action()}
					{#if !filter}<button class="btn btn-primary btn-sm" onclick={() => ((editing = null), (editorOpen = true))}><Plus />New secret</button>{/if}
				{/snippet}
			</EmptyState>
		{/if}
	</div>
</div>

<SecretDialog
	bind:open={editorOpen}
	projectSlug={project.slug}
	environments={data.environments}
	envId={data.env?.id ?? data.environments[0].id}
	path={data.path}
	secret={editing}
	onsaved={(s) => {
		const env = data.environments.find((e) => e.id === s.environmentId);
		if (env && (env.id !== data.env?.id || s.path !== data.path)) goto(`${href(env.slug, s.path)}&s=${s.id}`);
	}}
/>
<HistoryDialog bind:secret={history} />
<ProjectDialog bind:open={projectOpen} {project} />

<Dialog bind:open={envsOpen} title="Environments" description="Each environment holds its own value for every secret. The CLI names them by short name (-e)." width="max-w-md">
	<ul class="divide-y divide-border rounded-lg border border-border">
		{#each data.environments as e (e.id)}
			<li class="flex items-center gap-2 px-3 py-2 text-[0.8125rem]">
				<span class="font-medium">{e.name}</span>
				<span class="hash text-muted-foreground">{e.slug}</span>
				<button class="btn btn-ghost btn-icon btn-sm ml-auto" title="Rename" onclick={() => renameEnv(e)}><Pencil /></button>
				<button class="btn btn-ghost btn-icon btn-sm" title="Delete" disabled={data.environments.length === 1} onclick={() => deleteEnv(e)}><Trash2 /></button>
			</li>
		{/each}
	</ul>
	<form class="mt-3 flex gap-2" onsubmit={addEnv}>
		<input class="input" placeholder="New environment, e.g. QA" bind:value={newEnv} maxlength="60" required />
		<button class="btn btn-secondary"><Plus />Add</button>
	</form>
	{#if envError}<p class="mt-2 text-xs text-danger">{envError}</p>{/if}
</Dialog>
