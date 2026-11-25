<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { FolderKey, History, Link2, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sparkles, Sun, X } from '@lucide/svelte';
	import Logo from '#lib/components/Logo.svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import ConfirmHost from '#lib/components/ConfirmHost.svelte';
	import CommandPalette from '#lib/components/CommandPalette.svelte';
	import ShareDialog from '#lib/components/ShareDialog.svelte';
	import { api } from '#lib/client/api.ts';
	import { palette, session, setTheme, theme } from '#lib/client/state.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	$effect.pre(() => {
		session.viewer = data.viewer;
	});

	$effect(() => {
		theme.value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
	});

	// Sign-in, setup and one-time link pages stand alone.
	const bare = $derived(['/login', '/setup'].includes(page.url.pathname) || page.url.pathname.startsWith('/s/') || !data.viewer);

	let collapsed = $state(false);
	let drawer = $state(false);

	$effect(() => {
		void page.url.pathname;
		drawer = false;
	});

	const nav = [
		{ href: '/', label: 'Projects', icon: FolderKey },
		{ href: '/generate', label: 'Generate', icon: Sparkles },
		{ href: '/shares', label: 'One-time links', icon: Link2 },
		{ href: '/activity', label: 'Activity', icon: History },
		{ href: '/settings', label: 'Settings', icon: Settings }
	];

	async function logout() {
		await api.post('/api/auth/logout');
		goto('/login');
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
			e.preventDefault();
			collapsed = !collapsed;
		}
	}
</script>

<svelte:head>
	<title>Coffer</title>
</svelte:head>

<svelte:window {onkeydown} />

{#snippet sidebar(compact: boolean)}
	<div class="flex h-14 items-center gap-2.5 px-3.5">
		<a href="/" class="flex items-center gap-2.5">
			<Logo size={26} />
			{#if !compact}<span class="text-[0.9375rem] font-semibold tracking-tight">Coffer</span>{/if}
		</a>
		{#if drawer}
			<button class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Close menu" onclick={() => (drawer = false)}><X /></button>
		{/if}
	</div>

	<div class="px-2 pb-2">
		<button
			class="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-[0.8125rem] text-muted-foreground shadow-surface transition-colors hover:text-foreground {compact ? 'justify-center px-0' : ''}"
			title="Search secrets (⌘K)"
			onclick={() => (palette.open = true)}
		>
			<Search class="size-3.5 shrink-0" />
			{#if !compact}<span class="flex-1 text-left">Search secrets</span><span class="kbd touch:hidden">⌘K</span>{/if}
		</button>
	</div>

	<nav class="space-y-0.5 px-2">
		{#each nav as item (item.href)}
			{@const active = item.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(item.href)}
			<a
				href={item.href}
				title={item.label}
				class="relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-medium transition-colors {active
					? 'bg-accent text-foreground shadow-surface'
					: 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'}"
			>
				{#if active}<span class="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"></span>{/if}
				<item.icon class="size-4 shrink-0" />
				{#if !compact}{item.label}{/if}
			</a>
		{/each}
	</nav>

	{#if !compact}
		<div class="mt-5 flex items-center justify-between px-4 pb-1.5">
			<span class="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">Projects</span>
			<a href="/?new" class="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" title="New project" aria-label="New project"><Plus class="size-3.5" /></a>
		</div>
	{:else}
		<div class="mt-4"></div>
	{/if}

	<div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pt-0.5 pb-2">
		{#each data.projects as p (p.id)}
			{@const active = page.url.pathname === `/p/${p.slug}` || page.url.pathname.startsWith(`/p/${p.slug}/`)}
			<a
				href="/p/{p.slug}"
				title={p.name}
				class="flex items-center gap-2.5 rounded-lg px-2.5 transition-colors {compact ? 'h-8 justify-center' : 'py-1.5'} {active
					? 'bg-accent text-foreground'
					: 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'}"
			>
				<span class="grid size-5 shrink-0 place-items-center rounded-md bg-primary-soft text-[0.625rem] font-semibold text-primary uppercase">{p.name.slice(0, 1)}</span>
				{#if !compact}
					<span class="min-w-0 flex-1 truncate text-[0.8125rem] {active ? 'font-medium' : ''}">{p.name}</span>
					<span class="text-[0.6875rem] text-muted-foreground/70 tabular-nums">{p.secretCount}</span>
				{/if}
			</a>
		{:else}
			{#if !compact}
				<a href="/?new" class="block w-full rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
					No projects yet.<br /><span class="text-primary">Make one →</span>
				</a>
			{/if}
		{/each}
	</div>

	{#if data.viewer && !compact}
		<a href="/settings#account" title="My account" class="flex items-center gap-2.5 border-t border-border px-3 py-2.5 transition-colors hover:bg-accent/60">
			<span class="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[0.6875rem] font-semibold text-primary uppercase">
				{(data.viewer.name ?? data.viewer.email).slice(0, 1)}
			</span>
			<div class="min-w-0 flex-1">
				<p class="truncate text-xs font-medium">{data.viewer.name ?? data.viewer.email}</p>
				{#if data.viewer.name}<p class="truncate text-[0.6875rem] text-muted-foreground">{data.viewer.email}</p>{/if}
			</div>
		</a>
	{/if}
	<div class="flex items-center gap-1 border-t border-border p-2 {compact ? 'flex-col' : ''}">
		<button class="btn btn-ghost btn-icon btn-sm max-md:hidden" title="Toggle sidebar (⌘B)" onclick={() => (collapsed = !collapsed)}>
			{#if compact}<PanelLeftOpen />{:else}<PanelLeftClose />{/if}
		</button>
		<button class="btn btn-ghost btn-icon btn-sm" title="Toggle theme" onclick={() => setTheme(theme.value === 'dark' ? 'light' : 'dark')}>
			{#if theme.value === 'dark'}<Sun />{:else}<Moon />{/if}
		</button>
		{#if !compact}
			<span class="ml-1 truncate font-mono text-[0.6875rem] text-muted-foreground/70" title="Coffer version">v{data.version}</span>
		{/if}
		<button class="btn btn-ghost btn-icon btn-sm {compact ? '' : 'ml-auto'}" title="Sign out" onclick={logout}><LogOut /></button>
	</div>
{/snippet}

{#if bare}
	{@render children()}
{:else}
	<div class="flex h-dvh overflow-hidden">
		<aside class="flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 max-md:hidden {collapsed ? 'w-14' : 'w-64'}">
			{@render sidebar(collapsed)}
		</aside>

		{#if drawer}
			<button class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" aria-label="Close menu" onclick={() => (drawer = false)}></button>
			<aside class="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-surface shadow-surface-lg md:hidden">
				{@render sidebar(false)}
			</aside>
		{/if}

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:hidden">
				<button class="btn btn-ghost btn-icon btn-sm" aria-label="Menu" onclick={() => (drawer = true)}><Menu /></button>
				<a href="/" class="flex items-center gap-2"><Logo size={22} /><span class="text-sm font-semibold tracking-tight">Coffer</span></a>
				<button class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Search" onclick={() => (palette.open = true)}><Search /></button>
			</header>
			<main class="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
				{@render children()}
			</main>
		</div>
	</div>
	<!-- ⌘K / Ctrl+K: find a secret, copy it, or jump to a project or page. -->
	<CommandPalette projects={data.projects} />
	<ShareDialog defaultHours={data.shareHours} />
{/if}

<Toaster />
<ConfirmHost />
