<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { ErrorPanel } from "./index.js";

	const { Story } = defineMeta({
		title: "표준 UI/오류 패널",
		component: ErrorPanel,
		tags: ["autodocs"],
		args: { message: "불러오지 못했어요." },
	});
</script>

<Story name="메시지만" />

<Story name="다시 시도 버튼 포함" args={{ message: "일정을 불러오지 못했어요.", onRetry: () => {} }} />

<Story
	name="제목 포함"
	args={{ title: "연결이 불안정해요", message: "잠시 뒤에 다시 시도해 주세요.", onRetry: () => {} }}
/>
