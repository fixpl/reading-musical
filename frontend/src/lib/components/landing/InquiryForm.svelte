<script lang="ts">
  import { toast } from "svelte-sonner";
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

  async function submitInquiry(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    if (![orgName, contactName, email, message].every((value) => value.trim())) {
      statusMessage = "기관·단체명, 담당자 성함, 이메일, 문의 내용을 입력해 주세요.";
      return;
    }
    submitting = true;
    statusMessage = "";
    try {
      await apiRequest("/inquiries", {
        method: "POST",
        body: JSON.stringify({ orgName: orgName.trim(), contactName: contactName.trim(), email: email.trim(), phone: phone.trim() || undefined, preferredTiming: preferredTiming.trim() || undefined, audience: audience.trim() || undefined, message: message.trim() })
      });
      statusMessage = "신청이 접수되었습니다. 담당자가 확인 후 남겨주신 이메일로 연락드리겠습니다.";
      toast.success("신청이 접수되었습니다");
      orgName = contactName = email = phone = preferredTiming = audience = message = "";
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "신청을 접수하지 못했습니다. 다시 시도해 주세요.";
      toast.error(statusMessage);
    } finally { submitting = false; }
  }
</script>

<form class="grid gap-5" onsubmit={submitInquiry} aria-busy={submitting}>
  <div class="grid gap-5 sm:grid-cols-2">
    <div class="grid gap-2"><Label for="orgName">기관·단체명 <span class="text-destructive">*</span></Label><Input id="orgName" name="orgName" autocomplete="organization" bind:value={orgName} required maxlength={120} placeholder="예: ○○문화재단" /></div>
    <div class="grid gap-2"><Label for="contactName">담당자 성함 <span class="text-destructive">*</span></Label><Input id="contactName" name="contactName" autocomplete="name" bind:value={contactName} required maxlength={60} /></div>
    <div class="grid gap-2"><Label for="email">이메일 <span class="text-destructive">*</span></Label><Input id="email" name="email" type="email" autocomplete="email" bind:value={email} required maxlength={160} placeholder="name@example.org" /></div>
    <div class="grid gap-2"><Label for="phone">연락처 <span class="text-muted-foreground text-xs">선택</span></Label><Input id="phone" name="phone" type="tel" autocomplete="tel" bind:value={phone} maxlength={40} placeholder="010-0000-0000" /></div>
    <div class="grid gap-2"><Label for="preferredTiming">희망 시기 <span class="text-muted-foreground text-xs">선택</span></Label><Input id="preferredTiming" name="preferredTiming" bind:value={preferredTiming} maxlength={60} placeholder="예: 11월 중" /></div>
    <div class="grid gap-2"><Label for="audience">관람 대상 <span class="text-muted-foreground text-xs">선택</span></Label><Input id="audience" name="audience" bind:value={audience} maxlength={120} placeholder="예: 임직원 80명" /></div>
  </div>
  <div class="grid gap-2"><Label for="message">문의 내용 <span class="text-destructive">*</span></Label><Textarea id="message" name="message" bind:value={message} required maxlength={2000} rows={5} placeholder="공연 목적, 준비 중인 프로젝트, 공간 여건이나 궁금한 운영 방식을 알려주세요." /></div>
  <p class="text-muted-foreground min-h-5 text-sm leading-relaxed" role="status" aria-live="polite">{statusMessage}</p>
  <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p class="text-muted-foreground text-xs leading-relaxed">남겨주신 정보는 문의 상담 목적으로만 사용합니다.</p><Button type="submit" disabled={submitting} class="shrink-0">{submitting ? "접수 중..." : "신청 보내기"}</Button></div>
</form>
