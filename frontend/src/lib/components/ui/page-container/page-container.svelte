<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const pageContainerVariants = tv({
		base: "mx-auto min-w-0 w-full",
		variants: {
			size: {
				narrow: "max-w-xl",
				default: "max-w-5xl",
				wide: "max-w-6xl",
			},
		},
		defaultVariants: {
			size: "default",
		},
	});

	export type PageContainerSize = VariantProps<typeof pageContainerVariants>["size"];
</script>

<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		size = "default",
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		size?: PageContainerSize;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="page-container"
	class={cn(pageContainerVariants({ size }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
