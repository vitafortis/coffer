<script lang="ts">
	/**
	 * Coffer: a strongbox with a domed lid, two straps and a lock plate. Every few seconds the lid
	 * lifts on its back hinge and light spills out, then it shuts again. Still when `still`, or when
	 * motion is turned off; static/favicon.svg is the still frame.
	 */
	let { size = 28, still = false }: { size?: number; still?: boolean } = $props();
	// Gradient and clip ids must be unique per instance; the logo appears more than once on some pages.
	const id = $props.id();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
	<defs>
		<linearGradient id="{id}-tile" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#2a0f1e" />
			<stop offset="1" stop-color="#12060d" />
		</linearGradient>
		<linearGradient id="{id}-body" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#e46aa3" />
			<stop offset="1" stop-color="#b83f7a" />
		</linearGradient>
		<linearGradient id="{id}-lid" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#f39cc4" />
			<stop offset="1" stop-color="#d9558f" />
		</linearGradient>
		<radialGradient id="{id}-glow" cx="0.5" cy="1" r="0.8">
			<stop offset="0" stop-color="#ffe9f3" stop-opacity="0.95" />
			<stop offset="1" stop-color="#ffd1e6" stop-opacity="0" />
		</radialGradient>
		<clipPath id="{id}-inside"><rect x="1" y="1" width="30" height="30" rx="7" /></clipPath>
	</defs>
	<rect width="32" height="32" rx="8" fill="url(#{id}-tile)" />
	<rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#e46aa3" stroke-opacity="0.28" />
	<g clip-path="url(#{id}-inside)">
		<!-- light from inside, seen only while the lid is up -->
		<path class={still ? 'hidden-glow' : 'glow'} d="M7 15.6 3 6h26l-4 9.6z" fill="url(#{id}-glow)" />
		<!-- body -->
		<rect x="6" y="15.2" width="20" height="10.8" rx="1.6" fill="url(#{id}-body)" />
		<path d="M10.2 15.2V26M21.8 15.2V26" stroke="#fbd3e5" stroke-opacity="0.85" stroke-width="1.5" />
		<path d="M6.6 23.6h18.8" stroke="#5a1636" stroke-opacity="0.3" stroke-width="0.7" />
		<!-- lid, hinged at the back (its bottom edge) -->
		<g class={still ? '' : 'lid'}>
			<path d="M6 15.4V12.6C6 9.9 8.2 8.4 11 8.4h10c2.8 0 5 1.5 5 4.2v2.8z" fill="url(#{id}-lid)" />
			<path d="M10.2 8.6v6.8M21.8 8.6v6.8" stroke="#fbd3e5" stroke-opacity="0.85" stroke-width="1.5" />
			<path d="M7.2 11.4c.6-1.3 2-1.9 3.6-1.9" stroke="#fff" stroke-opacity="0.55" stroke-width="0.8" stroke-linecap="round" fill="none" />
		</g>
		<!-- lock plate and keyhole -->
		<rect x="13.6" y="13.4" width="4.8" height="5.6" rx="1.1" fill="#fff4f9" />
		<circle cx="16" cy="15.6" r="0.95" fill="#7a1f4a" />
		<path d="M16 16.2v1.6" stroke="#7a1f4a" stroke-width="0.9" stroke-linecap="round" />
		<path d="M3 27.6h26" stroke="#e46aa3" stroke-opacity="0.35" stroke-width="0.8" />
	</g>
</svg>

<style>
	/* The lid swings up on its back hinge (bottom-left of the lid seen from the front) and back. */
	.lid {
		transform-box: fill-box;
		transform-origin: 0% 100%;
		animation: lid 6s cubic-bezier(0.45, 0, 0.3, 1) infinite;
	}
	.glow {
		opacity: 0;
		animation: glow 6s cubic-bezier(0.45, 0, 0.3, 1) infinite;
	}
	.hidden-glow {
		opacity: 0;
	}
	@keyframes lid {
		0%, 52%, 100% { transform: rotate(0deg) translateY(0); }
		62%, 80% { transform: rotate(-14deg) translateY(-0.6px); }
		88% { transform: rotate(0deg); }
	}
	@keyframes glow {
		0%, 54%, 90%, 100% { opacity: 0; }
		64%, 78% { opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.lid,
		.glow {
			animation: none;
		}
	}
</style>
