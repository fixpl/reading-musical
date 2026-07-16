<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest } from "$lib/api/client";
  import { newInquiryCount } from "$lib/stores/admin-badges";
  import { INQUIRY_STATUS_LABELS, formatDateTime } from "$lib/domain/labels";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";

  type PlanningMemo = { id: string; body: string; createdAt: string; author: { id: string; name: string } | null };
  type Inquiry = {
    id: string;
    orgName: string;
    contactName: string;
    email: string;
    phone: string | null;
    preferredTiming: string | null;
    audience: string | null;
    message: string;
    status: string;
    adminNote: string | null;
    planningNote: string | null;
    handledBy: { id: string; name: string } | null;
    production: { id: string; title: string; currentPhase: string; visibility: string } | null;
    planningMemos: PlanningMemo[];
    createdAt: string;
  };

  const inquiryId = $derived($page.params.id ?? "");

  let inquiry = $state<Inquiry | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let converting = $state(false);

  // 작성 상태
  let editStatus = $state("NEW");
  let editNote = $state("");
  let editPlanning = $state("");
  let convertTitle = $state("");

  onMount(load);

  async function load() {
    loading = true;
    try {
      const data = await apiRequest<Inquiry>(`/admin/inquiries/${inquiryId}`);
      inquiry = data;
      editStatus = data.status;
      editNote = data.adminNote ?? "";
      editPlanning = data.planningNote ?? "";
      convertTitle = data.production?.title ?? `${data.orgName} 공연`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "문의를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  async function refreshBadge() {
    try {
      const result = await apiRequest<{ counts: Partial<Record<string, number>> }>("/admin/inquiries?take=1");
      newInquiryCount.set(result.counts.NEW ?? 0);
    } catch {
      /* 배지는 실패해도 무시 */
    }
  }

  async function save() {
    if (!inquiry) return;
    saving = true;
    try {
      const updated = await apiRequest<Inquiry>(`/admin/inquiries/${inquiry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: editStatus, adminNote: editNote, planningNote: editPlanning })
      });
      inquiry = updated;
      toast.success("저장했습니다");
      await refreshBadge();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  async function convert() {
    if (!inquiry || !convertTitle.trim()) return;
    converting = true;
    try {
      // 전환 전에 작성한 기획 내용을 먼저 저장해 함께 이관되게 한다.
      if (editPlanning !== (inquiry.planningNote ?? "") || editStatus !== inquiry.status || editNote !== (inquiry.adminNote ?? "")) {
        await apiRequest(`/admin/inquiries/${inquiry.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: editStatus, adminNote: editNote, planningNote: editPlanning })
        });
      }
      const result = await apiRequest<{ production: { id: string; title: string } }>(
        `/admin/inquiries/${inquiry.id}/convert`,
        { method: "POST", body: JSON.stringify({ title: convertTitle.trim() }) }
      );
      toast.success(`공연을 만들었습니다 — ${result.production.title}`, {
        description: "기획 내용과 신청 원문이 공연 기획 메모로 옮겨졌어요."
      });
      await Promise.all([load(), refreshBadge()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연으로 전환하지 못했습니다");
    } finally {
      converting = false;
    }
  }

  function statusVariant(status: string): "default" | "secondary" | "outline" {
    if (status === "NEW") return "default";
    if (status === "CONVERTED") return "outline";
    return "secondary";
  }
</script>

<svelte:head><title>문의 상세 — 운영 콘솔</title></svelte:head>

