<script lang="ts">
	import { History } from '@lucide/svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { ago, dateTime } from '#lib/client/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let filter = $state('');

	const LABELS: Record<string, string> = {
		'secret.read': 'Read',
		'secret.created': 'Added',
		'secret.updated': 'Changed',
		'secret.deleted': 'Deleted',
		'secret.restored': 'Restored',
		'folder.deleted': 'Deleted folder',
		'project.created': 'New project',
		'project.updated': 'Project changed',
		'project.deleted': 'Deleted project',
		'environment.created': 'New environment',
		'environment.updated': 'Environment changed',
		'environment.deleted': 'Deleted environment',
		'share.created': 'Made a link',
		'share.opened': 'Link opened',
		'share.revoked': 'Link turned off',
		'token.created': 'New API token',
		'token.revoked': 'Token revoked',
		'user.created': 'Added person',
		'user.updated': 'Person changed',
		'user.deleted': 'Removed person',
		login: 'Signed in',
		'login.failed': 'Sign-in failed',
		setup: 'Set up Coffer',
		'settings.updated': 'Settings changed',
		'account.password': 'Changed password'
	};
	const tone = (a: string) => (/deleted|failed|revoked/.test(a) ? 'badge-danger' : a === 'secret.read' || a === 'share.opened' ? 'badge-warning' : /created|restored/.test(a) ? 'badge-success' : '');

	const rows = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return q ? data.activity.filter((a) => `${a.action} ${LABELS[a.action] ?? ''} ${a.actor ?? ''} ${a.target ?? ''} ${a.detail ?? ''}`.toLowerCase().includes(q)) : data.activity;
	});
</script>

<svelte:head><title>Activity · Coffer</title></svelte:head>

<PageHeader title="Activity" description="Who read, changed and shared what. Every value shown, copied or fetched by the CLI is a read.">
	{#snippet actions()}<input class="input w-64 max-sm:w-full" placeholder="Filter: a name, a person, “read”…" bind:value={filter} />{/snippet}
</PageHeader>

<div class="px-4 pb-10 sm:px-8">
	<div class="card overflow-hidden">
		{#if rows.length}
			<ul class="divide-y divide-border">
				{#each rows as a (a.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[0.8125rem]">
						<span class="w-20 shrink-0 text-xs text-muted-foreground" title={dateTime(a.at)}>{ago(a.at)}</span>
						<span class="badge {tone(a.action)}">{LABELS[a.action] ?? a.action}</span>
						{#if a.target}<span class="min-w-0 truncate font-mono text-xs">{a.target}</span>{/if}
						{#if a.detail}<span class="truncate text-xs text-muted-foreground">{a.detail}</span>{/if}
						<span class="ml-auto truncate text-xs text-muted-foreground">{a.actor ?? 'someone with the link'}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<EmptyState icon={History} title={filter ? 'Nothing matches' : 'Nothing yet'} />
		{/if}
	</div>
</div>
