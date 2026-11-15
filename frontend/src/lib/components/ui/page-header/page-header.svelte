<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		title,
		description,
		actions,
		...restProps
	}: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, "title">> & {
		title: string;
		description?: string;
		actions?: Snippet;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="page-header"
	class={cn("flex min-w-0 flex-wrap items-start gap-3 py-2", className)}
	{...restProps}
>
	<div class="min-w-0 flex-1">
		<h1 class="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{title}</h1>
		{#if description}
			<p class="text-muted-foreground mt-1 max-w-2xl text-sm leading-6">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex w-full flex-wrap items-center gap-2 sm:ms-auto sm:w-auto">
			{@render actions()}
		</div>
	{/if}
</div>
