<script lang="ts" module>
	import type { BadgeVariant } from "$lib/components/ui/badge";

	export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

	/** tone을 기존 ui/badge variant와 토큰 색으로 옮겨요. 색은 토큰만 써요. */
	export const statusToneMap: Record<StatusTone, { variant: BadgeVariant; class: string }> = {
		neutral: { variant: "secondary", class: "" },
		success: { variant: "secondary", class: "bg-success/10 text-success dark:bg-success/20" },
		warning: { variant: "secondary", class: "bg-warning/10 text-warning dark:bg-warning/20" },
		danger: { variant: "destructive", class: "" },
		info: { variant: "secondary", class: "bg-primary/10 text-primary dark:bg-primary/20" },
	};
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { Badge } from "$lib/components/ui/badge";

	let {
		ref = $bindable(null),
		class: className,
		tone = "neutral",
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		tone?: StatusTone;
	} = $props();

	const mapped = $derived(statusToneMap[tone]);
</script>

<Badge
	bind:ref
	data-slot="status-badge"
	data-tone={tone}
	variant={mapped.variant}
	class={cn(mapped.class, className)}
	{...restProps}
>
	{@render children?.()}
</Badge>
