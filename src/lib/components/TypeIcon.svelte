<script lang="ts">
	import { Fingerprint, Key, KeyRound, ShieldCheck, StickyNote, Type } from '@lucide/svelte';
	import type { SecretType } from '#lib/types.ts';

	let { type, class: cls = 'size-4 shrink-0' }: { type: SecretType; class?: string } = $props();
	const icons = { text: Type, password: KeyRound, note: StickyNote, key: Key, certificate: ShieldCheck, keypair: Fingerprint };
	const Icon = $derived(icons[type] ?? Type);
</script>

<Icon class={cls} />
