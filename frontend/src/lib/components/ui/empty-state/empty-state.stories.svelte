<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { EmptyState } from "./index.js";
	import { Button } from "$lib/components/ui/button";

	const { Story } = defineMeta({
		title: "표준 UI/빈 화면",
		component: EmptyState,
		tags: ["autodocs"],
		args: { title: "아직 일정이 없어요" },
	});
</script>

<Story name="제목만" />

<Story name="설명 포함" args={{ title: "아직 일정이 없어요", description: "일정을 추가하면 여기에 보여요." }} />

<Story name="액션 포함" asChild>
	<EmptyState title="아직 배역이 없어요" description="배역을 추가하고 배우를 연결해 보세요.">
		{#snippet action()}
			<Button size="sm">배역 추가</Button>
		{/snippet}
	</EmptyState>
</Story>
