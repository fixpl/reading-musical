<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { FormField } from "./index.js";
	import { Input } from "$lib/components/ui/input";
	import { Textarea } from "$lib/components/ui/textarea";

	const { Story } = defineMeta({
		title: "표준 UI/폼 필드",
		component: FormField,
		tags: ["autodocs"],
	});
</script>

<Story name="기본" asChild>
	<FormField label="공연 이름" for="field-title" class="max-w-sm">
		<Input id="field-title" placeholder="예: 겨울 낭독극" />
	</FormField>
</Story>

<Story name="도움말 포함" asChild>
	<FormField label="연락처" for="field-phone" hint="공연 안내 문자를 받을 번호예요." class="max-w-sm">
		<Input id="field-phone" type="tel" aria-describedby="field-phone-hint" />
	</FormField>
</Story>

<Story name="오류 포함" asChild>
	<FormField label="이메일" for="field-email" error="이메일 형식이 올바르지 않아요." class="max-w-sm">
		<Input id="field-email" value="abc" aria-invalid="true" aria-describedby="field-email-error" />
	</FormField>
</Story>

<Story name="여러 줄 입력" asChild>
	<FormField label="메모" for="field-memo" hint="제작진만 볼 수 있어요." class="max-w-sm">
		<Textarea id="field-memo" rows={3} aria-describedby="field-memo-hint" />
	</FormField>
</Story>
