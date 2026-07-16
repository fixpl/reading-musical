<script lang="ts">
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import * as Card from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { INQUIRY_STATUS_LABELS, formatRelative } from "$lib/domain/labels";

  type AdminStats = {
    users: number;
    blockedUsers: number;
    profileIncompleteUsers: number;
    productions: number;
    publishedProductions: number;
    thisMonthEvents: number;
  };

  type InquiryItem = {
    id: string;
    orgName: string;
    contactName: string;
    status: string;
    message: string;
    createdAt: string;
  };

  let stats = $state<AdminStats | null>(null);
  let inquiries = $state<InquiryItem[]>([]);
  let newCount = $state(0);
  let loading = $state(true);

  onMount(async () => {
    try {
      const [statsResult, inquiriesResult] = await Promise.all([
        apiRequest<AdminStats>("/admin/stats"),
        apiRequest<{ items: InquiryItem[]; counts: Partial<Record<string, number>> }>("/admin/inquiries?take=5")
      ]);
      stats = statsResult;
      inquiries = inquiriesResult.items;
      newCount = inquiriesResult.counts.NEW ?? 0;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대시보드를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  });

  const statCards = $derived(
    stats
      ? [
          { label: "전체 회원", value: stats.users, hint: `프로필 미완성 ${stats.profileIncompleteUsers}명` },
          { label: "공연", value: stats.productions, hint: `공개 ${stats.publishedProductions}편` },
          { label: "이번 달 일정", value: stats.thisMonthEvents, hint: "연습·리허설·공연" },
          { label: "새 문의", value: newCount, hint: "회신 대기" }
        ]
      : []
  );
</script>

{#if loading}
  <div class="grid gap-4 md:grid-cols-4">
    {#each Array(4) as _, i (i)}
      <Skeleton class="h-28 w-full" />
    {/each}
  </div>
{:else}
  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
    {#each statCards as card (card.label)}
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{card.label}</Card.Description>
          <Card.Title class="text-3xl tabular-nums">{card.value}</Card.Title>
        </Card.Header>
        <Card.Content>
          <p class="text-muted-foreground text-xs">{card.hint}</p>
        </Card.Content>
      </Card.Root>
    {/each}
  </div>

  <Card.Root>
    <Card.Header class="flex-row items-center justify-between">
      <div>
        <Card.Title class="text-base">최근 공연 신청 문의</Card.Title>
        <Card.Description>랜딩 페이지에서 접수된 신청입니다.</Card.Description>
      </div>
      <Button href="/admin/inquiries" variant="outline" size="sm">전체 보기</Button>
    </Card.Header>
    <Card.Content>
      {#if inquiries.length === 0}
        <p class="text-muted-foreground py-8 text-center text-sm">아직 접수된 문의가 없습니다.</p>
      {:else}
        <ul class="divide-border/60 divide-y">
          {#each inquiries as inquiry (inquiry.id)}
            <li class="flex items-center gap-3 py-3">
              <Badge variant={inquiry.status === "NEW" ? "default" : "secondary"}>
                {INQUIRY_STATUS_LABELS[inquiry.status] ?? inquiry.status}
              </Badge>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{inquiry.orgName} · {inquiry.contactName}</p>
                <p class="text-muted-foreground truncate text-xs">{inquiry.message}</p>
              </div>
              <span class="text-muted-foreground shrink-0 text-xs">{formatRelative(inquiry.createdAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}
