<script lang="ts">
  import { invalidate } from "$app/navigation";
  import type { FaqCategory } from "$lib/api/site";
  let { categories, errorMessage = "" }: { categories: FaqCategory[]; errorMessage?: string } = $props();
  let selected = $state("all");
  let query = $state("");
  const tabs = $derived([{ id: "all", name: "전체", count: categories.reduce((sum, item) => sum + item.questions.length, 0) }, ...categories.map((item) => ({ id: item.id, name: item.name, count: item.questions.length }))]);
  const questions = $derived(categories.filter((item) => selected === "all" || selected === item.id).flatMap((item) => item.questions.map((question) => ({ ...question, categoryName: item.name }))).filter((item) => `${item.title} ${item.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  $effect(() => { if (selected !== "all" && !categories.some((item) => item.id === selected)) selected = "all"; });
  function moveTab(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault(); selected = tabs[next].id;
    document.getElementById(`faq-tab-${selected}`)?.focus();
  }
</script>
<div class="grid gap-5">
  <label class="grid gap-2 text-sm font-medium">질문 검색<input type="search" class="h-11 rounded-lg border bg-background px-3 font-normal" placeholder="궁금한 내용을 입력해 주세요" maxlength={100} bind:value={query} /></label>
  {#if errorMessage}<p class="rounded-lg border p-4 text-sm" role="alert">{errorMessage} <button type="button" class="ml-2 underline" onclick={() => invalidate("site:faq")}>다시 불러오기</button></p>{/if}
  <div role="tablist" aria-label="FAQ 카테고리" class="flex gap-2 overflow-x-auto pb-2">
    {#each tabs as tab, index (tab.id)}
      <button type="button" role="tab" id={`faq-tab-${tab.id}`} aria-selected={selected === tab.id} aria-controls="faq-panel" tabindex={selected === tab.id ? 0 : -1} class="min-h-11 shrink-0 rounded-full border px-4 text-sm data-[active=true]:bg-primary data-[active=true]:text-primary-foreground" data-active={selected === tab.id} onclick={() => selected = tab.id} onkeydown={(event) => moveTab(event, index)}>{tab.name} <span class="ml-1 text-xs">{tab.count}</span></button>
    {/each}
  </div>
  <div id="faq-panel" role="tabpanel" aria-labelledby={`faq-tab-${selected}`} tabindex="0" class="divide-y rounded-xl border px-5">
    {#each questions as item (item.id)}
      <details class="group py-5"><summary class="cursor-pointer text-sm font-semibold leading-7 [word-break:keep-all] [overflow-wrap:anywhere]">{#if selected === "all"}<span class="mr-2 text-xs font-normal text-muted-foreground">{item.categoryName}</span>{/if}{item.title}</summary><p class="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground [word-break:keep-all] [overflow-wrap:anywhere]">{item.body}</p></details>
    {:else}<p class="py-8 text-center text-sm text-muted-foreground">{errorMessage ? "연결을 확인한 뒤 다시 불러와 주세요." : query ? "검색 결과가 없어요. 다른 단어로 검색해 주세요." : "등록된 질문이 없어요. 운영팀에 문의해 주세요."}</p>{/each}
  </div>
  <p class="text-sm text-muted-foreground">찾는 답변이 없나요? <a href="/support" class="ml-1 font-medium text-foreground underline underline-offset-4">운영팀에 문의하기</a></p>
</div>
