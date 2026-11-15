<script lang="ts">
  import { tick } from "svelte";
  import { toast } from "svelte-sonner";
  import { page } from "$app/stores";
  import { invalidate } from "$app/navigation";
  import PolicyConsent from "$lib/components/site/PolicyConsent.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest } from "$lib/api/client";

  let orgName = $state("");
  let contactName = $state("");
  let email = $state("");
  let phone = $state("");
  let preferredTiming = $state("");
  let audience = $state("");
  let message = $state("");
  let submitting = $state(false);
  let statusMessage = $state("");
  let receipt = $state<{ id: string; createdAt: string } | null>(null);
  let receiptPanel = $state<HTMLElement>();
  async function copyReceipt() {
    if (!receipt) return;
    try { await navigator.clipboard.writeText(receipt.id); toast.success("접수번호를 복사했어요."); }
    catch { toast.error("접수번호를 직접 선택하여 복사해 주세요."); }
  }
  let privacyConsent = $state(false);
  let age14 = $state(false);
  let website = $state("");
  const site = $derived($page.data.site);
  const inquiryPolicy = $derived(site?.policies.find((item) => item.kind === "INQUIRY_PRIVACY"));
  let policyId = "";
  $effect(() => {
    const next = inquiryPolicy?.id || "";
    if (policyId !== next) { policyId = next; privacyConsent = false; }
  });

  async function submitInquiry(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!site?.ready.inquiry || !inquiryPolicy || !privacyConsent || !age14) {
      statusMessage = "문의 개인정보 수집·이용 동의와 만 14세 이상 여부를 확인해 주세요.";
      return;
    }
    if (![orgName, contactName, email, message].every((value) => value.trim())) {
      statusMessage = "기관·단체명, 담당자 성함, 이메일, 문의 내용을 입력해 주세요.";
      return;
    }
    submitting = true;
    statusMessage = "";
    try {
      let referrerHost: string | undefined;
      try { referrerHost = document.referrer ? new URL(document.referrer).hostname : undefined; } catch { /* No usable referrer. */ }
      receipt = await apiRequest<{ id: string; createdAt: string }>("/inquiries", {
        method: "POST",
        body: JSON.stringify({ sourcePage: $page.url.pathname, sourceCampaign: $page.url.searchParams.get("utm_campaign") || undefined, referrerHost, privacyConsent, privacyDocumentId: inquiryPolicy.id, age14, website, orgName: orgName.trim(), contactName: contactName.trim(), email: email.trim(), phone: phone.trim() || undefined, preferredTiming: preferredTiming.trim() || undefined, audience: audience.trim() || undefined, message: message.trim() })
      });
      orgName = contactName = email = phone = preferredTiming = audience = message = "";
      privacyConsent = age14 = false;
      await tick();
      receiptPanel?.focus();
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "공연 신청을 접수하지 못했어요. 다시 시도해 주세요.";
      if (error && typeof error === "object" && "code" in error && error.code === "POLICY_CHANGED") {
        privacyConsent = false;
        await invalidate("site:public");
      }
    } finally { submitting = false; }
  }
</script>

