<script lang="ts">
  import { invalidate } from "$app/navigation";
  import type { PublicSite } from "$lib/api/site";
  let { site, errorMessage = "" }: { site: PublicSite | null; errorMessage?: string } = $props();
  const year = new Date().getFullYear();
  const info = $derived(site?.info);
  const period = $derived(info && info.copyrightStartYear < year ? `${info.copyrightStartYear}–${year}` : String(year));
</script>
<footer class="bg-muted/20 border-t" aria-label="사이트 운영 정보">
  <div class="mx-auto grid max-w-6xl gap-5 px-5 py-8 text-sm sm:px-8">
    <nav class="flex flex-wrap gap-x-6 gap-y-3" aria-label="정책 및 고객센터">
      <a href="/legal/terms" class="underline-offset-4 hover:underline">이용약관</a>
      <a href="/legal/privacy" class="font-bold underline-offset-4 hover:underline">개인정보 처리방침</a>
      <a href="/faq" class="underline-offset-4 hover:underline">자주 묻는 질문</a>
      <a href="/support" class="underline-offset-4 hover:underline">운영팀 문의</a>
      <a href="/inquiries/new" class="underline-offset-4 hover:underline">공연 신청</a>
      <a href="/inquiries/lookup" class="underline-offset-4 hover:underline">공연 신청 확인</a>
      <a href="/app/privacy" class="underline-offset-4 hover:underline">수신 동의 관리</a>
    </nav>
    {#if info}
      <div class="grid gap-2 text-xs leading-6 text-muted-foreground [word-break:keep-all] [overflow-wrap:anywhere]">
        <p><strong class="text-foreground text-sm">{info.siteName}</strong><span class="ml-3">{info.siteDescription}</span></p>
        <dl class="flex flex-wrap gap-x-5 gap-y-1">
          {#each [["상호", info.companyName], ["대표자", info.representative], ["사업자등록번호", info.businessNumber], ["통신판매업 신고번호", info.onlineSalesNumber], ["주소", info.address], ["고객센터", info.supportPhone], ["이메일", info.supportEmail], ["운영시간", info.supportHours], ["개인정보 보호책임자", info.privacyOfficer], ["개인정보 문의", info.privacyEmail]] as [label, value] (label)}
            {#if value}<div class="flex gap-2"><dt>{label}</dt><dd>{value}</dd></div>{/if}
          {/each}
        </dl>
        <p>© {period} {info.copyrightHolder || info.companyName || info.siteName}. All rights reserved.</p>
      </div>
    {:else}
      <p class="text-muted-foreground text-xs" role="status">{errorMessage || "사이트 정보를 확인하고 있어요."} <button type="button" class="ml-2 underline underline-offset-4" onclick={() => invalidate("site:public")}>다시 불러오기</button></p>
    {/if}
  </div>
</footer>
