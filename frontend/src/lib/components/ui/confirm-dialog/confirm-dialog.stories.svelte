<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { ConfirmDialog } from "./index.js";

	const { Story } = defineMeta({
		title: "표준 UI/확인 대화상자",
		component: ConfirmDialog,
		tags: ["autodocs"],
	});
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";

	let dialog: ConfirmDialog | undefined = $state();
	let result = $state("아직 선택하지 않았어요");

	async function askPlain() {
		const confirmed = await dialog?.ask("이 작업을 계속할까요?", "변경사항 확인", "계속");
		result = confirmed ? "계속을 눌렀어요" : "취소했어요";
	}
	async function askDestructive() {
		const answer = await dialog?.ask({
			title: "공연을 삭제할까요?",
			description: "삭제하면 되돌릴 수 없어요.",
			confirmLabel: "삭제해요",
			destructive: true,
		});
		result = answer?.confirmed ? "삭제를 눌렀어요" : "취소했어요";
	}
	async function askWithReason() {
		const answer = await dialog?.ask({
			title: "일정을 취소할까요?",
			description: "참석자에게 사유가 전달돼요.",
			confirmLabel: "취소해요",
			destructive: true,
			reason: { label: "취소 사유", required: true, placeholder: "사유를 적어 주세요" },
		});
		result = answer?.confirmed ? `취소했어요 (사유: ${answer.reason})` : "닫았어요";
	}
</script>

<Story name="기본, 삭제, 사유 입력" asChild>
	<div class="grid gap-3">
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={askPlain}>일반 확인</Button>
			<Button variant="destructive" onclick={askDestructive}>삭제 확인</Button>
			<Button variant="outline" onclick={askWithReason}>사유 입력 확인</Button>
		</div>
		<p class="text-muted-foreground text-sm" aria-live="polite">{result}</p>
		<ConfirmDialog bind:this={dialog} />
	</div>
</Story>
