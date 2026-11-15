<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { LoadingBlock } from "./index.js";

	const { Story } = defineMeta({
		title: "표준 UI/불러오는 중",
		component: LoadingBlock,
		tags: ["autodocs"],
		args: { lines: 3 },
	});
</script>

<Story name="기본 (3줄)" />

<Story name="한 줄" args={{ lines: 1 }} />

<Story name="여섯 줄" args={{ lines: 6 }} />
