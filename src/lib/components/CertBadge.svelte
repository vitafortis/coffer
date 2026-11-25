<script lang="ts">
	import type { CertInfo } from '#lib/types.ts';

	/** How long a certificate has left: red when expired, amber inside 30 days. */
	let { cert }: { cert: CertInfo } = $props();
	const days = $derived(Math.floor((Date.parse(cert.validTo) - Date.now()) / 86_400_000));
</script>

<span
	class="badge {days < 0 ? 'badge-danger' : days < 30 ? 'badge-warning' : ''}"
	title="Valid {new Date(cert.validFrom).toLocaleDateString()} – {new Date(cert.validTo).toLocaleDateString()}"
>
	{#if days < 0}Expired {-days}d ago{:else if days === 0}Expires today{:else}{days}d left{/if}
</span>
{#if cert.ca}<span class="badge badge-primary">CA</span>{/if}
