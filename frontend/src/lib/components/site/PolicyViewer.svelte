<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { policyHref, publicRequest, type LegalDocument, type PolicySummary } from "$lib/api/site";

  let { doc, label = "내용 보기", className = "" }: { doc?: PolicySummary; label?: string; className?: string } = $props();
  let open = $state(false);
  let loading = $state(false);
  let failure = $state("");
  let document = $state<LegalDocument | null>(null);
  let retry = $state(0);

  $effect(() => {
    const selected = doc;
    void retry; // Re-run only when the user explicitly retries.
    if (!open || !selected) return;
    let active = true;
    loading = true;
    failure = "";
    document = null;
    // Read the exact displayed revision, not whichever policy becomes current later.
    void publicRequest<{ document: LegalDocument }>(`/site/policies/${selected.kind}?id=${encodeURIComponent(selected.id)}`)
      .then((result) => {
        if (result.document.id !== selected.id || result.document.kind !== selected.kind || !result.document.publishedAt) throw new Error("요청한 문서를 확인할 수 없어요.");
        if (active) document = result.document;
      })
      .catch(() => { if (active) failure = "본문을 불러오지 못했어요. 다시 불러오거나 새 창에서 확인해 주세요."; })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger type="button" disabled={!doc} aria-label={doc ? `${doc.title} 내용 보기` : label} class={`min-h-9 shrink-0 rounded-md px-2 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 disabled:no-underline disabled:opacity-50 ${className}`}>
    {label}
  </Dialog.Trigger>
  <Dialog.Content showCloseButton={false} class="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" aria-busy={loading}>
    <header class="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
      <div class="min-w-0">
        <Dialog.Title class="pr-1 text-lg leading-7 [word-break:keep-all] [overflow-wrap:anywhere]">{doc?.title || "정책 안내"}</Dialog.Title>
        <Dialog.Description class="sr-only">{doc?.title || "정책"}의 내용을 확인할 수 있어요.</Dialog.Description>
      </div>
      <Button type="button" size="sm" variant="ghost" class="shrink-0" aria-label="약관 모달 닫기" onclick={() => open = false}>닫기</Button>
    </header>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable policy text must remain keyboard-focusable for PageUp/PageDown and arrow-key scrolling.) -->
    <div role="region" aria-label="정책 본문" tabindex="0" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 [word-break:keep-all] [overflow-wrap:anywhere]">
      {#if doc && (doc.purpose || doc.items || doc.retention || doc.refusal)}
        <dl class="mb-6 grid gap-4 rounded-lg border bg-muted/30 p-4 text-sm leading-7">
          {#each [["수집·이용 목적", doc.purpose], ["개인정보 항목", doc.items], ["보유·이용 기간", doc.retention], ["동의 거부권 및 영향", doc.refusal]] as [title, content] (title)}
            {#if content}<div><dt class="text-xs text-muted-foreground">{title}</dt><dd class="whitespace-pre-wrap font-semibold">{content}</dd></div>{/if}
          {/each}
        </dl>
      {/if}
      {#if loading}<p role="status" class="py-8 text-center text-sm text-muted-foreground">본문을 불러오고 있어요.</p>
      {:else if failure}<div role="alert" class="space-y-3 rounded-lg border p-4 text-sm leading-6"><p>{failure}</p><Button type="button" variant="outline" size="sm" onclick={() => retry += 1}>다시 불러오기</Button></div>
      {:else if document}<article class="whitespace-pre-wrap text-sm leading-8">{document.body}</article>{/if}
    </div>
    <footer class="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3 sm:px-6">
      {#if doc}<a href={policyHref(doc)} target="_blank" rel="noopener noreferrer" class="min-h-9 inline-flex items-center text-xs text-muted-foreground underline underline-offset-4">새 창에서 보기</a>{/if}
      <Button type="button" variant="outline" onclick={() => open = false}>닫기</Button>
    </footer>
  </Dialog.Content>
</Dialog.Root>
