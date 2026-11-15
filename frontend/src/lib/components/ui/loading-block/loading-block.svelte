<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { Skeleton } from "$lib/components/ui/skeleton";

	let {
		ref = $bindable(null),
		class: className,
		lines = 3,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		lines?: number;
	} = $props();
</script>

<div
	bind:this={ref}
	role="status"
	aria-busy="true"
	aria-label="불러오는 중이에요"
	data-slot="loading-block"
	class={cn("space-y-2", className)}
	{...restProps}
>
	{#each Array(Math.max(1, Math.floor(lines))) as _, i (i)}
		<Skeleton class="h-4 w-full" />
	{/each}
</div>