{#if receipt}
  <section bind:this={receiptPanel} tabindex="-1" aria-labelledby="inquiry-receipt" class="scroll-mt-24 space-y-4 rounded-xl border bg-card p-5 sm:p-6">
    <h2 id="inquiry-receipt" class="text-lg font-semibold">공연 신청을 접수했어요</h2>
    <div class="rounded-lg bg-muted/40 px-4 py-3">
      <p class="text-muted-foreground text-sm">접수번호</p>
      <code class="mt-1 block select-all break-all text-sm">{receipt.id}</code>
    </div>
    <p class="text-muted-foreground text-sm leading-6">접수번호와 신청할 때 입력한 이메일로 처리 상태와 답변을 확인할 수 있어요.</p>
    <div class="flex flex-wrap gap-2">
      <Button class="min-h-11" href={`/inquiries/lookup?id=${encodeURIComponent(receipt.id)}`}>신청 내용 확인</Button>
      <Button type="button" variant="outline" class="min-h-11" onclick={copyReceipt}>접수번호 복사</Button>
    </div>
  </section>
{:else if site?.ready.inquiry && inquiryPolicy}
  <a href="/inquiries/lookup" class="mb-4 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">이미 접수한 신청 확인</a>
  <form class="grid gap-5" method="post" onsubmit={submitInquiry} aria-busy={submitting}>
    <div class="grid gap-5 sm:grid-cols-2">
      <div class="grid gap-2"><Label for="orgName">기관·단체명 <span class="text-destructive">*</span></Label><Input class="min-h-11" id="orgName" name="orgName" autocomplete="organization" bind:value={orgName} required maxlength={120} placeholder="예: ○○문화재단" /></div>
      <div class="grid gap-2"><Label for="contactName">담당자 성함 <span class="text-destructive">*</span></Label><Input class="min-h-11" id="contactName" name="contactName" autocomplete="name" bind:value={contactName} required maxlength={60} /></div>
      <div class="grid gap-2 sm:col-span-2"><Label for="email">이메일 <span class="text-destructive">*</span></Label><Input class="min-h-11" id="email" name="email" type="email" autocomplete="email" bind:value={email} required maxlength={160} placeholder="name@example.org" /></div>
    </div>
    <div class="grid gap-2"><Label for="message">신청 내용 <span class="text-destructive">*</span></Label><Textarea id="message" name="message" bind:value={message} required maxlength={2000} rows={5} placeholder="어떤 공연을 준비 중인지 알려 주세요." /></div>
    <details class="rounded-lg border px-3">
      <summary class="min-h-11 cursor-pointer py-3 text-sm font-medium">연락처·희망 시기·관람 대상 추가 <span class="text-muted-foreground font-normal">(선택)</span></summary>
      <div class="grid gap-4 pb-3 pt-1 sm:grid-cols-2">
        <div class="grid gap-2"><Label for="phone">연락처</Label><Input class="min-h-11" id="phone" name="phone" type="tel" autocomplete="tel" bind:value={phone} maxlength={40} placeholder="010-0000-0000" /></div>
        <div class="grid gap-2"><Label for="preferredTiming">희망 시기</Label><Input class="min-h-11" id="preferredTiming" name="preferredTiming" bind:value={preferredTiming} maxlength={60} placeholder="예: 11월 중" /></div>
        <div class="grid gap-2 sm:col-span-2"><Label for="audience">관람 대상</Label><Input class="min-h-11" id="audience" name="audience" bind:value={audience} maxlength={120} placeholder="예: 임직원 80명" /></div>
      </div>
    </details>
    <div hidden aria-hidden="true"><label>웹사이트<input name="website" bind:value={website} tabindex="-1" autocomplete="off" /></label></div>
    <div class="border-t pt-3">
      <label class="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm leading-6"><input type="checkbox" class="size-4 shrink-0" bind:checked={age14} required /><span><strong>[필수]</strong> 만 14세 이상이에요.</span></label>
      <PolicyConsent doc={inquiryPolicy} label="문의 개인정보 수집·이용에 동의해요." bind:checked={privacyConsent} required />
      <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">개인정보 처리방침 (새 창)</a>
    </div>
    {#if statusMessage}<p class="text-destructive text-sm leading-6" role="alert">{statusMessage}</p>{/if}
    <Button type="submit" disabled={submitting} class="min-h-12 sm:w-fit">{submitting ? "접수 중…" : "공연 신청하기"}</Button>
  </form>
{:else}
  <section class="space-y-3 rounded-xl border bg-muted/25 p-5" aria-labelledby="inquiry-unavailable">
    <h2 id="inquiry-unavailable" class="font-semibold">{site ? "현재 새 공연 신청을 받지 않고 있어요" : "공연 신청 상태를 확인하지 못했어요"}</h2>
    <div class="flex flex-wrap gap-2">
      <Button href="/inquiries/lookup" variant="outline" class="min-h-11">이미 접수한 신청 확인</Button>
      <Button type="button" variant="ghost" class="min-h-11" onclick={() => invalidate("site:public")}>다시 확인</Button>
    </div>
  </section>
{/if}
