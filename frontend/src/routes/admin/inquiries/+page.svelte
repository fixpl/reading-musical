<script lang="ts">
  import { onDestroy } from "svelte";
  import MailReadiness from "$lib/components/admin/MailReadiness.svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import * as Table from "$lib/components/ui/table";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { apiRequest } from "$lib/api/client";
  import { INQUIRY_LABELS, type ManagedInquiry } from "$lib/api/inquiries";
  import { displayPolicy, POLICY_LABELS } from "$lib/api/site";
  import { formatRelative } from "$lib/domain/labels";
  import { setNewInquiryCount } from "$lib/stores/admin-badges";
  let items = $state<ManagedInquiry[]>([]); let total = $state(0); let currentPage = $state(1);
  let q = $state(""); let filter = $state("all"); let loading = $state(true); let error = $state(""); let sequence = 0;
  const linkedProduction = $derived($page.url.searchParams.get("productionId") || "");
  const site = $derived($page.data.site);
  const inquiryPolicies = ["PRIVACY_POLICY", "INQUIRY_PRIVACY"] as const;
  const missingPolicies = $derived(inquiryPolicies.filter((kind) => !displayPolicy(site, kind)));
  $effect(() => { const source = $page.url.search; void load(source); });
  onDestroy(() => { sequence += 1; });
  async function load(search: string) {
    const request = ++sequence; loading = true; error = "";
    const params = new URLSearchParams(search); q = params.get("q") || ""; filter = params.get("status") || "all"; params.set("take", "30");
    try {
      const result = await apiRequest<{ items: ManagedInquiry[]; total: number; page: number; counts: Partial<Record<string, number>> }>(`/admin/inquiries?${params}`);
      if (request !== sequence) return;
      items = result.items; total = result.total; currentPage = result.page;
      if (!params.get("q") && !params.get("productionId")) setNewInquiryCount(result.counts.NEW ?? 0);
    }
    catch (failure) { if (request === sequence) error = failure instanceof Error ? failure.message : "신청 목록을 불러오지 못했어요."; }
    finally { if (request === sequence) loading = false; }
  }
  function search(target = 1) {
    const params = new URLSearchParams(); if (q.trim()) params.set("q", q.trim()); if (filter !== "all") params.set("status", filter);
    if (linkedProduction) params.set("productionId", linkedProduction); params.set("page", String(target));
    void goto(`/admin/inquiries?${params}`, { noScroll: true, keepFocus: true }).catch(() => { error = "목록을 이동하지 못했어요. 다시 시도해 주세요."; });
  }
