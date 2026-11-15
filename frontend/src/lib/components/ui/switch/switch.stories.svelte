<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Switch } from "./index.js";
	import { Label } from "$lib/components/ui/label";

	const { Story } = defineMeta({
		title: "기본 UI/스위치",
		component: Switch,
		tags: ["autodocs"],
	});
</script>

<Story name="기본">
	{#snippet template(args)}
		<div class="flex items-center gap-2">
			<Switch {...args} id="switch-default" />
			<Label for="switch-default">알림을 받아요</Label>
		</div>
	{/snippet}
</Story>

<Story name="여러 상태" asChild>
	<div class="grid gap-3">
		<div class="flex items-center gap-2">
			<Switch id="switch-off" />
			<Label for="switch-off">꺼져 있어요</Label>
		</div>
		<div class="flex items-center gap-2">
			<Switch id="switch-on" checked />
			<Label for="switch-on">켜져 있어요</Label>
		</div>
		<div class="flex items-center gap-2">
			<Switch id="switch-disabled" disabled />
			<Label for="switch-disabled">비활성이에요</Label>
		</div>
		<div class="flex items-center gap-2">
			<Switch id="switch-disabled-on" disabled checked />
			<Label for="switch-disabled-on">켜진 채 비활성이에요</Label>
		</div>
	</div>
</Story>
