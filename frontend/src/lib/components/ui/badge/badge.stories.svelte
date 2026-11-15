<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Badge } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/배지",
		component: Badge,
		tags: ["autodocs"],
	});

	const variants = ["default", "secondary", "destructive", "outline", "ghost", "link"] as const;
</script>

<Story name="기본">
	{#snippet template(args)}
		<Badge {...args}>확정</Badge>
	{/snippet}
</Story>

<Story name="모든 변형" asChild>
	<div class="flex flex-wrap items-center gap-2">
		{#each variants as variant (variant)}
			<Badge {variant}>{variant}</Badge>
		{/each}
	</div>
</Story>
