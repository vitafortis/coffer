<script lang="ts">
	/**
	 * Coffer: a safe's dial, a keyhole inside a ring with the dial's marker on it. Every few seconds
	 * the marker turns right, left, then right again to open, like a combination lock. Still when
	 * `still`, or when motion is turned off; static/favicon.svg is the still frame.
	 */
	let { size = 28, still = false }: { size?: number; still?: boolean } = $props();
	// Gradient ids must be unique per instance; the logo appears more than once on some pages.
	const id = $props.id();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
	<defs>
		<linearGradient id="{id}-tile" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#2a0f1e" />
			<stop offset="1" stop-color="#12060d" />
		</linearGradient>
		<radialGradient id="{id}-ball" cx="0.35" cy="0.35" r="0.75">
			<stop offset="0" stop-color="#ffd1e6" />
			<stop offset="1" stop-color="#e46aa3" />
		</radialGradient>
	</defs>
	<rect width="32" height="32" rx="8" fill="url(#{id}-tile)" />
	<rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#e46aa3" stroke-opacity="0.25" />
	<circle cx="16" cy="16" r="10" fill="none" stroke="#e46aa3" stroke-opacity="0.45" stroke-width="1.5" />
	<circle cx="16" cy="14.4" r="2.7" fill="#fff" />
	<path d="M16 16v4.2" stroke="#fff" stroke-width="2.3" stroke-linecap="round" />
	<g class={still ? '' : 'dial'}>
		<circle cx="23.07" cy="8.93" r="2.8" fill="url(#{id}-ball)" />
	</g>
</svg>

<style>
	/* Right, left, right: each turn eases into a stop, and the last one comes round to where it began. */
	.dial {
		transform-origin: 16px 16px;
		animation: dial 9s cubic-bezier(0.45, 0, 0.2, 1) infinite;
	}
	@keyframes dial {
		0%, 30% { transform: rotate(0deg); }
		42%, 50% { transform: rotate(130deg); }
		60%, 68% { transform: rotate(40deg); }
		84%, 100% { transform: rotate(360deg); }
	}
	@media (prefers-reduced-motion: reduce) {
		.dial {
			animation: none;
		}
	}
</style>
