<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Skeleton } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/스켈레톤",
		component: Skeleton,
		tags: ["autodocs"],
	});
</script>

<Story name="기본" asChild>
	<Skeleton class="h-4 w-64" />
</Story>

<Story name="카드 모양" asChild>
	<div class="flex items-center gap-3">
		<Skeleton class="size-12 rounded-full" />
		<div class="grid gap-2">
			<Skeleton class="h-4 w-48" />
			<Skeleton class="h-4 w-32" />
		</div>
	</div>
</Story>
