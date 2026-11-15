<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { Label } from "$lib/components/ui/label";

	let {
		ref = $bindable(null),
		class: className,
		label,
		for: forId,
		hint,
		error,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		label: string;
		for: string;
		hint?: string;
		error?: string;
		children: Snippet;
	} = $props();
</script>

<div bind:this={ref} data-slot="form-field" class={cn("grid gap-2", className)} {...restProps}>
	<Label for={forId}>{label}</Label>
	{@render children()}
	{#if error}
		<p id="{forId}-error" role="alert" class="text-destructive text-xs">{error}</p>
	{:else if hint}
		<p id="{forId}-hint" class="text-muted-foreground text-xs">{hint}</p>
	{/if}
</div>
