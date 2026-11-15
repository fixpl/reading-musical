<script lang="ts">
  import InquiryForm from "$lib/components/landing/InquiryForm.svelte";
</script>
<svelte:head><title>공연 신청</title></svelte:head>
<main class="mx-auto w-full max-w-3xl px-5 py-12 [word-break:keep-all]">
  <a href="/" class="text-sm text-muted-foreground">홈으로</a>
  <h1 class="mt-6 text-3xl font-bold">공연 신청</h1>
  <p class="mb-6 mt-3 text-sm leading-7 text-muted-foreground">기업·기관·단체 공연은 회원가입 없이 신청할 수 있어요.</p>
  <InquiryForm />
</main>
