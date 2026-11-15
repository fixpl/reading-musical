<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Input } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/입력",
		component: Input,
		tags: ["autodocs"],
	});
</script>

<Story name="기본">
	{#snippet template(args)}
		<Input {...args} placeholder="이름을 입력해 주세요" aria-label="이름" />
	{/snippet}
</Story>

<Story name="여러 상태" asChild>
	<div class="grid max-w-sm gap-3">
		<Input placeholder="비어 있어요" aria-label="비어 있는 입력" />
		<Input value="입력한 값이에요" aria-label="값이 있는 입력" />
		<Input disabled value="수정할 수 없어요" aria-label="비활성 입력" />
		<Input aria-invalid="true" value="잘못된 값이에요" aria-label="오류가 있는 입력" />
		<Input type="date" aria-label="날짜" />
		<Input type="password" value="비밀번호" aria-label="비밀번호" />
		<Input type="file" aria-label="파일" />
	</div>
</Story>
