<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { Button } from "$lib/components/ui/button";

	let {
		ref = $bindable(null),
		class: className,
		title,
		message,
		onRetry,
		...restProps
	}: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, "title">> & {
		title?: string;
		message: string;
		onRetry?: () => void;
	} = $props();
</script>

<div
	bind:this={ref}
	role="alert"
	data-slot="error-panel"
	class={cn("bg-card flex flex-col items-center gap-3 rounded-2xl border p-8 text-center", className)}
	{...restProps}
>
	{#if title}
		<p class="text-base font-semibold">{title}</p>
	{/if}
	<p class={title ? "text-muted-foreground max-w-md text-sm leading-6" : "text-destructive max-w-md text-sm leading-6"}>{message}</p>
	{#if onRetry}
		<Button size="touch" variant="outline" onclick={onRetry}>다시 시도</Button>
	{/if}
</div>
