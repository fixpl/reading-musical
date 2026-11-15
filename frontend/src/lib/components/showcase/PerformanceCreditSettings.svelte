<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { ApiError } from "$lib/api/client";
  import { CREDIT_NOTICE_VERSION, loadMyPerformanceCredits, updateMyPerformanceCredit, type MyPerformanceCredit } from "$lib/api/showcase";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import ShowcaseImage from "./ShowcaseImage.svelte";

  let { profileRevision = 0 }: { profileRevision?: number } = $props();
  type CreditRow = {
    saved: MyPerformanceCredit;
    displayName: string;
    showName: boolean;
    showPhoto: boolean;
    saving: boolean;
    error: string;
    message: string;
    conflict: boolean;
    latest: MyPerformanceCredit | null;
    checking: boolean;
    photoLoadedToken: string | null;
    photoFailed: boolean;
  };
  let rows = $state<CreditRow[]>([]);
  let loading = $state(true);
  let loadError = $state("");
  let alive = true;
  let request = 0;
  onDestroy(() => { alive = false; request += 1; });
  // 프로필 저장 때 사진의 공개 가능 상태만 갱신하고, 입력 중인 공개 이름은 보존한다.
  $effect(() => {
    profileRevision;
    untrack(() => { void loadCredits(true); });
  });

  function newRow(saved: MyPerformanceCredit, previous?: CreditRow): CreditRow {
    return { saved, displayName: saved.displayName, showName: saved.showName, showPhoto: saved.showPhoto && !saved.photoNeedsConfirmation, saving: false, error: "", message: "", conflict: false, latest: null, checking: false, photoLoadedToken: previous?.saved.photoToken === saved.photoToken && previous?.saved.photoUrl === saved.photoUrl ? previous.photoLoadedToken : null, photoFailed: false };
  }
  async function loadCredits(preserve = false) {
    const current = ++request;
    if (rows.length === 0) loading = true;
    loadError = "";
    try {
      const result = await loadMyPerformanceCredits();
      if (!alive || current !== request) return;
      rows = result.items.map((item) => {
        const previous = preserve ? rows.find((row) => row.saved.productionId === item.productionId) : undefined;
        if (!previous) return newRow(item);
        const dirty = previous.displayName !== previous.saved.displayName || previous.showName !== previous.saved.showName || previous.showPhoto !== previous.saved.showPhoto;
        if (!dirty && !previous.conflict) return newRow(item, previous);
        return { ...previous, saved: { ...item, revision: previous.saved.revision }, showPhoto: previous.showPhoto && item.hasProfilePhoto && !item.photoNeedsConfirmation && previous.saved.photoToken === item.photoToken, message: item.photoNeedsConfirmation || previous.saved.photoToken !== item.photoToken ? "프로필 사진이 바뀌었어요. 새 사진을 공개하려면 사진 공개를 다시 선택하고 저장해 주세요." : previous.message };
      });
    } catch {
      if (alive && current === request) loadError = "공연별 공개 설정을 불러오지 못했어요. 프로필 저장과는 별도로 다시 확인해 주세요.";
    } finally {
      if (alive && current === request) loading = false;
    }
  }
  function nameVisibility(row: CreditRow, checked: boolean) {
    row.showName = checked;
    if (!checked) row.showPhoto = false;
    row.message = "";
  }
  function applyLatest(row: CreditRow) {
    if (!row.latest) return;
    const photoChanged = row.saved.photoToken !== row.latest.photoToken;
    Object.assign(row, newRow(row.latest, row));
    if (photoChanged) row.showPhoto = false;
    row.message = photoChanged ? "프로필 사진이 바뀌었어요. 아래 사진을 확인하고 사진 공개를 다시 선택해 주세요." : "저장된 최신 설정을 불러왔어요.";
  }
  async function checkLatest(row: CreditRow) {
    row.checking = true;
    row.error = "";
    try {
      const result = await loadMyPerformanceCredits();
      const latest = result.items.find((item) => item.productionId === row.saved.productionId);
      if (!latest) { row.error = "이 공연의 참여 상태가 바뀌었어요. 공연팀에 확인해 주세요."; return; }
      row.latest = latest;
    } catch { row.error = "최신 설정을 확인하지 못했어요. 입력한 내용은 남아 있어요."; }
    finally { row.checking = false; }
  }
  async function save(row: CreditRow, useLatest = false) {
    if (row.saving || (row.conflict && !useLatest)) return;
    row.error = "";
    row.message = "";
    if (row.showName && !row.displayName.trim()) { row.error = "공개할 이름을 입력해 주세요."; return; }
    if (row.showName && !row.saved.eligible) { row.error = "배역과 참여 상태를 먼저 확인해 주세요. 공개 해제는 저장할 수 있어요."; return; }
    if (row.showPhoto && (!row.saved.photoToken || (useLatest && row.latest && row.saved.photoToken !== row.latest.photoToken))) {
      row.error = "프로필 사진을 다시 확인해야 해요. 최신 설정을 적용한 뒤 사진 공개를 다시 선택해 주세요.";
      return;
    }
    if (row.showPhoto && row.photoLoadedToken !== row.saved.photoToken) {
      row.error = "사진 미리보기를 확인한 뒤 사진 공개를 선택해 주세요.";
      return;
    }
    row.saving = true;
    try {
      const result = await updateMyPerformanceCredit(row.saved.productionId, {
        expectedRevision: useLatest && row.latest ? row.latest.revision : row.saved.revision,
        displayName: row.displayName.trim(),
        showName: row.showName,
        showPhoto: row.showName && row.showPhoto,
        noticeVersion: CREDIT_NOTICE_VERSION,
        expectedPhotoToken: row.showName && row.showPhoto ? row.saved.photoToken : undefined
      });
      const wasVisible = row.saved.showName;
      Object.assign(row, newRow(result, row));
      row.message = result.showName ? "공개 설정을 저장했어요. 공연 소개가 게시되면 선택한 정보가 보여요." : wasVisible ? "이 공연 소개에서 이름과 사진 공개를 해제했어요." : "이름과 사진을 공개하지 않도록 저장했어요.";
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        row.conflict = true;
        row.latest = null;
        row.error = "다른 화면에서 설정이 바뀌었어요. 입력한 내용은 남아 있으니 최신 설정과 비교해 주세요.";
      } else { row.error = failure instanceof Error ? failure.message : "공개 설정을 저장하지 못했어요. 입력한 내용은 남아 있어요."; }
    } finally { row.saving = false; }
  }
