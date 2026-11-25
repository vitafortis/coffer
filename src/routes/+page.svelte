<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { FolderKey, Link2, Plus, ShieldAlert, Sparkles } from '@lucide/svelte';
	import CertBadge from '#lib/components/CertBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ProjectDialog from '#lib/components/ProjectDialog.svelte';
	import { ago, plural } from '#lib/client/format.ts';
	import { shareText } from '#lib/client/state.svelte.ts';
	import { secretRef } from '#lib/paths.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let creating = $state(false);

	// /?new (sidebar +, palette, first run) opens the new project dialog.
	$effect(() => {
		if (page.url.searchParams.has('new')) {
			creating = true;
			replaceState('/', {});
		}
	});
</script>

<svelte:head><title>Projects · Coffer</title></svelte:head>

<PageHeader title="Projects" description="{plural(data.totals.secrets, 'secret')} in {plural(data.totals.projects, 'project')}{data.totals.activeShares ? ` · ${plural(data.totals.activeShares, 'one-time link')} open` : ''}">
	{#snippet actions()}
		<button class="btn btn-secondary" onclick={() => shareText()}><Link2 />Share text</button>
		<button class="btn btn-primary" onclick={() => (creating = true)}><Plus />New project</button>
	{/snippet}
</PageHeader>

<div class="space-y-6 px-4 pb-10 sm:px-8">
	{#if data.expiring.length}
		<section class="card border-warning/40 p-4">
			<h2 class="mb-2 flex items-center gap-2 text-[0.8125rem] font-semibold"><ShieldAlert class="size-4 text-warning" />Certificates to renew</h2>
			<ul class="space-y-1.5">
				{#each data.expiring as s (s.id)}
					<li class="flex flex-wrap items-center gap-2 text-xs">
						<a class="font-mono hover:text-primary" href="/p/{s.projectSlug}?env={s.envSlug}&path={encodeURIComponent(s.path)}&s={s.id}">{secretRef(s.projectSlug, s.envSlug, s.path, s.key)}</a>
						<span class="text-muted-foreground">{s.meta.cert!.subject.replace(/^.*CN=/, '')}</span>
						<CertBadge cert={s.meta.cert!} />
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.projects.length}
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each data.projects as p (p.id)}
				<a href="/p/{p.slug}" class="card group flex flex-col gap-3 p-4 transition-colors hover:border-primary/40">
					<div class="flex items-start gap-3">
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-sm font-semibold text-primary uppercase">{p.name.slice(0, 1)}</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-[0.9375rem] font-semibold tracking-tight group-hover:text-primary">{p.name}</p>
							<p class="hash truncate text-muted-foreground">{p.slug}</p>
						</div>
						<span class="text-xs text-muted-foreground tabular-nums">{plural(p.secretCount, 'secret')}</span>
					</div>
					{#if p.description}<p class="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>{/if}
					<div class="mt-auto flex flex-wrap items-center gap-1">
						{#each p.environments as e (e.id)}<span class="badge">{e.name}</span>{/each}
						<span class="ml-auto text-[0.6875rem] text-muted-foreground">updated {ago(p.updatedAt)}</span>
					</div>
				</a>
			{/each}
		</div>
	{:else}
		<div class="card">
			<EmptyState icon={FolderKey} title="No projects yet" body="A project holds the secrets for one app or system — database URLs, API keys, certificates — with a value per environment.">
				{#snippet action()}
					<div class="flex gap-2">
						<button class="btn btn-primary btn-sm" onclick={() => (creating = true)}><Plus />New project</button>
						<a class="btn btn-secondary btn-sm" href="/generate"><Sparkles />Generate something</a>
					</div>
				{/snippet}
			</EmptyState>
		</div>
	{/if}
</div>

<ProjectDialog bind:open={creating} />
