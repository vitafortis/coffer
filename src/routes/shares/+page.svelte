<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Ban, Link2, Plus, Trash2 } from '@lucide/svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { ago, dateTime, until } from '#lib/client/format.ts';
	import { confirmAction, session, shareText, toast } from '#lib/client/state.svelte.ts';
	import type { Share } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const STATE = {
		active: { label: 'Waiting', cls: 'badge-primary' },
		opened: { label: 'Opened', cls: 'badge-success' },
		expired: { label: 'Expired', cls: '' },
		revoked: { label: 'Turned off', cls: '' }
	};

	async function revoke(s: Share) {
		if (!(await confirmAction({ title: 'Turn this link off?', body: 'It stops working at once and what it holds is wiped.', confirmLabel: 'Turn off', danger: true }))) return;
		try {
			await api.del(`/api/v1/shares/${s.id}`);
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	async function forget(s: Share) {
		try {
			await api.del(`/api/v1/shares/${s.id}?forget=1`);
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}
</script>

<svelte:head><title>One-time links · Coffer</title></svelte:head>

<PageHeader title="One-time links" description="Links that show a secret to someone without an account, then stop working. Coffer can't show a link again: it doesn't keep the key.">
	{#snippet actions()}
		{#if session.viewer?.admin}
			<a class="btn btn-ghost" href={data.everyone ? '/shares' : '/shares?all=1'}>{data.everyone ? 'Only mine' : 'Everyone’s'}</a>
		{/if}
		<button class="btn btn-primary" onclick={() => shareText()}><Plus />Share text</button>
	{/snippet}
</PageHeader>

<div class="px-4 pb-10 sm:px-8">
	<div class="card overflow-hidden">
		{#if data.shares.length}
			<div class="overflow-x-auto">
				<table class="w-full text-[0.8125rem]">
					<thead>
						<tr class="border-b border-border text-left text-xs text-muted-foreground">
							<th class="px-4 py-2 font-medium">Link</th>
							<th class="px-3 py-2 font-medium">State</th>
							<th class="px-3 py-2 font-medium">Opened</th>
							<th class="px-3 py-2 font-medium">Made</th>
							<th class="px-3 py-2 font-medium">Expires</th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.shares as s (s.id)}
							<tr class="hover:bg-accent/30">
								<td class="max-w-[22rem] px-4 py-2.5">
									<p class="truncate font-medium">{s.label ?? 'Untitled'}</p>
									<p class="truncate text-[0.6875rem] text-muted-foreground">
										{#if s.source}<span class="font-mono">{s.source}</span>{:else}Typed in{/if}{data.everyone && s.createdBy ? ` · ${s.createdBy}` : ''}
									</p>
								</td>
								<td class="px-3 py-2.5"><span class="badge {STATE[s.state].cls}">{STATE[s.state].label}</span></td>
								<td class="px-3 py-2.5 text-xs tabular-nums">{s.views} of {s.maxViews}{#if s.openedAt}<span class="block text-[0.6875rem] text-muted-foreground" title={dateTime(s.openedAt)}>first {ago(s.openedAt)}</span>{/if}</td>
								<td class="px-3 py-2.5 text-xs" title={dateTime(s.createdAt)}>{ago(s.createdAt)}</td>
								<td class="px-3 py-2.5 text-xs" title={dateTime(s.expiresAt)}>{s.state === 'active' ? until(s.expiresAt) : '—'}</td>
								<td class="px-3 py-2.5 text-right whitespace-nowrap">
									{#if s.state === 'active'}
										<button class="btn btn-danger-outline btn-sm" onclick={() => revoke(s)}><Ban />Turn off</button>
									{:else}
										<button class="btn btn-ghost btn-icon btn-sm" title="Remove from the list" onclick={() => forget(s)}><Trash2 /></button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<EmptyState icon={Link2} title="No one-time links yet" body="Share any secret from its menu, or share text you type here. The person you send it to sees it once, without signing in.">
				{#snippet action()}<button class="btn btn-primary btn-sm" onclick={() => shareText()}><Plus />Share text</button>{/snippet}
			</EmptyState>
		{/if}
	</div>
</div>
