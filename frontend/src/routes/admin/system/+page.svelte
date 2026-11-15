<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import { StatusBadge, type StatusTone } from "$lib/components/ui/status-badge";
  import { apiRequest } from "$lib/api/client";
  import { formatDateTime } from "$lib/domain/labels";

  type Health = {
    checkedAt: string; env: string;
    db: { ok: boolean; latencyMs: number | null; error: string | null };
    ai: { ok: boolean; configured: boolean; model: string | null; host: string | null; latencyMs: number | null; error: string | null };
    storage: { driver: "r2" | "local"; ok: boolean; bucket: string | null; prefix?: string; cors: Array<{ origin: string; allowed: boolean }>; error: string | null; note?: string };
    mail: { transport: string; from: string | null; real: boolean; reason?: "PAUSED" | "CONFIGURATION_REQUIRED" | "INVALID_TRANSPORT" };
    swagger: boolean;
  };
  let health = $state<Health | null>(null);
  let loading = $state(true);
  let error = $state("");

  async function load(refresh = false) {
    loading = true; error = "";
    try { health = await apiRequest<Health>(`/admin/system-health${refresh ? "?refresh=1" : ""}`); }
    catch (cause) { error = cause instanceof Error ? cause.message : "점검 결과를 불러오지 못했어요."; }
    finally { loading = false; }
  }
  onMount(() => void load());

  type Check = {
    title: string;
    tone: StatusTone;
    status: string;
    fields: Array<{ name: string; value: string }>;
    note?: string;
  };
  const checks = $derived.by<Check[]>(() => {
    if (!health) return [];
    const h = health;
    const aiSlow = h.ai.ok && (h.ai.latencyMs ?? 0) > 12_000;
    const corsBlocked = h.storage.cors.some((item) => !item.allowed);
    const mailPaused = h.mail.reason === "PAUSED";
    const localMail = h.mail.transport === "json" && !h.mail.reason;
    return [
      {
        title: "대본 AI", tone: !h.ai.ok ? "danger" : aiSlow ? "warning" : "success",
        status: !h.ai.configured ? "설정 없음" : !h.ai.ok ? "확인 실패" : aiSlow ? "응답 지연" : "연결됨",
        fields: [
          { name: "모델", value: h.ai.model ?? "" },
          { name: "공급자", value: h.ai.host ?? "" },
          { name: "응답 시간", value: h.ai.latencyMs === null ? "" : `${(h.ai.latencyMs / 1000).toFixed(1)}초` }
        ],
        note: h.ai.error ?? (aiSlow ? "대본 분석이 평소보다 오래 걸릴 수 있어요." : undefined)
      },
      {
        title: "파일 저장소", tone: !h.storage.ok || corsBlocked ? "danger" : h.storage.driver === "local" ? "neutral" : "success",
        status: !h.storage.ok ? "연결 실패" : corsBlocked ? "업로드 차단" : h.storage.driver === "local" ? "개발용 디스크" : "R2 연결됨",
        fields: [
          { name: "버킷", value: h.storage.bucket ? `${h.storage.bucket}${h.storage.prefix ? ` / ${h.storage.prefix}` : ""}` : "" },
          ...h.storage.cors.map((item) => ({ name: item.allowed ? "업로드 허용" : "업로드 차단", value: item.origin }))
        ],
        note: h.storage.error ?? (corsBlocked ? "차단된 주소를 Cloudflare R2의 CORS 설정에서 확인해 주세요." : h.storage.driver === "local" ? "이 서버의 디스크에 파일을 저장해요." : undefined)
      },
      {
        title: "데이터베이스", tone: h.db.ok ? "success" : "danger", status: h.db.ok ? "연결됨" : "연결 실패",
        fields: [{ name: "응답 시간", value: h.db.latencyMs === null ? "" : `${h.db.latencyMs}ms` }],
        note: h.db.error ?? undefined
      },
      {
        title: "메일", tone: h.mail.real || localMail ? "neutral" : "warning",
        status: mailPaused ? "발송 보류" : h.mail.real ? "발송 설정 확인" : localMail ? "개발용 기록" : "설정 확인 필요",
        fields: [{ name: "전송 방식", value: h.mail.transport }, { name: "보내는 주소", value: h.mail.from ?? "" }],
        note: mailPaused ? "발송이 멈춰 있어요. 이메일 인증을 이용하려면 발송 설정을 확인해 주세요."
          : h.mail.real ? "실제 수신 여부는 테스트 메일로 확인해 주세요."
            : localMail ? "메일을 발송하는 대신 기록을 남겨요." : undefined
      },
      {
        title: "API 문서", tone: h.env === "production" && h.swagger ? "warning" : "neutral", status: h.swagger ? "공개" : "비공개",
        fields: [], note: h.env === "production" && h.swagger ? "운영 환경에서 Swagger가 공개되어 있어요." : undefined
      }
    ];
  });
  const issues = $derived(checks.filter((check) => check.tone === "danger" || check.tone === "warning").length);
</script>

<svelte:head><title>시스템 점검 — 운영 콘솔</title></svelte:head>
<div class="mx-auto w-full min-w-0 max-w-4xl space-y-5">
  <PageHeader title="시스템 점검">
    {#snippet actions()}<Button variant="outline" size="touch" disabled={loading} onclick={() => load(true)}>{loading ? "점검 중…" : "다시 점검"}</Button>{/snippet}
  </PageHeader>

  {#if error}<ErrorPanel class="[overflow-wrap:anywhere]" title="점검 결과를 불러오지 못했어요" message={error} onRetry={() => load(true)} />{/if}
  {#if loading && !health}
    <div class="bg-card space-y-4 rounded-2xl border p-6">
      <p class="text-sm leading-6" role="status">연결 상태를 확인하고 있어요.</p>
      <LoadingBlock lines={4} />
    </div>
  {/if}

  {#if health}
    <div class="flex flex-wrap items-baseline justify-between gap-2" role="status">
      <p class="text-sm font-medium">{loading ? "다시 점검 중" : error ? "마지막 점검 결과" : issues ? `확인할 항목 ${issues}개` : "연결 점검 완료"}</p>
      <p class="text-muted-foreground text-xs"><time datetime={health.checkedAt}>{formatDateTime(health.checkedAt)}</time> · {health.env}</p>
    </div>
    <div class="bg-card divide-y overflow-hidden rounded-xl border" aria-busy={loading}>
      {#each checks as check (check.title)}
        <section class="grid min-w-0 gap-2 px-4 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-5 sm:px-5">
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:content-start sm:justify-start">
            <h2 class="text-sm font-semibold leading-6">{check.title}</h2>
            <StatusBadge tone={check.tone}>{check.status}</StatusBadge>
          </div>
          {#if check.fields.some((field) => field.value) || check.note}
            <div class="min-w-0 space-y-2 [overflow-wrap:anywhere]">
              {#if check.fields.some((field) => field.value)}
                <dl class="grid gap-x-5 gap-y-1.5 text-sm">
                  {#each check.fields.filter((field) => field.value) as field (field)}
                    <div class="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-2">
                      <dt class="text-muted-foreground text-xs leading-5">{field.name}</dt>
                      <dd class="min-w-0 font-medium">{field.value}</dd>
                    </div>
                  {/each}
                </dl>
              {/if}
              {#if check.note}<p class="text-muted-foreground text-sm leading-6">{check.note}</p>{/if}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>
