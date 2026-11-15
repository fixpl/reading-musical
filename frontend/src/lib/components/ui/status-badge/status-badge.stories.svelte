<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { StatusBadge, type StatusTone } from "./index.js";

	const { Story } = defineMeta({
		title: "표준 UI/상태 배지",
		component: StatusBadge,
		tags: ["autodocs"],
	});

	const tones: { tone: StatusTone; label: string }[] = [
		{ tone: "neutral", label: "대기" },
		{ tone: "success", label: "참석" },
		{ tone: "warning", label: "미정" },
		{ tone: "danger", label: "불참" },
		{ tone: "info", label: "안내" },
	];
</script>

<Story name="기본">
	{#snippet template(args)}
		<StatusBadge {...args}>참석</StatusBadge>
	{/snippet}
</Story>

<Story name="모든 톤" asChild>
	<div class="flex flex-wrap items-center gap-2">
		{#each tones as item (item.tone)}
			<StatusBadge tone={item.tone}>{item.label}</StatusBadge>
		{/each}
	</div>
</Story>
