<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		title,
		description,
		action,
		...restProps
	}: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, "title">> & {
		title: string;
		description?: string;
		action?: Snippet;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty-state"
	class={cn("flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center", className)}
	{...restProps}
>
	<p class="text-base font-semibold">{title}</p>
	{#if description}
		<p class="text-muted-foreground max-w-md text-sm leading-6">{description}</p>
	{/if}
	{#if action}
		<div class="mt-1">
			{@render action()}
		</div>
	{/if}
</div>
