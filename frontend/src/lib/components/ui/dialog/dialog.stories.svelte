<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./index.js";
	import { buttonVariants } from "$lib/components/ui/button";
	import { Button } from "$lib/components/ui/button";

	const { Story } = defineMeta({
		title: "기본 UI/대화상자",
		component: Dialog,
		tags: ["autodocs"],
	});
</script>

<Story name="기본" asChild>
	<Dialog>
		<DialogTrigger class={buttonVariants({ variant: "outline" })}>대화상자 열기</DialogTrigger>
		<DialogContent>
			<DialogHeader>
				<DialogTitle>공연 정보를 수정해요</DialogTitle>
				<DialogDescription>바꾼 내용은 저장하면 바로 반영돼요.</DialogDescription>
			</DialogHeader>
			<p class="text-sm">여기에 폼이나 안내 문구를 넣어요.</p>
			<DialogFooter showCloseButton>
				<Button>저장해요</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
</Story>

<Story name="처음부터 열려 있어요 (모바일)" globals={{ viewport: { value: "mobile", isRotated: false } }} asChild>
	<Dialog open>
		<DialogContent>
			<DialogHeader>
				<DialogTitle>모바일 폭에서 확인해요</DialogTitle>
				<DialogDescription>좁은 화면에서도 가장자리 여백이 남아야 해요.</DialogDescription>
			</DialogHeader>
			<DialogFooter showCloseButton />
		</DialogContent>
	</Dialog>
</Story>
