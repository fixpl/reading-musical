<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Textarea } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/여러 줄 입력",
		component: Textarea,
		tags: ["autodocs"],
	});
</script>

<Story name="기본">
	{#snippet template(args)}
		<Textarea {...args} placeholder="메모를 남겨 주세요" aria-label="메모" rows={4} />
	{/snippet}
</Story>

<Story name="여러 상태" asChild>
	<div class="grid max-w-sm gap-3">
		<Textarea value="입력한 내용이에요" aria-label="값이 있는 입력" />
		<Textarea disabled value="수정할 수 없어요" aria-label="비활성 입력" />
		<Textarea aria-invalid="true" value="잘못된 내용이에요" aria-label="오류가 있는 입력" />
	</div>
</Story>
