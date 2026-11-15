<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import { Select, SelectContent, SelectItem, SelectTrigger } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/선택",
		component: Select,
		tags: ["autodocs"],
	});

	const roles = [
		{ value: "DIRECTOR", label: "연출가" },
		{ value: "ACTOR", label: "배우" },
		{ value: "STAFF", label: "스태프" },
	];
</script>

<script lang="ts">
	let role = $state("ACTOR");
	const roleLabel = $derived(roles.find((item) => item.value === role)?.label ?? "선택해 주세요");
</script>

<Story name="기본" asChild>
	<Select type="single" bind:value={role}>
		<SelectTrigger class="w-48" aria-label="역할">{roleLabel}</SelectTrigger>
		<SelectContent>
			{#each roles as item (item.value)}
				<SelectItem value={item.value} label={item.label} />
			{/each}
		</SelectContent>
	</Select>
</Story>

<Story name="작은 크기와 비활성" asChild>
	<div class="grid gap-3">
		<Select type="single" value="ACTOR">
			<SelectTrigger size="sm" class="w-48" aria-label="역할 (작게)">배우</SelectTrigger>
			<SelectContent>
				{#each roles as item (item.value)}
					<SelectItem value={item.value} label={item.label} />
				{/each}
			</SelectContent>
		</Select>
		<Select type="single" disabled>
			<SelectTrigger class="w-48" aria-label="역할 (비활성)">선택할 수 없어요</SelectTrigger>
			<SelectContent>
				<SelectItem value="ACTOR" label="배우" />
			</SelectContent>
		</Select>
	</div>
</Story>
