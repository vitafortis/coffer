<script lang="ts">
	import { goto } from '$app/navigation';
	import { Copy, CornerDownLeft, FolderKey, History, Link2, Moon, Plus, Search, Settings, Sparkles } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import TypeIcon from './TypeIcon.svelte';
	import { api } from '#lib/client/api.ts';
	import { copySecret } from '#lib/client/secrets.ts';
	import { palette, setTheme, shareText, theme } from '#lib/client/state.svelte.ts';
	import { secretRef } from '#lib/paths.ts';
	import type { SecretHit, SecretType } from '#lib/types.ts';

	let { projects }: { projects: { id: string; slug: string; name: string }[] } = $props();

	type Item = { id: string; label: string; hint?: string; icon?: Component; type?: SecretType; secret?: SecretHit; run: () => void };

	let query = $state('');
	let index = $state(0);
	let input = $state<HTMLInputElement>();
	let dialog: HTMLDialogElement;
	let hits = $state<SecretHit[]>([]);

	const fixed = $derived.by((): Item[] => [
		...projects.map((p) => ({ id: `p:${p.id}`, label: p.name, hint: p.slug, icon: FolderKey, run: () => goto(`/p/${p.slug}`) })),
		{ id: 'new', label: 'New project', icon: Plus, run: () => goto('/?new') },
		{ id: 'generate', label: 'Generate a password, key or certificate', icon: Sparkles, run: () => goto('/generate') },
		{ id: 'share', label: 'Share text with a one-time link', icon: Link2, run: () => shareText() },
		{ id: 'shares', label: 'One-time links', icon: Link2, run: () => goto('/shares') },
		{ id: 'activity', label: 'Activity', icon: History, run: () => goto('/activity') },
		{ id: 'settings', label: 'Settings', icon: Settings, run: () => goto('/settings') },
		{ id: 'theme', label: theme.value === 'dark' ? 'Light theme' : 'Dark theme', icon: Moon, run: () => setTheme(theme.value === 'dark' ? 'light' : 'dark') }
	]);

	// Secrets matching what's typed, a moment after typing stops. Names only: values load on copy.
	$effect(() => {
		const q = query.trim();
		if (!palette.open || q.length < 2) {
			hits = [];
			return;
		}
		const ctrl = new AbortController();
		const t = setTimeout(async () => {
			try {
				hits = (await api.get<{ results: SecretHit[] }>(`/api/v1/search?limit=10&q=${encodeURIComponent(q)}`, ctrl.signal)).results;
			} catch {}
		}, 120);
		return () => {
			clearTimeout(t);
			ctrl.abort();
		};
	});

	const filtered = $derived.by((): Item[] => {
		const q = query.trim().toLowerCase();
		if (!q) return fixed;
		const pages = fixed.filter((it) => q.split(/\s+/).every((w) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(w)));
		const secrets = hits.map((h) => ({
			id: `s:${h.id}`,
			label: h.key,
			hint: secretRef(h.projectSlug, h.envSlug, h.path, '').replace(/\/$/, ''),
			type: h.type,
			secret: h,
			run: () => goto(`/p/${h.projectSlug}?env=${h.envSlug}&path=${encodeURIComponent(h.path)}&s=${h.id}`)
		}));
		return [...secrets, ...pages];
	});

	$effect(() => {
		void query;
		index = 0;
	});

	$effect(() => {
		if (palette.open && !dialog.open) {
			dialog.showModal();
			query = '';
			queueMicrotask(() => input?.focus());
		} else if (!palette.open && dialog.open) dialog.close();
	});

	function run(it: Item | undefined, copy = false) {
		if (!it) return;
		palette.open = false;
		if (copy && it.secret) copySecret(it.secret.id, it.secret.key);
		else it.run();
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			palette.open = !palette.open;
		}
	}

	function onInputKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			index = Math.min(filtered.length - 1, index + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			index = Math.max(0, index - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			run(filtered[index], e.shiftKey || e.metaKey || e.ctrlKey);
		}
	}
</script>

<svelte:window {onkeydown} />

<dialog
	bind:this={dialog}
	onclose={() => (palette.open = false)}
	onclick={(e) => e.target === dialog && (palette.open = false)}
	class="m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-surface-lg backdrop:bg-black/50 backdrop:backdrop-blur-sm"
>
	{#if palette.open}
		<div class="flex items-center gap-2.5 border-b border-border px-4">
			<Search class="size-4 text-muted-foreground" />
			<input bind:this={input} bind:value={query} onkeydown={onInputKey} class="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70" placeholder="Find a secret by name, folder or project…" />
			<span class="kbd">esc</span>
		</div>
		<ul class="max-h-[50vh] overflow-y-auto p-1.5">
			{#each filtered as it, i (it.id)}
				<li>
					<button
						class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[0.8125rem] {i === index ? 'bg-accent text-foreground' : 'text-muted-foreground'}"
						onmouseenter={() => (index = i)}
						onclick={(e) => run(it, e.shiftKey)}
					>
						{#if it.type}<TypeIcon type={it.type} />{:else if it.icon}<it.icon class="size-4 shrink-0" />{/if}
						<span class="truncate font-medium text-foreground {it.secret ? 'font-mono text-xs' : ''}">{it.label}</span>
						{#if it.hint}<span class="truncate text-xs">{it.hint}</span>{/if}
						{#if i === index}
							<span class="ml-auto flex shrink-0 items-center gap-2 text-[0.6875rem]">
								{#if it.secret}<span class="flex items-center gap-1 touch:hidden"><Copy class="size-3" />⇧↵</span>{/if}
								<CornerDownLeft class="size-3.5" />
							</span>
						{/if}
					</button>
				</li>
			{/each}
			{#if query.trim().length >= 2 && !hits.length}
				<li class="px-3 py-2 text-xs text-muted-foreground">No secrets match “{query.trim()}”.</li>
			{/if}
		</ul>
	{/if}
</dialog>
