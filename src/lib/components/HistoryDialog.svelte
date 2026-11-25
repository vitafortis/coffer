<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Copy, Eye, EyeOff, RotateCcw } from '@lucide/svelte';
	import Dialog from './Dialog.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { copyValue, readValue } from '#lib/client/secrets.ts';
	import { confirmAction, toast } from '#lib/client/state.svelte.ts';
	import { ago, dateTime } from '#lib/client/format.ts';
	import type { Secret, SecretVersion } from '#lib/types.ts';

	let { secret = $bindable() }: { secret: Secret | null } = $props();

	let versions = $state<SecretVersion[]>([]);
	let shown = $state<Record<number, string>>({});

	$effect(() => {
		if (!secret) return;
		shown = {};
		versions = [];
		api.get<{ versions: SecretVersion[] }>(`/api/v1/secrets/${secret.id}/versions`).then((r) => (versions = r.versions)).catch((err) => toast('error', errorMessage(err)));
	});

	async function toggle(v: number) {
		if (shown[v] !== undefined) {
			delete shown[v];
			return;
		}
		try {
			shown[v] = await readValue(secret!.id, v);
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}

	async function restore(v: number) {
		if (!(await confirmAction({ title: `Restore version ${v}?`, body: `${secret!.key} gets version ${v}'s value back, as a new version. Nothing is lost.`, confirmLabel: 'Restore' }))) return;
		try {
			const r = await api.post<{ secret: Secret }>(`/api/v1/secrets/${secret!.id}/restore`, { version: v });
			toast('success', `Restored version ${v}`, `Now version ${r.secret.version}.`);
			secret = null;
			invalidateAll();
		} catch (err) {
			toast('error', errorMessage(err));
		}
	}
</script>

<Dialog bind:open={() => !!secret, (v) => !v && (secret = null)} title="History of {secret?.key ?? ''}" description="Every value it has had (the last 30 are kept). Showing one is logged." width="max-w-2xl">
	<ul class="divide-y divide-border">
		{#each versions as v (v.version)}
			<li class="py-2.5">
				<div class="flex items-center gap-3">
					<span class="badge {v.version === secret?.version ? 'badge-primary' : ''} font-mono">v{v.version}</span>
					<div class="min-w-0 flex-1 text-xs">
						<span title={dateTime(v.createdAt)}>{ago(v.createdAt)}</span>
						{#if v.createdBy}<span class="text-muted-foreground"> · {v.createdBy}</span>{/if}
					</div>
					<button class="btn btn-ghost btn-icon btn-sm" title={shown[v.version] !== undefined ? 'Hide' : 'Show'} onclick={() => toggle(v.version)}>
						{#if shown[v.version] !== undefined}<EyeOff />{:else}<Eye />{/if}
					</button>
					<button class="btn btn-ghost btn-icon btn-sm" title="Copy" onclick={async () => copyValue(shown[v.version] ?? (await readValue(secret!.id, v.version)), `${secret!.key} v${v.version}`)}><Copy /></button>
					{#if v.version !== secret?.version}
						<button class="btn btn-secondary btn-sm" onclick={() => restore(v.version)}><RotateCcw />Restore</button>
					{:else}
						<span class="w-[5.6rem] text-center text-[0.6875rem] text-muted-foreground">Current</span>
					{/if}
				</div>
				{#if shown[v.version] !== undefined}
					<pre class="mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-surface p-2.5 font-mono text-[0.6875rem] break-all whitespace-pre-wrap">{shown[v.version]}</pre>
				{/if}
			</li>
		{/each}
	</ul>
</Dialog>
