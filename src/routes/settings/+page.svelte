<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Download, KeyRound, LoaderCircle, Plus, Puzzle, Server, Terminal, Trash2, UserRound, Users } from '@lucide/svelte';
	import CopyField from '#lib/components/CopyField.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { ago, dateTime, until } from '#lib/client/format.ts';
	import { confirmAction, session, toast } from '#lib/client/state.svelte.ts';
	import { generatePassword } from '#lib/generate.ts';
	import type { ApiToken, User } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ── Account ──
	let name = $state('');
	let current = $state('');
	let next = $state('');
	let accountBusy = $state(false);
	$effect(() => {
		name = data.me.name ?? '';
	});
	async function saveAccount(e: SubmitEvent) {
		e.preventDefault();
		accountBusy = true;
		try {
			await api.patch('/api/v1/account', { name, ...(next ? { currentPassword: current, newPassword: next } : {}) });
			toast('success', next ? 'Saved, with your new password' : 'Saved');
			current = next = '';
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
		accountBusy = false;
	}

	// ── API tokens ──
	let tokenOpen = $state(false);
	let tokenName = $state('');
	let tokenReadOnly = $state(false);
	let tokenDays = $state<number | null>(null);
	let newToken = $state<string | null>(null);
	let tokenError = $state('');
	async function createToken(e: SubmitEvent) {
		e.preventDefault();
		tokenError = '';
		try {
			const r = await api.post<{ token: string }>('/api/v1/tokens', { name: tokenName, readOnly: tokenReadOnly, days: tokenDays });
			newToken = r.token;
			invalidateAll();
		} catch (err) {
			tokenError = errorMessage(err);
		}
	}
	function openToken(preset: string) {
		tokenName = preset;
		tokenReadOnly = false;
		tokenDays = null;
		newToken = null;
		tokenError = '';
		tokenOpen = true;
	}
	async function revokeToken(t: ApiToken) {
		if (!(await confirmAction({ title: `Revoke “${t.name}”?`, body: 'Anything using it (a CLI, the extension) stops working at once.', confirmLabel: 'Revoke', danger: true }))) return;
		await api.del(`/api/v1/tokens/${t.id}`).catch((err) => toast('error', errorMessage(err)));
		invalidateAll();
	}

	// ── People ──
	let personOpen = $state(false);
	let pEmail = $state('');
	let pName = $state('');
	let pRole = $state<'member' | 'admin'>('member');
	let pPassword = $state('');
	let pError = $state('');
	function openPerson() {
		pEmail = pName = '';
		pRole = 'member';
		pPassword = generatePassword({ length: 20, symbols: false, unambiguous: true });
		pError = '';
		personOpen = true;
	}
	async function addPerson(e: SubmitEvent) {
		e.preventDefault();
		pError = '';
		try {
			await api.post('/api/v1/users', { email: pEmail, name: pName || undefined, role: pRole, password: pPassword });
			personOpen = false;
			toast('success', `Added ${pEmail}`, 'Send them their password, then ask them to change it.');
			invalidateAll();
		} catch (err) {
			pError = errorMessage(err);
		}
	}
	async function setRole(u: User, role: string) {
		try {
			await api.patch(`/api/v1/users/${u.id}`, { role });
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
			invalidateAll();
		}
	}
	async function resetPassword(u: User) {
		const pw = generatePassword({ length: 20, symbols: false, unambiguous: true });
		if (!(await confirmAction({ title: `Reset ${u.email}'s password?`, body: 'They are signed out everywhere. Their new password is below: send it to them (a one-time link is a good way).', detail: pw, confirmLabel: 'Reset password' }))) return;
		try {
			await api.patch(`/api/v1/users/${u.id}`, { password: pw });
			toast('success', 'Password reset');
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}
	async function removePerson(u: User) {
		if (!(await confirmAction({ title: `Remove ${u.email}?`, body: 'Their sign-in and API tokens stop working. What they made stays.', confirmLabel: 'Remove', danger: true }))) return;
		try {
			await api.del(`/api/v1/users/${u.id}`);
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	// ── Server ──
	let publicUrl = $state('');
	let shareHours = $state(24);
	$effect(() => {
		publicUrl = data.settings.publicUrl;
		shareHours = data.settings.shareHours;
	});
	async function saveServer(e: SubmitEvent) {
		e.preventDefault();
		try {
			await api.put('/api/v1/settings', { publicUrl, shareHours });
			toast('success', 'Saved');
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	const install = $derived(`curl -fsSL ${data.base}/cli/install.sh | sh`);
</script>

<svelte:head><title>Settings · Coffer</title></svelte:head>

<PageHeader title="Settings" />

<div class="mx-auto max-w-3xl space-y-6 px-4 pb-12 sm:px-8">
	<section id="account" class="card p-5">
		<h2 class="mb-4 flex items-center gap-2 text-[0.9375rem] font-semibold"><UserRound class="size-4 text-primary" />Your account</h2>
		<form class="grid gap-3 sm:grid-cols-2" onsubmit={saveAccount}>
			<div>
				<label class="label" for="a-email">Email</label>
				<input id="a-email" class="input" value={data.me.email} disabled />
			</div>
			<div>
				<label class="label" for="a-name">Name</label>
				<input id="a-name" class="input" bind:value={name} maxlength="100" />
			</div>
			<div>
				<label class="label" for="a-current">Current password</label>
				<input id="a-current" class="input" type="password" autocomplete="current-password" bind:value={current} />
			</div>
			<div>
				<label class="label" for="a-next">New password <span class="font-normal">(10+ characters)</span></label>
				<input id="a-next" class="input" type="password" autocomplete="new-password" bind:value={next} minlength="10" />
			</div>
			<div class="sm:col-span-2"><button class="btn btn-primary" disabled={accountBusy}>{#if accountBusy}<LoaderCircle class="animate-spin" />{/if}Save</button></div>
		</form>
	</section>

	<section id="tokens" class="card p-5">
		<div class="mb-1 flex items-center justify-between gap-2">
			<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold"><KeyRound class="size-4 text-primary" />API tokens</h2>
			<button class="btn btn-secondary btn-sm" onclick={() => openToken('')}><Plus />New token</button>
		</div>
		<p class="mb-4 text-xs text-muted-foreground">For the CLI and the browser extension. A token acts as you; read-only ones can read and share but not change anything.</p>
		{#if data.tokens.length}
			<ul class="divide-y divide-border rounded-lg border border-border">
				{#each data.tokens as t (t.id)}
					{@const expired = !!t.expiresAt && Date.parse(t.expiresAt) < Date.now()}
					<li class="flex items-center gap-3 px-3 py-2 text-[0.8125rem]">
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{t.name} {#if t.readOnly}<span class="badge ml-1">read-only</span>{/if}{#if expired}<span class="badge badge-danger ml-1">expired</span>{/if}</p>
							<p class="truncate text-[0.6875rem] text-muted-foreground">
								<span class="font-mono">{t.prefix}…</span> · made {ago(t.createdAt)} · {t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : 'never used'}{t.expiresAt && !expired ? ` · expires ${until(t.expiresAt)}` : ''}
							</p>
						</div>
						<button class="btn btn-ghost btn-icon btn-sm" title="Revoke" onclick={() => revokeToken(t)}><Trash2 /></button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section id="cli" class="card p-5">
		<h2 class="mb-1 flex items-center gap-2 text-[0.9375rem] font-semibold"><Terminal class="size-4 text-primary" />Command line</h2>
		<p class="mb-3 text-xs text-muted-foreground">One file, needs Node 20 or later. Installs to ~/.local/bin/coffer, already pointed at this server.</p>
		<CopyField value={install} />
		<p class="mt-3 mb-1.5 text-xs text-muted-foreground">Then sign it in with a token, and try it:</p>
		<pre class="overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-[0.6875rem] leading-relaxed">coffer login                        # paste a token
coffer use my-project dev           # default project and environment
coffer ls                           # what's in it
coffer get DATABASE_URL             # print a value
coffer set API_KEY                  # prompts for the value (or pipe it in)
coffer gen password -l 32 --save ADMIN_PASSWORD
coffer share DATABASE_URL --expires 1h
echo "hello" | coffer share -       # share any text once
coffer open 'https://…/s/abc#key'   # read a one-time link</pre>
		<button class="btn btn-secondary btn-sm mt-3" onclick={() => openToken(`CLI on ${navigator.platform || 'my computer'}`)}><Plus />Make a CLI token</button>
	</section>

	<section id="extension" class="card p-5">
		<h2 class="mb-1 flex items-center gap-2 text-[0.9375rem] font-semibold"><Puzzle class="size-4 text-primary" />Browser extension</h2>
		<p class="mb-3 text-xs text-muted-foreground">Search and copy secrets from the toolbar, and right-click any password field to fill it with a new password. For Chrome, Edge, Brave and Arc.</p>
		<ol class="mb-3 list-decimal space-y-1 pl-5 text-[0.8125rem]">
			<li>Download and unzip it somewhere it can stay.</li>
			<li>Open <span class="hash">chrome://extensions</span>, turn on <b>Developer mode</b>, and choose <b>Load unpacked</b> → the unzipped folder.</li>
			<li>Click the Coffer icon, enter <span class="hash">{data.base}</span> and a token.</li>
		</ol>
		<div class="flex flex-wrap gap-2">
			<a class="btn btn-primary btn-sm" href="/cli/coffer-extension.zip" download><Download />Download extension</a>
			<button class="btn btn-secondary btn-sm" onclick={() => openToken('Browser extension')}><Plus />Make an extension token</button>
		</div>
	</section>

	{#if session.viewer?.admin}
		<section id="people" class="card p-5">
			<div class="mb-4 flex items-center justify-between gap-2">
				<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold"><Users class="size-4 text-primary" />People</h2>
				<button class="btn btn-secondary btn-sm" onclick={openPerson}><Plus />Add someone</button>
			</div>
			<p class="mb-3 text-xs text-muted-foreground">Everyone can see and use every project. Admins also manage people and these settings.</p>
			<ul class="divide-y divide-border rounded-lg border border-border">
				{#each data.users as u (u.id)}
					<li class="flex flex-wrap items-center gap-3 px-3 py-2 text-[0.8125rem]">
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{u.name ?? u.email}{u.id === data.me.id ? ' (you)' : ''}</p>
							<p class="truncate text-[0.6875rem] text-muted-foreground">{u.name ? `${u.email} · ` : ''}{u.lastLoginAt ? `signed in ${ago(u.lastLoginAt)}` : 'never signed in'}</p>
						</div>
						<select class="input h-8 w-28 text-xs" value={u.role} disabled={u.id === data.me.id} onchange={(e) => setRole(u, e.currentTarget.value)}>
							<option value="member">Member</option>
							<option value="admin">Admin</option>
						</select>
						{#if u.id !== data.me.id}
							<button class="btn btn-ghost btn-sm" onclick={() => resetPassword(u)}>Reset password</button>
							<button class="btn btn-ghost btn-icon btn-sm" title="Remove" onclick={() => removePerson(u)}><Trash2 /></button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>

		<section id="server" class="card p-5">
			<h2 class="mb-4 flex items-center gap-2 text-[0.9375rem] font-semibold"><Server class="size-4 text-primary" />Server</h2>
			<form class="space-y-3" onsubmit={saveServer}>
				<div>
					<label class="label" for="s-url">Public URL</label>
					<input id="s-url" class="input" bind:value={publicUrl} placeholder="https://coffer.example.com" />
					<p class="mt-1 text-[0.6875rem] text-muted-foreground">The address one-time links and the CLI installer use. Blank: whatever address the request came in on.</p>
				</div>
				<div class="max-w-xs">
					<label class="label" for="s-hours">One-time links expire after</label>
					<select id="s-hours" class="input" bind:value={shareHours}>
						<option value={1}>1 hour</option>
						<option value={24}>1 day</option>
						<option value={72}>3 days</option>
						<option value={168}>7 days</option>
					</select>
				</div>
				<button class="btn btn-primary">Save</button>
			</form>
		</section>
	{/if}
	<p class="text-center text-[0.6875rem] text-muted-foreground">Coffer {__APP_VERSION__ ?? ''} · signed in {data.me.lastLoginAt ? dateTime(data.me.lastLoginAt) : ''}</p>
</div>

<Dialog bind:open={tokenOpen} title={newToken ? 'Your new token' : 'New API token'} width="max-w-md">
	{#if newToken}
		<p class="mb-3 text-xs text-muted-foreground">Copy it now: it isn't shown again. Coffer only keeps a hash of it.</p>
		<CopyField value={newToken} />
	{:else}
		<form id="token-form" class="space-y-3" onsubmit={createToken}>
			<div>
				<label class="label" for="t-name">Name</label>
				<!-- svelte-ignore a11y_autofocus -->
				<input id="t-name" class="input" bind:value={tokenName} placeholder="CLI on my laptop" maxlength="80" autofocus required />
			</div>
			<div>
				<label class="label" for="t-days">Expires</label>
				<select id="t-days" class="input" bind:value={tokenDays}>
					<option value={null}>Never</option>
					<option value={30}>In 30 days</option>
					<option value={90}>In 90 days</option>
					<option value={365}>In a year</option>
				</select>
			</div>
			<label class="flex items-center justify-between gap-2 text-[0.8125rem]">
				<span>Read-only <span class="text-xs text-muted-foreground">(read and share, but not change)</span></span>
				<Switch bind:checked={tokenReadOnly} label="Read-only" />
			</label>
			{#if tokenError}<p class="text-xs text-danger">{tokenError}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		{#if newToken}
			<button class="btn btn-primary" onclick={() => (tokenOpen = false)}>Done</button>
		{:else}
			<button class="btn btn-ghost" onclick={() => (tokenOpen = false)}>Cancel</button>
			<button class="btn btn-primary" form="token-form">Create token</button>
		{/if}
	{/snippet}
</Dialog>

<Dialog bind:open={personOpen} title="Add someone" width="max-w-md">
	<form id="person-form" class="space-y-3" onsubmit={addPerson}>
		<div>
			<label class="label" for="u-email">Email</label>
			<input id="u-email" class="input" type="email" bind:value={pEmail} required />
		</div>
		<div>
			<label class="label" for="u-name">Name</label>
			<input id="u-name" class="input" bind:value={pName} />
		</div>
		<div>
			<label class="label" for="u-role">Role</label>
			<select id="u-role" class="input" bind:value={pRole}><option value="member">Member</option><option value="admin">Admin</option></select>
		</div>
		<div>
			<label class="label" for="u-pw">First password</label>
			<CopyField value={pPassword} />
			<p class="mt-1 text-[0.6875rem] text-muted-foreground">Send it to them (a one-time link works well); they can change it under Settings.</p>
		</div>
		{#if pError}<p class="text-xs text-danger">{pError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (personOpen = false)}>Cancel</button>
		<button class="btn btn-primary" form="person-form">Add</button>
	{/snippet}
</Dialog>