</script>
<svelte:head><title>공연 신청·상담 — 운영 콘솔</title></svelte:head>
<div class="min-w-0 space-y-6 [word-break:keep-all] [overflow-wrap:anywhere]">
  <PageHeader title="공연 신청·상담" description="접수된 신청을 열어 답변하거나 공연을 만들 수 있어요.">{#snippet actions()}<Button href="/inquiries/new" target="_blank" rel="noopener noreferrer" variant="outline" size="touch">신청 화면 보기</Button>{/snippet}</PageHeader>
  {#if site}
    <section class="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="intake-status">
      <div class="flex flex-wrap items-center gap-2">
        <h2 id="intake-status" class="font-semibold">공연 신청 접수</h2>
        <Badge variant={site.ready.inquiry ? "secondary" : "outline"}>{site.ready.inquiry ? "접수 중" : "접수 준비 필요"}</Badge>
      </div>
      {#if !site.ready.inquiry}
        <p class="mt-2 text-sm leading-6">아래 문서를 공개하면 신청을 받을 수 있어요.</p>
        <ul class="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {#each missingPolicies as kind (kind)}
            <li><a href={`/admin/settings?tab=policy&kind=${kind}`} class="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{POLICY_LABELS[kind]} 문서 열기</a></li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
  {#if linkedProduction}<p class="text-sm">선택한 공연에 연결된 신청이에요. <a href="/admin/inquiries" class="ml-2 inline-flex min-h-11 items-center underline">전체 신청 보기</a></p>{/if}
  <form onsubmit={(event) => { event.preventDefault(); search(); }} class="flex flex-wrap items-end gap-3"><div class="grid min-w-48 flex-1 gap-2"><Label for="inquiry-search">기관·담당자·이메일 검색</Label><Input id="inquiry-search" type="search" bind:value={q} maxlength={100} /></div><div class="grid w-44 gap-2"><Label for="inquiry-filter">처리 상태</Label><Select.Root type="single" bind:value={filter}><Select.Trigger id="inquiry-filter" class="min-h-11 w-full">{filter === "all" ? "전체" : INQUIRY_LABELS[filter]}</Select.Trigger><Select.Content><Select.Item value="all" label="전체" />{#each Object.entries(INQUIRY_LABELS) as [value, label] (value)}<Select.Item {value} {label} />{/each}</Select.Content></Select.Root></div><Button type="submit" disabled={loading}>검색</Button><Button type="button" variant="outline" disabled={loading} onclick={() => load($page.url.search)}>새로고침</Button></form>
  {#if error}<ErrorPanel title="신청 목록을 불러오지 못했어요" message={error} onRetry={() => load($page.url.search)} />{#if items.length}<p class="text-muted-foreground text-xs">아래는 이전에 불러온 신청 목록이에요.</p>{/if}{/if}
  {#if loading}<Skeleton class="h-60 w-full" />{:else if !error || items.length}<div class="overflow-x-auto rounded-xl border"><Table.Root><Table.Header><Table.Row><Table.Head>상태</Table.Head><Table.Head>기관·담당자</Table.Head><Table.Head class="hidden md:table-cell">담당 운영자</Table.Head><Table.Head class="hidden lg:table-cell">연결 공연·유입</Table.Head><Table.Head>접수</Table.Head><Table.Head><span class="sr-only">상세</span></Table.Head></Table.Row></Table.Header><Table.Body>{#each items as item (item.id)}<Table.Row><Table.Cell><Badge variant={item.status === "NEW" ? "default" : "secondary"}>{INQUIRY_LABELS[item.status]}</Badge></Table.Cell><Table.Cell><a href={`/admin/inquiries/${item.id}`} class="font-medium underline-offset-4 hover:underline">{item.orgName}</a><p class="text-xs text-muted-foreground">{item.contactName} · {item.email}</p></Table.Cell><Table.Cell class="hidden md:table-cell">{item.handledBy?.name || "미배정"}</Table.Cell><Table.Cell class="hidden lg:table-cell"><p class="text-sm">{item.production?.title || "미연결"}{item.production?.deletedAt ? " · 휴지통" : ""}</p><p class="text-xs text-muted-foreground">{item.source?.page || "기존 접수"}{item.source?.campaign ? ` · ${item.source.campaign}` : ""}</p></Table.Cell><Table.Cell class="text-xs text-muted-foreground">{formatRelative(item.createdAt)}</Table.Cell><Table.Cell><Button href={`/admin/inquiries/${item.id}`} size="sm" variant="outline" class="min-h-11">내용 확인</Button></Table.Cell></Table.Row>{:else}<Table.Row><Table.Cell colspan={6} class="p-4"><EmptyState title={q || filter !== "all" ? "조건에 맞는 신청이 없어요" : "아직 접수된 공연 신청이 없어요"} description={q || filter !== "all" ? "검색어나 처리 상태를 바꿔 다시 찾아보세요." : "새 신청이 접수되면 여기에서 확인하고 답변할 수 있어요."}>{#snippet action()}{#if q || filter !== "all"}<Button type="button" variant="outline" onclick={() => { q = ""; filter = "all"; search(); }}>검색 조건 지우기</Button>{/if}{/snippet}</EmptyState></Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></div>{/if}
  <div class="flex items-center justify-between gap-3 text-sm"><span>총 {total.toLocaleString()}건</span><div class="flex items-center gap-3"><Button type="button" size="sm" variant="outline" disabled={loading || currentPage <= 1} onclick={() => search(currentPage - 1)}>이전</Button><span>{currentPage} / {Math.max(1, Math.ceil(total / 30))}</span><Button type="button" size="sm" variant="outline" disabled={loading || currentPage * 30 >= total} onclick={() => search(currentPage + 1)}>다음</Button></div></div>
  <MailReadiness />
</div>
