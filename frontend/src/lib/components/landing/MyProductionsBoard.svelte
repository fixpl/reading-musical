<script lang="ts">
  // 실제 참여 정보와 혼동하지 않도록 자료가 모이는 방식을 예시로 보여 준다.
  const productions = [
    { title: "달빛 아래 편지", role: "하윤 역", task: "대본과 반주", next: "테이블 리딩" },
    { title: "요나를 찾아서", role: "조명 스태프", task: "조명 큐시트", next: "조명 큐 점검" }
  ];
</script>

<figure class="rounded-xl border bg-card" aria-label="공연별 역할과 연습 자료가 모이는 내 공연 화면 예시">
  <figcaption class="flex items-center justify-between gap-3 border-b px-5 py-4"><span class="font-semibold">내 공연</span><span class="text-muted-foreground text-xs">사용 예시</span></figcaption>
  <ol class="divide-y px-5">
    {#each productions as production (production.title)}
      <li class="py-5">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h2 class="text-lg font-semibold">{production.title}</h2><p class="text-muted-foreground text-sm">{production.role}</p></div>
        <p class="mt-2 text-sm">{production.task}</p>
        <p class="mt-4 border-s-2 border-primary ps-3 text-sm"><span class="text-muted-foreground me-2 text-xs">다음 연습</span>{production.next}</p>
      </li>
    {/each}
  </ol>
</figure>
