<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';

	async function setup(email: string, password: string) {
		try {
			await api.post('/api/auth/setup', { email, password });
			await invalidateAll();
			goto('/?new');
		} catch (err) {
			return errorMessage(err);
		}
	}
</script>

<svelte:head><title>Set up · Coffer</title></svelte:head>

<AuthCard
	title="Set up Coffer"
	subtitle="Create the first account. It's an admin: it can add the rest of the team."
	cta="Create account"
	confirm
	hint="Secrets are encrypted with a key in the data folder (or COFFER_SECRET_KEY). Back that key up separately from the database, and keep Coffer on your LAN, a VPN, or behind your reverse proxy."
	onsubmit={setup}
/>
