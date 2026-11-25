<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Link2, LoaderCircle, ShieldCheck } from '@lucide/svelte';
	import Dialog from './Dialog.svelte';
	import CopyField from './CopyField.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { sharing } from '#lib/client/state.svelte.ts';
	import { until } from '#lib/client/format.ts';
	import type { Share } from '#lib/types.ts';

	let { defaultHours = 24 }: { defaultHours?: number } = $props();

	const EXPIRY = [
		{ hours: 1, label: '1 hour' },
		{ hours: 24, label: '1 day' },
		{ hours: 72, label: '3 days' },
		{ hours: 168, label: '7 days' },
		{ hours: 720, label: '30 days' }
	];

	let label = $state('');
	let value = $state('');
	let hours = $state(24);
	let views = $state(1);
	let busy = $state(false);
	let error = $state('');
	let result = $state<{ url: string; share: Share } | null>(null);

	const target = $derived(sharing.target);
	const fromSecret = $derived(!!target?.secretId);

	$effect(() => {
		if (!target) return;
		label = target.label ?? '';
		value = target.value ?? '';
		hours = EXPIRY.some((e) => e.hours === defaultHours) ? defaultHours : 24;
		views = 1;
		error = '';
		result = null;
	});

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			result = await api.post<{ url: string; share: Share }>('/api/v1/shares', {
				secretId: target?.secretId,
				value: fromSecret ? undefined : value,
				label: label || undefined,
				hours,
				views
			});
			invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
		busy = false;
	}
</script>

<Dialog
	bind:open={() => !!target, (v) => !v && (sharing.target = null)}
	title={result ? 'Your one-time link' : fromSecret ? `Share ${target?.label}` : 'Share with a one-time link'}
	description={result ? undefined : 'Anyone with the link can open it, once, without signing in.'}
>
	{#if result}
		<div class="space-y-4">
			<CopyField value={result.url} />
			<div class="flex gap-3 rounded-lg bg-surface px-3 py-2.5 text-xs text-muted-foreground">
				<ShieldCheck class="mt-0.5 size-4 shrink-0 text-primary" />
				<p>
					This is the only time the link is shown. It opens {result.share.maxViews === 1 ? 'once' : `${result.share.maxViews} times`} and expires {until(result.share.expiresAt)}.
					The part after <span class="hash">#</span> is the key: Coffer doesn't keep it, so the link can't be recovered — but it can be turned off under One-time links.
				</p>
			</div>
		</div>
	{:else}
		<form id="share-form" class="space-y-4" onsubmit={create}>
			{#if !fromSecret}
				<div>
					<label class="label" for="share-value">What to share</label>
					<!-- svelte-ignore a11y_autofocus -->
					<textarea id="share-value" class="input h-32 resize-y py-2 font-mono text-xs" bind:value autofocus required spellcheck="false" autocomplete="off"></textarea>
				</div>
			{/if}
			<div>
				<label class="label" for="share-label">Label <span class="font-normal">(shown to whoever opens it)</span></label>
				<input id="share-label" class="input" bind:value={label} maxlength="200" placeholder="Staging database password" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="label" for="share-hours">Expires after</label>
					<select id="share-hours" class="input" bind:value={hours}>
						{#each EXPIRY as e (e.hours)}<option value={e.hours}>{e.label}</option>{/each}
					</select>
				</div>
				<div>
					<label class="label" for="share-views">Can be opened</label>
					<select id="share-views" class="input" bind:value={views}>
						<option value={1}>Once</option>
						{#each [2, 3, 5, 10] as n (n)}<option value={n}>{n} times</option>{/each}
					</select>
				</div>
			</div>
			{#if fromSecret}
				<p class="text-xs text-muted-foreground">The link holds a copy of the value as it is now. Changing the secret later doesn't change the link.</p>
			{/if}
			{#if error}<p class="text-xs text-danger">{error}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		{#if result}
			<button class="btn btn-primary" onclick={() => (sharing.target = null)}>Done</button>
		{:else}
			<button class="btn btn-ghost" onclick={() => (sharing.target = null)}>Cancel</button>
			<button class="btn btn-primary" form="share-form" disabled={busy}>
				{#if busy}<LoaderCircle class="animate-spin" />{:else}<Link2 />{/if}Create link
			</button>
		{/if}
	{/snippet}
</Dialog>
