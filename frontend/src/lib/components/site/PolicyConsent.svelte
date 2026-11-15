<script lang="ts">
  import type { PolicySummary } from "$lib/api/site";
  import PolicyViewer from "./PolicyViewer.svelte";
  let { doc, label, checked = $bindable(false), required = false, disabled = false }: { doc?: PolicySummary; label: string; checked?: boolean; required?: boolean; disabled?: boolean } = $props();
</script>

<div class="flex min-h-11 items-center gap-2 py-1 text-sm [word-break:keep-all] [overflow-wrap:anywhere]" data-consent-row>
  <label class="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 leading-6">
    <input type="checkbox" class="size-4 shrink-0 accent-current" bind:checked {required} disabled={disabled || !doc || !doc.publishedAt} />
    <span><span class={required ? "font-semibold" : "text-muted-foreground"}>{required ? "[필수]" : "[선택]"}</span> {label}</span>
  </label>
  <!-- Viewing or closing a policy never toggles this independent checkbox. -->
  <PolicyViewer {doc} label="보기" />
</div>