</script>

<section class="bg-card mt-6 rounded-xl border p-5 sm:p-6" aria-labelledby="performance-credit-title">
  <h2 id="performance-credit-title" class="text-lg font-semibold">공연 소개에 내 이름·사진 공개</h2>
  <p class="text-muted-foreground mt-3 text-sm leading-7">공연 소개 페이지는 누구나 볼 수 있어요. 공연별로 공개할 이름과 배역을 선택하고, 사진은 따로 동의해 주세요. 선택하지 않아도 공연 참여와 연습에는 영향이 없어요.</p>
  <p class="text-muted-foreground mt-2 text-xs leading-6">공개할 사진은 위에서 저장한 프로필 사진을 사용해요. 사진을 바꾸면 새 사진의 공개 여부를 다시 확인해 주세요. 공개를 해제하고 저장하면 해당 공연 소개에서 이름과 사진이 내려가요.</p>
  {#if loading}<p class="text-muted-foreground mt-5 text-sm" role="status">공연별 공개 설정을 확인하고 있어요…</p>
  {:else if loadError}<div class="mt-5" role="alert"><p class="text-sm text-destructive">{loadError}</p><Button variant="outline" class="mt-3 min-h-11" onclick={() => loadCredits(true)}>다시 확인</Button></div>
  {:else if rows.length === 0}<p class="bg-muted/40 text-muted-foreground mt-5 rounded-lg p-4 text-sm leading-7">배역이 배정된 공연이 생기면 이곳에서 공개 여부를 선택할 수 있어요.</p>
  {:else}
    <div class="mt-5 divide-y border-t">
      {#each rows as row (row.saved.productionId)}
        <form class="py-5" onsubmit={(event) => { event.preventDefault(); void save(row); }} aria-busy={row.saving}>
          <h3 class="font-semibold break-words">{row.saved.productionTitle}</h3>
          <p class="text-muted-foreground mt-1 text-xs leading-6">{row.saved.roles.length ? row.saved.roles.join(" · ") : "배역 확인 필요"} · {row.saved.published ? "공연 소개 게시 중" : "공연 소개 미게시"}</p>
          {#if !row.saved.eligible}<p class="mt-2 text-xs leading-6">현재 배역이나 참여 상태를 확인해야 해요. 이미 공개한 정보는 해제할 수 있어요.</p>{/if}
          {#if row.saved.photoNeedsConfirmation}<p class="text-primary mt-2 text-xs leading-6">프로필 사진이 바뀌어 새 사진은 공개되지 않아요. 사진 공개를 다시 선택하고 저장해 주세요.</p>{/if}
          <fieldset class="mt-4 grid gap-3" disabled={row.saving}>
            <div class="grid gap-2"><Label for={`credit-name-${row.saved.productionId}`}>공개할 이름</Label><Input id={`credit-name-${row.saved.productionId}`} class="min-h-11" maxlength={60} bind:value={row.displayName} autocomplete="off" disabled={!row.saved.eligible && !row.showName} /><p class="text-muted-foreground text-xs leading-6">선택한 이름과 배정된 배역만 공개해요. 연락처와 프로필의 다른 항목은 공개하지 않아요.</p></div>
            <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2"><input type="checkbox" class="size-4 accent-primary" checked={row.showName} disabled={!row.saved.eligible && !row.showName} onchange={(event) => nameVisibility(row, event.currentTarget.checked)} /><span class="text-sm">이 공연 소개에 이름과 배역을 공개해요.</span></label>
            <label class={["flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2", { "opacity-60": !row.showName || !row.saved.hasProfilePhoto }]}><input type="checkbox" class="size-4 accent-primary" bind:checked={row.showPhoto} disabled={!row.showName || !row.saved.hasProfilePhoto || row.photoLoadedToken !== row.saved.photoToken || (!row.saved.eligible && !row.showPhoto)} /><span class="text-sm">프로필 사진도 함께 공개해요.</span></label>
            {#if !row.saved.hasProfilePhoto}<p class="text-muted-foreground text-xs leading-6">사진을 공개하려면 위에서 프로필 사진을 먼저 저장해 주세요.</p>{/if}
            {#if row.saved.hasProfilePhoto && row.saved.photoUrl}<div class="flex items-center gap-3"><ShowcaseImage src={row.saved.photoUrl} alt="공개할 프로필 사진" class="size-14 shrink-0 rounded-full border" onloaded={(source) => { if (source === row.saved.photoUrl) { row.photoLoadedToken = row.saved.photoToken; row.photoFailed = false; } }} onfailed={(source) => { if (source === row.saved.photoUrl) { row.photoLoadedToken = null; row.photoFailed = true; } }} /><span class="text-muted-foreground text-xs leading-6">{row.showPhoto ? "사진 공개를 선택하고 저장하면 이 사진이 공연 소개에 표시돼요." : "현재 프로필 사진이에요. 사진 공개를 선택하기 전에 확인해 주세요."}</span></div>{/if}
            {#if row.photoFailed}<p class="text-sm leading-6 text-destructive">사진 미리보기를 불러오지 못해 사진 공개를 선택할 수 없어요. 이 화면을 다시 연 뒤 사진을 확인해 주세요. 공개 해제는 저장할 수 있어요.</p>{/if}
            {#if row.error}<p role="alert" class="text-sm leading-6 text-destructive">{row.error}</p>{/if}
            {#if row.message}<p role="status" class="text-sm leading-6">{row.message}</p>{/if}
            {#if row.conflict}
              <div class="bg-muted/40 rounded-lg border p-3">
                {#if row.latest}<p class="text-sm leading-6">최신 저장: {row.latest.displayName || "이름 미입력"} · 이름 {row.latest.showName ? "공개" : "비공개"} · 사진 {row.latest.showPhoto ? "공개" : "비공개"}</p>{#if row.saved.photoToken !== row.latest.photoToken}<p class="mt-2 text-xs leading-6">프로필 사진도 바뀌었어요. 최신 설정을 적용한 뒤 새 사진을 보고 공개 여부를 다시 선택해 주세요.</p>{/if}<div class="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" class="min-h-11" onclick={() => applyLatest(row)}>최신 설정 적용</Button>{#if !row.showPhoto || row.saved.photoToken === row.latest.photoToken}<Button type="button" class="min-h-11" onclick={() => save(row, true)}>내 입력으로 저장</Button>{/if}</div>
                {:else}<Button type="button" variant="outline" class="min-h-11" disabled={row.checking} onclick={() => checkLatest(row)}>{row.checking ? "확인 중…" : "최신 설정 확인"}</Button>{/if}
              </div>
            {:else}<div class="flex justify-end"><Button type="submit" variant="outline" class="min-h-11">{row.saving ? "저장 중…" : "공개 설정 저장"}</Button></div>{/if}
          </fieldset>
        </form>
      {/each}
    </div>
  {/if}
</section>
