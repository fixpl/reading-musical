<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { apiRequest } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  type MailState = { ready: boolean; transport: string; reason: string | null; configurationOnly: true; counts: Record<string, number>; oldestQueuedAt: string | null };
  let mailStatus = $state<MailState | null>(null); let loading = $state(true); let error = $state(""); let sequence = 0;
  async function load() {
    const current = ++sequence; loading = true; error = "";
    try { const result = await apiRequest<MailState>("/admin/mail/readiness"); if (current === sequence) mailStatus = result; }
    catch { if (current === sequence) error = "메일 발송 상태를 확인하지 못했어요."; }
    finally { if (current === sequence) loading = false; }
  }
  onMount(() => { void load(); }); onDestroy(() => { sequence += 1; });
</script>
<section class="rounded-xl border px-4 py-3 text-sm [word-break:keep-all]" aria-label="메일 발송 상태">
  <div class="flex flex-wrap items-center justify-between gap-3"><div class="flex flex-wrap items-center gap-2"><strong>메일 발송</strong>
    {#if mailStatus}<Badge variant={mailStatus.ready ? "secondary" : "outline"}>{mailStatus.ready ? (mailStatus.transport === "json" ? "로컬 확인 모드" : "발송 설정 완료") : mailStatus.reason === "PAUSED" ? "발송 보류" : "설정 확인 필요"}</Badge><span class="text-xs text-muted-foreground">{mailStatus.transport} · 대기 {mailStatus.counts.QUEUED || 0}건 · 실패 {mailStatus.counts.FAILED || 0}건</span>{:else}<span class="text-muted-foreground">{loading ? "상태 확인 중" : "확인 필요"}</span>{/if}</div><Button type="button" variant="ghost" size="sm" disabled={loading} onclick={load}>다시 확인</Button></div>
  {#if error}<p role="status" class="mt-2 text-xs">{error}</p>{:else if mailStatus}<p class="mt-2 text-xs leading-6 text-muted-foreground">{mailStatus.reason === "PAUSED" ? "서버에서 메일 발송을 보류 중이에요. 키와 발신 주소를 설정한 뒤 발송을 활성화해 주세요. 대기 중인 메일 수도 함께 확인해 주세요." : !mailStatus.ready ? "서버의 Resend 설정을 확인해 주세요. 메일을 발송할 수 있는 상태에서만 인증번호를 요청할 수 있어요." : "설정이 준비돼 있어도 실제 수신 결과는 달라질 수 있어요. 대기 중인 메일은 메일 워커가 처리하며, 발송 접수가 완료돼도 수신함에 도착했는지는 별도로 확인해야 해요."}</p>{/if}
</section>
