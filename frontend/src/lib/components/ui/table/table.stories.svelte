<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/표",
		component: Table,
		tags: ["autodocs"],
	});

	const rows = [
		{ name: "김하늘", role: "배우", status: "참석" },
		{ name: "이도윤", role: "연출", status: "미정" },
		{ name: "박서연", role: "스태프", status: "불참" },
	];
</script>

<Story name="기본" asChild>
	<Table>
		<TableCaption>이번 주 출석 현황이에요.</TableCaption>
		<TableHeader>
			<TableRow>
				<TableHead>이름</TableHead>
				<TableHead>역할</TableHead>
				<TableHead>응답</TableHead>
			</TableRow>
		</TableHeader>
		<TableBody>
			{#each rows as row (row.name)}
				<TableRow>
					<TableCell>{row.name}</TableCell>
					<TableCell>{row.role}</TableCell>
					<TableCell>{row.status}</TableCell>
				</TableRow>
			{/each}
		</TableBody>
	</Table>
</Story>

<Story name="좁은 폭 (가로 스크롤)" globals={{ viewport: { value: "mobileSmall", isRotated: false } }} asChild>
	<Table class="min-w-[32rem]">
		<TableHeader>
			<TableRow>
				<TableHead>이름</TableHead>
				<TableHead>역할</TableHead>
				<TableHead>응답</TableHead>
				<TableHead>메모</TableHead>
			</TableRow>
		</TableHeader>
		<TableBody>
			{#each rows as row (row.name)}
				<TableRow>
					<TableCell>{row.name}</TableCell>
					<TableCell>{row.role}</TableCell>
					<TableCell>{row.status}</TableCell>
					<TableCell>표가 넓으면 가로로 스크롤돼요.</TableCell>
				</TableRow>
			{/each}
		</TableBody>
	</Table>
</Story>
