<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { PageContainer } from "./index.js";

	const { Story } = defineMeta({
		title: "표준 UI/페이지 컨테이너",
		component: PageContainer,
		tags: ["autodocs"],
	});

	const sizes = ["narrow", "default", "wide"] as const;
</script>

<Story name="폭 비교" asChild>
	<div class="grid gap-4">
		{#each sizes as size (size)}
			<PageContainer {size}>
				<div class="bg-muted text-muted-foreground rounded-lg p-3 text-center text-sm">{size}</div>
			</PageContainer>
		{/each}
	</div>
</Story>
