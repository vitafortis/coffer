<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { LoaderCircle } from '@lucide/svelte';
	import Dialog from './Dialog.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { toast } from '#lib/client/state.svelte.ts';
	import { slugify } from '#lib/paths.ts';
	import type { Project } from '#lib/types.ts';

	/** New project, or rename one. */
	let { open = $bindable(false), project = null }: { open: boolean; project?: Project | null } = $props();

	let name = $state('');
	let slug = $state('');
	let slugEdited = $state(false);
	let description = $state('');
	let envs = $state('Development, Staging, Production');
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		if (!open) return;
		name = project?.name ?? '';
		slug = project?.slug ?? '';
		slugEdited = !!project;
		description = project?.description ?? '';
		envs = 'Development, Staging, Production';
		error = '';
	});

	$effect(() => {
		if (!slugEdited) slug = slugify(name);
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			if (project) {
				const r = await api.patch<{ project: Project }>(`/api/v1/projects/${project.id}`, { name, slug, description });
				open = false;
				await goto(`/p/${r.project.slug}`, { replaceState: true, invalidateAll: true });
			} else {
				const r = await api.post<{ project: Project }>('/api/v1/projects', {
					name,
					slug,
					description: description || undefined,
					environments: envs.split(',').map((s) => s.trim()).filter(Boolean)
				});
				open = false;
				toast('success', `Made ${r.project.name}`);
				await invalidateAll();
				goto(`/p/${r.project.slug}`);
			}
		} catch (err) {
			error = errorMessage(err);
		}
		busy = false;
	}
</script>

<Dialog bind:open title={project ? 'Project settings' : 'New project'} description={project ? undefined : 'A project holds the secrets for one app, service or system, per environment.'}>
	<form id="project-form" class="space-y-4" onsubmit={save}>
		<div>
			<label class="label" for="p-name">Name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="p-name" class="input" bind:value={name} maxlength="80" placeholder="Billing API" autofocus required />
		</div>
		<div>
			<label class="label" for="p-slug">Short name <span class="font-normal">(for the CLI: <span class="hash">coffer get KEY -p {slug || 'billing-api'}</span>)</span></label>
			<input id="p-slug" class="input font-mono text-xs" bind:value={slug} oninput={() => (slugEdited = true)} maxlength="48" pattern="[a-z0-9][a-z0-9\-]*" required />
		</div>
		<div>
			<label class="label" for="p-desc">Description</label>
			<input id="p-desc" class="input" bind:value={description} maxlength="500" placeholder="Optional" />
		</div>
		{#if !project}
			<div>
				<label class="label" for="p-envs">Environments</label>
				<input id="p-envs" class="input" bind:value={envs} />
				<p class="mt-1 text-[0.6875rem] text-muted-foreground">Comma-separated. You can add, rename and remove them later.</p>
			</div>
		{/if}
		{#if error}<p class="text-xs text-danger">{error}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (open = false)}>Cancel</button>
		<button class="btn btn-primary" form="project-form" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}{project ? 'Save' : 'Create project'}</button>
	{/snippet}
</Dialog>
