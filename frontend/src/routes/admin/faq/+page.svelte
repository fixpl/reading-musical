<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { beforeNavigate, invalidate } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { apiRequest } from "$lib/api/client";
  import type { FaqCategory, FaqQuestion } from "$lib/api/site";
  import { categoryDraft, questionDraft, sortFaq, applySavedCategory, applySavedQuestion, validOrder } from "$lib/domain/admin-faq";
  import AdminSiteNav from "$lib/components/admin/AdminSiteNav.svelte";
  import ConfirmAction from "$lib/components/admin/ConfirmAction.svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Tabs from "$lib/components/ui/tabs";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import RefreshIcon from "@lucide/svelte/icons/refresh-cw";

  let categories = $state<FaqCategory[]>([]);
  let view = $state("questions");
  let filter = $state("all");
  let query = $state("");
  let loading = $state(true);
  let loaded = $state(false);
  let listError = $state("");
  let feedback = $state("");
  let editorOpen = $state(false);
  let editorKind = $state<"question" | "category">("question");
  let question = $state(questionDraft());
  let category = $state(categoryDraft());
  let baseline = $state("");
  let saving = $state(false);
  let formError = $state("");
  let conflict = $state(false);
  let confirmation: { ask: (message: string, heading?: string, acceptLabel?: string) => Promise<boolean> };
  let firstInput = $state<HTMLInputElement | null>(null);
  let returnFocus: HTMLElement | null = null;
  let loadSequence = 0;
  const currentDraft = $derived(JSON.stringify(editorKind === "question" ? question : category));
  const dirty = $derived(editorOpen && baseline !== currentDraft);
  const editingId = $derived(editorKind === "question" ? question.id : category.id);
  const editorTitle = $derived(`${editorKind === "question" ? "질문" : "분류"} ${editingId ? "수정" : "등록"}`);
  const selectedCategory = $derived(categories.find((item) => item.id === question.categoryId));
  const totalQuestions = $derived(categories.reduce((sum, item) => sum + item.questions.length, 0));
  const visible = $derived(categories.filter((item) => filter === "all" || item.id === filter).map((item) => ({ ...item,
    questions: item.questions.filter((entry) => `${entry.title} ${entry.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  })));
  const visibleCount = $derived(visible.reduce((sum, item) => sum + item.questions.length, 0));

  beforeNavigate(({ cancel, willUnload }) => {
    if (saving) { cancel(); return; }
    if (!dirty) return;
    // Browser-level page exits retain native unload protection; in-page actions use AlertDialog.
    if (willUnload || !window.confirm("저장하지 않은 내용이 있어요. 이동할까요?")) cancel();
  });
  onMount(() => { void load(); });
  onDestroy(() => { loadSequence += 1; });

  async function load(): Promise<FaqCategory[] | null> {
    const sequence = ++loadSequence;
    loading = true; listError = "";
    try {
      const result = sortFaq(await apiRequest<FaqCategory[]>("/admin/site/faq"));
      if (sequence !== loadSequence) return null;
      categories = result; loaded = true;
      if (filter !== "all" && !result.some((item) => item.id === filter)) filter = "all";
      return result;
    } catch (error) {
      if (sequence === loadSequence) listError = error instanceof Error ? error.message : "목록을 불러오지 못했어요.";
      return null;
    } finally { if (sequence === loadSequence) loading = false; }
  }
  function openQuestion(value: FaqQuestion | undefined, trigger: HTMLElement) {
    if (saving || loading) return;
    editorKind = "question";
    question = questionDraft(value, filter !== "all" ? filter : categories[0]?.id || "");
    baseline = JSON.stringify(question); formError = ""; conflict = false;
    returnFocus = trigger; editorOpen = true;
  }
  function openCategory(value: FaqCategory | undefined, trigger: HTMLElement) {
    if (saving || loading) return;
    editorKind = "category"; category = categoryDraft(value);
    baseline = JSON.stringify(category); formError = ""; conflict = false;
    returnFocus = trigger; editorOpen = true;
  }
  async function closeEditor() {
    if (saving) return;
    if (dirty && !await confirmation.ask("저장하지 않은 내용을 버리고 닫을까요?", "편집 취소", "변경사항 버리기")) return;
    editorOpen = false;
  }
  async function reloadEditor() {
    if (saving || loading) return;
    if (dirty && !await confirmation.ask("입력한 내용을 저장된 최신 내용으로 바꿀까요?", "최신 내용 불러오기", "불러오기")) return;
    const data = await load();
    if (!data) { formError = "최신 내용을 불러오지 못했어요. 입력한 내용은 그대로 있어요."; return; }
    if (editorKind === "question") {
      const latest = data.flatMap((item) => item.questions).find((item) => item.id === question.id);
      if (!latest) { formError = "해당 질문을 찾을 수 없어요. 목록을 확인해 주세요."; return; }
      question = questionDraft(latest);
    } else {
      const latest = data.find((item) => item.id === category.id);
      if (!latest) { formError = "해당 분류를 찾을 수 없어요."; return; }
      category = categoryDraft(latest);
    }
    baseline = currentDraft; formError = ""; conflict = false;
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || loading || (editingId && !dirty)) return;
    formError = ""; conflict = false;
    const value = editorKind === "question" ? question : category;
    if (!validOrder(value.order)) { formError = "순서는 0부터 100,000 사이의 정수로 입력해 주세요."; return; }
    if (editorKind === "question" && (!question.title.trim() || !question.body.trim() || !selectedCategory)) {
      formError = "분류, 질문 제목과 답변을 입력해 주세요."; return;
    }
    if (editorKind === "category" && !category.name.trim()) { formError = "분류 이름을 입력해 주세요."; return; }
    saving = true;
    try {
      if (editorKind === "question") {
        const { id, categoryId, title, body, order, active, revision } = question;
        const saved = await apiRequest<FaqQuestion>(`/admin/site/faq/questions${id ? `/${id}` : ""}`, {
          method: id ? "PATCH" : "POST", body: JSON.stringify({ categoryId, title: title.trim(), body: body.trim(), order, active, ...(id ? { revision } : {}) })
        });
        categories = applySavedQuestion(categories, saved);
        if (filter !== "all" && filter !== saved.categoryId) filter = saved.categoryId;
        query = "";
        feedback = `‘${saved.title}’ 질문을 저장했어요.`;
      } else {
        const { id, name, order, active, revision } = category;
        const saved = await apiRequest<Omit<FaqCategory, "questions">>(`/admin/site/faq/categories${id ? `/${id}` : ""}`, {
          method: id ? "PATCH" : "POST", body: JSON.stringify({ name: name.trim(), order, active, ...(id ? { revision } : {}) })
        });
        categories = applySavedCategory(categories, saved);
        feedback = `‘${saved.name}’ 분류를 저장했어요.`;
      }
      baseline = currentDraft; editorOpen = false;
      toast.success(feedback);
      void invalidate("site:faq").catch(() => { /* The confirmed save remains valid if a public view refresh fails. */ });
    } catch (error) {
      formError = error instanceof Error ? error.message : "저장하지 못했어요. 입력한 내용은 그대로 있어요.";
      conflict = Boolean(error && typeof error === "object" && "status" in error && error.status === 409);
    } finally { saving = false; }
  }
</script>

<ConfirmAction bind:this={confirmation} />
<div class="mx-auto w-full max-w-6xl space-y-6 [word-break:keep-all] [overflow-wrap:anywhere]">
  <PageHeader title="자주 묻는 질문 관리" description="분류를 만든 뒤 질문과 답변을 등록해요. 공개 여부와 표시 순서도 설정할 수 있어요.">{#snippet actions()}<Button href="/faq" target="_blank" rel="noopener noreferrer" variant="outline">공개된 질문 보기</Button>{/snippet}</PageHeader>
  <AdminSiteNav />
  {#if listError}<ErrorPanel title="질문 목록을 불러오지 못했어요" message={listError} onRetry={() => { void load(); }} />{#if loaded}<p class="text-muted-foreground text-xs">아래는 이전에 불러온 내용이에요.</p>{/if}{/if}
  <p role="status" class="sr-only">{feedback}</p>
  <Tabs.Root bind:value={view}>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Tabs.List aria-label="FAQ 관리 항목" class="h-auto flex-wrap"><Tabs.Trigger value="questions" class="min-h-11">질문 <span class="text-xs">{totalQuestions}</span></Tabs.Trigger><Tabs.Trigger value="categories" class="min-h-11">분류 <span class="text-xs">{categories.length}</span></Tabs.Trigger></Tabs.List>
      <Button type="button" variant="ghost" disabled={loading || saving} onclick={load}><RefreshIcon class="size-4" aria-hidden="true" />새로고침</Button>
    </div>
    <Tabs.Content value="questions">
      <div class="space-y-5">
        <div class="flex flex-wrap items-end gap-3">
          <div class="grid w-full gap-2 sm:w-48"><Label for="faq-filter">분류</Label><Select.Root type="single" bind:value={filter}><Select.Trigger id="faq-filter" class="min-h-11 w-full">{filter === "all" ? "전체" : categories.find((item) => item.id === filter)?.name || "전체"}</Select.Trigger><Select.Content><Select.Item value="all" label="전체" />{#each categories as item (item.id)}<Select.Item value={item.id} label={item.name} />{/each}</Select.Content></Select.Root></div>
          <div class="grid min-w-0 flex-1 gap-2"><Label for="faq-search">질문 검색</Label><Input id="faq-search" type="search" class="min-h-11" placeholder="제목 또는 답변 검색" bind:value={query} maxlength={100} /></div>
          <Button id="faq-new-question" type="button" class="min-h-11" disabled={loading || !loaded || !categories.length} onclick={(event) => openQuestion(undefined, event.currentTarget)}><PlusIcon class="size-4" aria-hidden="true" />질문 등록</Button>
        </div>
        {#if loading && !loaded}<div aria-label="FAQ 불러오는 중" class="space-y-3"><Skeleton class="h-20 w-full" /><Skeleton class="h-20 w-full" /></div>
        {:else if !listError && visibleCount === 0}<EmptyState title={!categories.length ? "먼저 질문 분류를 만들어 주세요" : query || filter !== "all" ? "조건에 맞는 질문이 없어요" : "아직 등록된 질문이 없어요"} description={!categories.length ? "예를 들어 이용 방법, 회원·계정처럼 질문을 묶을 분류를 만들어요." : query || filter !== "all" ? "검색어나 분류를 바꿔 다시 찾아보세요." : "자주 받는 질문과 답변을 등록해 보세요."}>{#snippet action()}{#if !categories.length}<Button type="button" onclick={(event) => openCategory(undefined, event.currentTarget)}>첫 분류 등록</Button>{:else if query || filter !== "all"}<Button type="button" variant="outline" onclick={() => { query = ""; filter = "all"; }}>검색 조건 지우기</Button>{/if}{/snippet}</EmptyState>
        {:else}<div class="space-y-5">{#each visible as item (item.id)}{#if item.questions.length}<section class="overflow-hidden rounded-xl border" aria-label={item.name}><header class="flex items-center gap-3 bg-muted/25 px-5 py-3"><h2 class="text-sm font-semibold">{item.name}</h2><Badge variant="outline">{item.questions.length}개</Badge>{#if !item.active}<Badge variant="secondary">분류 숨김</Badge>{/if}</header><div class="divide-y">{#each item.questions as entry (entry.id)}<article class="flex items-start gap-3 p-5" data-faq-question={entry.id}><details class="min-w-0 flex-1"><summary class="cursor-pointer text-sm font-medium leading-7">{entry.title}</summary><p class="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{entry.body}</p></details><div class="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center"><Badge variant={entry.active && item.active ? "secondary" : "outline"}>{entry.active && item.active ? "공개" : "숨김"}</Badge><span class="hidden text-xs text-muted-foreground sm:inline">순서 {entry.order}</span><Button type="button" size="sm" variant="outline" disabled={loading || saving} aria-label={`${entry.title} 수정`} onclick={(event) => openQuestion(entry, event.currentTarget)}><PencilIcon class="size-3.5" aria-hidden="true" />수정</Button></div></article>{/each}</div></section>{/if}{/each}</div>{/if}
      </div>
    </Tabs.Content>
    <Tabs.Content value="categories">
      <div class="space-y-4"><div class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm text-muted-foreground">순서가 작을수록 먼저 표시돼요.</p><Button id="faq-new-category" type="button" disabled={!loaded || loading} onclick={(event) => openCategory(undefined, event.currentTarget)}><PlusIcon class="size-4" aria-hidden="true" />분류 등록</Button></div><div class="divide-y rounded-xl border">{#each categories as item (item.id)}<div class="flex items-center justify-between gap-4 p-5" data-faq-category={item.id}><div><h2 class="text-sm font-semibold">{item.name}</h2><p class="mt-1 text-xs text-muted-foreground">질문 {item.questions.length}개 · 순서 {item.order}</p></div><div class="flex items-center gap-3"><Badge variant={item.active ? "secondary" : "outline"}>{item.active ? "공개" : "숨김"}</Badge><Button type="button" size="sm" variant="outline" disabled={loading || saving} aria-label={`${item.name} 분류 수정`} onclick={(event) => openCategory(item, event.currentTarget)}>수정</Button></div></div>{:else}<p class="p-10 text-center text-sm text-muted-foreground">{loading ? "분류를 불러오는 중이에요." : listError ? "" : "아직 등록된 분류가 없어요."}</p>{/each}</div></div>
    </Tabs.Content>
  </Tabs.Root>
</div>

<Dialog.Root bind:open={() => editorOpen, (value) => { if (!value) void closeEditor(); }}>
  <Dialog.Content showCloseButton={false} class="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
    onOpenAutoFocus={(event) => { event.preventDefault(); void tick().then(() => { if (editorOpen) firstInput?.focus(); }); }}
    onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus?.focus(); }}>
    <Dialog.Header class="shrink-0 border-b px-5 py-4">
      <div class="flex items-center justify-between gap-3"><Dialog.Title>{editorTitle}</Dialog.Title><Button type="button" variant="ghost" size="sm" disabled={saving} onclick={closeEditor} aria-label="FAQ 편집 닫기">닫기</Button></div>
      <Dialog.Description>{editorKind === "question" ? "질문 내용을 수정한 뒤 저장해 주세요." : "이름, 표시 순서와 공개 여부를 설정해 주세요."}</Dialog.Description>
    </Dialog.Header>
    <form id="faq-editor-form" class="flex min-h-0 flex-1 flex-col" onsubmit={save} aria-busy={saving}>
      <div class="min-h-0 overflow-y-auto overscroll-contain px-5 py-5"><fieldset disabled={saving} class="grid gap-5">
        {#if editorKind === "question"}
          <div class="grid gap-2"><Label for="faq-edit-title">질문 제목 (필수)</Label><Input id="faq-edit-title" bind:ref={firstInput} bind:value={question.title} required maxlength={200} class="min-h-11" /></div>
          <div class="grid gap-2"><Label for="faq-edit-category">분류</Label><Select.Root type="single" bind:value={question.categoryId} disabled={saving}><Select.Trigger id="faq-edit-category" class="min-h-11 w-full">{selectedCategory?.name || "분류 선택"}</Select.Trigger><Select.Content>{#each categories as item (item.id)}<Select.Item value={item.id} label={`${item.name}${item.active ? "" : " (숨김)"}`} />{/each}</Select.Content></Select.Root>{#if selectedCategory && !selectedCategory.active}<p class="text-xs leading-6 text-muted-foreground">분류가 숨김 상태여서 질문을 공개해도 사이트에 표시되지 않아요.</p>{/if}</div>
          <div class="grid gap-2"><Label for="faq-edit-body">답변 내용 (필수)</Label><Textarea id="faq-edit-body" bind:value={question.body} required rows={8} maxlength={20000} class="min-h-40 leading-7" /><p class="text-right text-xs text-muted-foreground">{question.body.length.toLocaleString()} / 20,000</p></div>
          <div class="grid items-end gap-5 sm:grid-cols-2"><div class="grid gap-2"><Label for="faq-edit-order">표시 순서</Label><Input id="faq-edit-order" type="number" min={0} max={100000} step={1} required bind:value={question.order} class="min-h-11" /></div><div class="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-muted/30 px-3"><Label for="faq-edit-active">질문 공개</Label><Switch id="faq-edit-active" bind:checked={question.active} disabled={saving} /></div></div>
        {:else}
          <div class="grid gap-2"><Label for="faq-category-name">분류 이름</Label><Input id="faq-category-name" bind:ref={firstInput} bind:value={category.name} required maxlength={60} class="min-h-11" /></div>
          <div class="grid gap-2"><Label for="faq-category-order">표시 순서</Label><Input id="faq-category-order" type="number" min={0} max={100000} step={1} required bind:value={category.order} class="min-h-11" /></div>
          <div class="flex items-center justify-between gap-4 rounded-lg bg-muted/30 p-4"><div><Label for="faq-category-active">분류 공개</Label><p class="mt-1 text-xs leading-6 text-muted-foreground">분류를 숨기면 그 안의 모든 질문도 표시되지 않아요.</p></div><Switch id="faq-category-active" bind:checked={category.active} disabled={saving} /></div>
        {/if}
        {#if formError}<div role="alert" class="rounded-lg border border-destructive/30 p-3 text-sm leading-6"><p>{formError}</p>{#if conflict}<p class="mt-2 text-xs text-muted-foreground">입력한 내용은 그대로 있어요. 필요한 내용을 복사한 뒤 최신 내용을 불러와 주세요.</p>{/if}</div>{/if}
      </fieldset></div>
      <Dialog.Footer class="shrink-0 items-center border-t bg-background px-5 py-4">
        {#if editingId}<Button type="button" variant="ghost" disabled={saving || loading} onclick={reloadEditor}>최신 내용 불러오기</Button>{/if}
        <Button type="button" variant="outline" disabled={saving} onclick={closeEditor}>취소</Button>
        <Button id="faq-editor-save" type="submit" disabled={saving || loading || Boolean(editingId && !dirty)}>{saving ? "저장 중…" : "저장"}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
