<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { newInquiryCount } from "$lib/stores/admin-badges";
  import { INQUIRY_STATUS_LABELS, formatRelative } from "$lib/domain/labels";

  type Inquiry = {
    id: string;
    orgName: string;
    contactName: string;
    email: string;
    preferredTiming: string | null;
    message: string;
    status: string;
    createdAt: string;
  };

  const STATUS_FILTERS = ["ALL", "NEW", "IN_REVIEW", "REPLIED", "CONVERTED", "CLOSED"] as const;

  let items = $state<Inquiry[]>([]);
  let counts = $state<Partial<Record<string, number>>>({});
  let filter = $state<(typeof STATUS_FILTERS)[number]>("ALL");
  let loading = $state(true);

  const filtered = $derived(filter === "ALL" ? items : items.filter((item) => item.status === filter));
  const total = $derived(items.length);

  onMount(load);

  async function load() {
    loading = true;
    try {
      const result = await apiRequest<{ items: Inquiry[]; counts: Partial<Record<string, number>> }>(
        "/admin/inquiries?take=200"
      );
      items = result.items;
      counts = result.counts;
      newInquiryCount.set(result.counts.NEW ?? 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "문의를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  function statusVariant(status: string): "default" | "secondary" | "outline" {
    if (status === "NEW") return "default";
    if (status === "CONVERTED") return "outline";
    return "secondary";
  }
</script>

<div class="flex flex-wrap items-center gap-2">
  {#each STATUS_FILTERS as value (value)}
    <Button variant={filter === value ? "secondary" : "ghost"} size="sm" onclick={() => (filter = value)}>
      {value === "ALL" ? "전체" : (INQUIRY_STATUS_LABELS[value] ?? value)}
      <span class="text-muted-foreground ms-1 tabular-nums">{value === "ALL" ? total : (counts[value] ?? 0)}</span>
    </Button>
  {/each}
</div>

<Card.Root>
  <Card.Content class="p-0">
    {#if loading}
      <div class="space-y-2 p-4">
        {#each Array(4) as _, i (i)}
          <Skeleton class="h-12 w-full" />
        {/each}
      </div>
    {:else if filtered.length === 0}
      <p class="text-muted-foreground py-14 text-center text-sm">해당 상태의 문의가 없습니다.</p>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="w-24">상태</Table.Head>
            <Table.Head>기관·담당자</Table.Head>
            <Table.Head class="hidden md:table-cell">문의 내용</Table.Head>
            <Table.Head class="hidden w-32 lg:table-cell">희망 시기</Table.Head>
            <Table.Head class="w-28 text-right">접수</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each filtered as inquiry (inquiry.id)}
            <Table.Row class="cursor-pointer" onclick={() => goto(`/admin/inquiries/${inquiry.id}`)}>
              <Table.Cell>
                <Badge variant={statusVariant(inquiry.status)}>
                  {INQUIRY_STATUS_LABELS[inquiry.status] ?? inquiry.status}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <p class="font-medium">{inquiry.orgName}</p>
                <p class="text-muted-foreground text-xs">{inquiry.contactName} · {inquiry.email}</p>
              </Table.Cell>
              <Table.Cell class="text-muted-foreground hidden max-w-md truncate md:table-cell">
                {inquiry.message}
              </Table.Cell>
              <Table.Cell class="text-muted-foreground hidden lg:table-cell">
                {inquiry.preferredTiming ?? "-"}
              </Table.Cell>
              <Table.Cell class="text-muted-foreground text-right text-xs">
                {formatRelative(inquiry.createdAt)}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
