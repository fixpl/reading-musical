<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./index.js";
	import { Button } from "$lib/components/ui/button";

	const { Story } = defineMeta({
		title: "기본 UI/카드",
		component: Card,
		tags: ["autodocs"],
	});
</script>

<Story name="기본" asChild>
	<Card class="max-w-sm">
		<CardHeader>
			<CardTitle>리딩 공연 1회차</CardTitle>
			<CardDescription>10월 30일 오후 7시, 연습실 A</CardDescription>
		</CardHeader>
		<CardContent class="text-sm">출석 응답을 기다리고 있어요.</CardContent>
		<CardFooter>
			<Button size="sm">응답하기</Button>
		</CardFooter>
	</Card>
</Story>

<Story name="우측 액션 포함" asChild>
	<Card class="max-w-sm">
		<CardHeader>
			<CardTitle>알림</CardTitle>
			<CardDescription>새 소식이 있어요.</CardDescription>
			<CardAction>
				<Button size="sm" variant="outline">모두 읽음</Button>
			</CardAction>
		</CardHeader>
		<CardContent class="text-sm">읽지 않은 알림이 3건 있어요.</CardContent>
	</Card>
</Story>
