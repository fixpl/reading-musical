<script module lang="ts">
	import { defineMeta } from "@storybook/addon-svelte-csf";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import { Button } from "./index.js";

	const { Story } = defineMeta({
		title: "기본 UI/버튼",
		component: Button,
		tags: ["autodocs"],
	});

	const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
	const textSizes = ["xs", "sm", "default", "lg", "touch"] as const;
	const iconSizes = ["icon-xs", "icon-sm", "icon", "icon-lg", "icon-touch"] as const;
</script>

<Story name="기본">
	{#snippet template(args)}
		<Button {...args}>저장해요</Button>
	{/snippet}
</Story>

<Story name="모든 변형과 크기" asChild>
	<div class="grid gap-6">
		{#each variants as variant (variant)}
			<div class="grid gap-2">
				<p class="text-muted-foreground text-xs">{variant}</p>
				<div class="flex flex-wrap items-center gap-2">
					{#each textSizes as size (size)}
						<Button {variant} {size}>{size}</Button>
					{/each}
					{#each iconSizes as size (size)}
						<Button {variant} {size} aria-label="추가해요"><PlusIcon /></Button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</Story>

<Story name="터치 크기 (모바일)" globals={{ viewport: { value: "mobile", isRotated: false } }} asChild>
	<div class="grid gap-2">
		<Button size="touch">터치 버튼 (44px)</Button>
		<Button size="touch" variant="outline">터치 버튼 (윤곽선)</Button>
		<div class="flex gap-2">
			<Button size="icon-touch" variant="secondary" aria-label="추가해요"><PlusIcon /></Button>
			<Button size="icon-touch" variant="ghost" aria-label="추가해요"><PlusIcon /></Button>
		</div>
	</div>
</Story>

<Story name="비활성" asChild>
	<div class="flex flex-wrap gap-2">
		{#each variants as variant (variant)}
			<Button {variant} disabled>{variant}</Button>
		{/each}
	</div>
</Story>

<Story name="링크 버튼" asChild>
	<Button href="#링크" variant="outline">링크로 이동해요</Button>
</Story>