<div class="w-full">
  <div class="flex flex-wrap items-center gap-2 py-1">
    <Button href="/admin/inquiries" variant="ghost" size="icon" class="-ms-2 size-8" aria-label="문의 목록으로">
      <ChevronLeftIcon />
    </Button>
    {#if inquiry}
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h1 class="truncate text-xl font-bold tracking-tight">{inquiry.orgName}</h1>
          <Badge variant={statusVariant(inquiry.status)}>{INQUIRY_STATUS_LABELS[inquiry.status] ?? inquiry.status}</Badge>
        </div>
        <p class="text-muted-foreground text-sm">{inquiry.contactName} · {inquiry.email}{inquiry.phone ? ` · ${inquiry.phone}` : ""}</p>
      </div>
    {:else}
      <h1 class="text-xl font-bold tracking-tight">문의 상세</h1>
    {/if}
  </div>

  {#if loading}
    <Skeleton class="mt-2 h-96 w-full rounded-2xl" />
  {:else if !inquiry}
    <div class="bg-card mt-2 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">문의를 찾을 수 없습니다.</p>
      <Button href="/admin/inquiries" variant="outline" size="sm" class="mt-3">목록으로</Button>
    </div>
  {:else}
    <div class="mt-2 grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <!-- 왼쪽: 신청 내용(읽기 전용) -->
      <aside class="bg-card h-fit rounded-2xl p-5">
        <p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">신청 내용</p>
        <dl class="mt-3 grid gap-3 text-sm">
          <div>
            <dt class="text-muted-foreground text-xs">희망 시기</dt>
            <dd class="font-medium">{inquiry.preferredTiming ?? "-"}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">관람 대상</dt>
            <dd class="font-medium">{inquiry.audience ?? "-"}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">접수 시각</dt>
            <dd class="font-medium">{formatDateTime(inquiry.createdAt)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">문의 내용</dt>
            <dd class="bg-muted/50 mt-1 rounded-xl p-3 leading-relaxed whitespace-pre-wrap">{inquiry.message}</dd>
          </div>
        </dl>
      </aside>

      <!-- 오른쪽: 처리 + 기획 작성 -->
      <div class="grid gap-4">
        <div class="bg-card grid gap-4 rounded-2xl p-5">
          <div class="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
            <Label>처리 상태</Label>
            <Select.Root type="single" bind:value={editStatus}>
              <Select.Trigger class="w-full sm:max-w-48">{INQUIRY_STATUS_LABELS[editStatus] ?? editStatus}</Select.Trigger>
              <Select.Content>
                {#each Object.entries(INQUIRY_STATUS_LABELS) as [value, label] (value)}
                  <Select.Item {value} {label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="grid gap-2">
            <Label for="adminNote">운영 메모</Label>
            <Textarea id="adminNote" bind:value={editNote} rows={2} maxlength={2000} placeholder="회신·조율 등 처리 기록" />
          </div>
        </div>

        <!-- 기획 내용 작성 -->
        <div class="bg-card grid gap-2 rounded-2xl p-5">
          <div>
            <Label for="planning" class="text-base">기획 내용</Label>
            <p class="text-muted-foreground text-xs">문의를 보고 공연 기획을 정리합니다. 프로그램 구성·인원·일정·견적·협의 사항 등. 공연으로 전환하면 이 내용이 공연 기획 메모로 옮겨집니다.</p>
          </div>
          <Textarea
            id="planning"
            bind:value={editPlanning}
            rows={12}
            maxlength={8000}
            placeholder={"예)\n· 구성: 기본형(공연 40분 + 토크 15분), 〈따뜻한 것들의 무게〉\n· 대상/인원: 이용자·가족 60명\n· 희망 시기: 12월 중순 (평일 저녁 선호)\n· 견적/예산: 협의 예정\n· 협의 메모: 담당자 통화 — 강당 음향 보유, 피아노 대여 필요"}
          />
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button onclick={save} disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
        </div>

        <!-- 공연 전환 / 연결된 공연 -->
        {#if inquiry.production}
          <div class="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-3 rounded-2xl border p-5">
            <div class="min-w-0">
              <p class="text-sm font-semibold">공연으로 전환됨</p>
              <p class="text-muted-foreground text-xs">기획 내용·신청 원문이 아래 공연의 기획 메모에 있습니다.</p>
            </div>
            <Button href={`/app/p/${inquiry.production.id}`} variant="outline" size="sm" class="ms-auto">
              {inquiry.production.title}
              <ExternalLinkIcon />
            </Button>
          </div>
        {:else}
          <div class="border-border/60 grid gap-3 rounded-2xl border border-dashed p-5">
            <div>
              <p class="text-sm font-semibold">공연으로 전환</p>
              <p class="text-muted-foreground text-xs">준비중(비공개) 공연이 만들어지고, 위 기획 내용과 신청 원문이 그 공연의 기획 메모로 옮겨집니다.</p>
            </div>
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div class="grid gap-1.5">
                <Label for="convertTitle" class="text-xs">공연 제목</Label>
                <Input id="convertTitle" bind:value={convertTitle} maxlength={120} />
              </div>
              <Button onclick={convert} disabled={converting || !convertTitle.trim()}>
                {converting ? "생성 중..." : "공연 만들기"}
              </Button>
            </div>
          </div>
        {/if}

        <!-- 기획 메모(전환 후 누적) -->
        {#if inquiry.planningMemos.length > 0}
          <div class="bg-card grid gap-2 rounded-2xl p-5">
            <p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">공연 기획 메모 {inquiry.planningMemos.length}</p>
            {#each inquiry.planningMemos as memo (memo.id)}
              <div class="border-border/60 rounded-xl border p-3">
                <p class="text-[15px] leading-relaxed whitespace-pre-wrap">{memo.body}</p>
                <p class="text-muted-foreground mt-2 text-xs">{memo.author?.name ?? "알 수 없음"} · {formatDateTime(memo.createdAt)}</p>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
