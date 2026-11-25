<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { Check, Copy, Download, Eye, Link2Off, LoaderCircle, LockKeyhole, TriangleAlert } from '@lucide/svelte';
	import Logo from '#lib/components/Logo.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { writeClipboard } from '#lib/client/clipboard.ts';
	import { until } from '#lib/client/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let key = $state('');
	let value = $state<string | null>(null);
	let remaining = $state(0);
	let busy = $state(false);
	let error = $state('');
	let gone = $state('');
	let copied = $state(false);

	onMount(() => {
		key = location.hash.slice(1);
		// Take the key out of the address bar and history, so it isn't left behind.
		if (location.hash) replaceState(location.pathname, {});
	});

	async function open() {
		busy = true;
		error = '';
		try {
			const r = await api.post<{ value: string; remaining: number }>('/api/v1/shares/open', { id: data.id, key });
			value = r.value;
			remaining = r.remaining;
			key = '';
		} catch (err) {
			const msg = errorMessage(err);
			if (/already been opened|expired|turned off/.test(msg)) gone = msg;
			else error = msg;
		}
		busy = false;
	}

	async function copy() {
		if (value !== null && (await writeClipboard(value))) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}

	function download() {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([value ?? ''], { type: 'text/plain' }));
		a.download = (data.label ?? 'secret').replace(/[^\w.-]+/g, '_') + '.txt';
		a.click();
		URL.revokeObjectURL(a.href);
	}

	const multiline = $derived(value !== null && (value.includes('\n') || value.length > 80));
	const status = $derived(gone ? 'gone' : data.state);
</script>

<svelte:head>
	<title>{data.label ?? 'A secret'} · Coffer</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
	<div class="dot-grid mask-fade pointer-events-none absolute inset-0 opacity-70"></div>
	<div class="glow-top pointer-events-none absolute inset-x-0 top-0 h-[480px]"></div>

	<div class="card relative w-full max-w-lg min-w-0 p-7 shadow-surface-lg max-sm:p-5">
		<div class="mb-6 flex items-center gap-3">
			<Logo size={36} still={value !== null || status !== 'active'} />
			<div class="min-w-0">
				<p class="text-xs text-muted-foreground">Shared with you through Coffer{data.from ? ` by ${data.from}` : ''}</p>
				<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">{data.label ?? 'A secret'}</h1>
			</div>
		</div>

		{#if value !== null}
			{#if multiline}
				<pre class="max-h-[50vh] overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs break-all whitespace-pre-wrap select-all">{value}</pre>
			{:else}
				<div class="rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-sm break-all select-all">{value}</div>
			{/if}
			<div class="mt-3 flex gap-2">
				<button class="btn btn-primary flex-1" onclick={copy}>{#if copied}<Check />Copied{:else}<Copy />Copy{/if}</button>
				{#if multiline}<button class="btn btn-secondary" onclick={download}><Download />Save as file</button>{/if}
			</div>
			<p class="mt-4 flex gap-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground">
				<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" />
				{remaining === 0 ? 'This link is now used up and the secret is deleted from Coffer. Copy it before you leave this page.' : `This link can be opened ${remaining} more time${remaining === 1 ? '' : 's'}.`}
			</p>
		{:else if status !== 'active'}
			<div class="flex flex-col items-center gap-2 py-6 text-center">
				<span class="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><Link2Off class="size-5" /></span>
				<p class="text-[0.8125rem] font-medium">{gone || (data.state === 'opened' ? 'This link has already been opened' : data.state === 'revoked' ? 'This link was turned off' : 'This link has expired')}</p>
				<p class="text-xs text-muted-foreground">Ask whoever sent it for a new one.</p>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-3 py-2 text-center">
				<span class="grid size-11 place-items-center rounded-full bg-primary-soft text-primary"><LockKeyhole class="size-5" /></span>
				<p class="max-w-xs text-[0.8125rem] text-muted-foreground">
					{data.remaining === 1 ? 'This secret can be shown once. After that the link stops working and the secret is deleted.' : `This secret can be shown ${data.remaining} more times.`}
					The link expires {until(data.expiresAt)}.
				</p>
				{#if !key}
					<p class="text-xs text-danger">This link is missing its key (the part after #). Copy the whole link you were sent.</p>
				{/if}
				<button class="btn btn-primary mt-2 h-10 w-full" disabled={busy || !key} onclick={open}>
					{#if busy}<LoaderCircle class="animate-spin" />{:else}<Eye />{/if}Show the secret
				</button>
				{#if error}<p class="text-xs text-danger">{error}</p>{/if}
			</div>
		{/if}
	</div>
</div>
