<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Tabs, TabsContent, TabsList, TabsTrigger } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/탭",
		component: Tabs,
		tags: ["autodocs"],
	});
</script>

<Story name="기본" asChild>
	<Tabs value="script" class="max-w-md">
		<TabsList>
			<TabsTrigger value="script">대본</TabsTrigger>
			<TabsTrigger value="schedule">일정</TabsTrigger>
			<TabsTrigger value="cast">배역</TabsTrigger>
		</TabsList>
		<TabsContent value="script" class="p-3 text-sm">대본 내용이에요.</TabsContent>
		<TabsContent value="schedule" class="p-3 text-sm">일정 내용이에요.</TabsContent>
		<TabsContent value="cast" class="p-3 text-sm">배역 내용이에요.</TabsContent>
	</Tabs>
</Story>

<Story name="탭이 많을 때 (좁은 폭)" globals={{ viewport: { value: "mobileSmall", isRotated: false } }} asChild>
	<Tabs value="a">
		<TabsList class="overflow-x-auto">
			{#each ["대본", "일정", "배역", "큐시트", "출석", "공지"] as name, i (name)}
				<TabsTrigger value={i === 0 ? "a" : name}>{name}</TabsTrigger>
			{/each}
		</TabsList>
		<TabsContent value="a" class="p-3 text-sm">첫 번째 탭 내용이에요.</TabsContent>
	</Tabs>
</Story>
