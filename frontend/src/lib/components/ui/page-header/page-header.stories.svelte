<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { PageHeader } from "./index.js";
	import { Button } from "$lib/components/ui/button";

	const { Story } = defineMeta({
		title: "표준 UI/페이지 머리글",
		component: PageHeader,
		tags: ["autodocs"],
		args: { title: "일정" },
	});
</script>

<Story name="제목만" args={{ title: "알림" }} />

<Story name="설명 포함" args={{ title: "일정", description: "이번 달 리허설과 공연 일정을 확인해요." }} />

<Story name="우측 액션 포함" asChild>
	<PageHeader title="배역 관리" description="배역과 배우를 연결해요.">
		{#snippet actions()}
			<Button variant="outline">가져오기</Button>
			<Button>배역 추가</Button>
		{/snippet}
	</PageHeader>
</Story>

<Story name="모바일 폭" globals={{ viewport: { value: "mobile", isRotated: false } }} asChild>
	<PageHeader title="배역 관리" description="배역과 배우를 연결해요.">
		{#snippet actions()}
			<Button variant="outline" class="flex-1">가져오기</Button>
			<Button class="flex-1">배역 추가</Button>
		{/snippet}
	</PageHeader>
</Story>
