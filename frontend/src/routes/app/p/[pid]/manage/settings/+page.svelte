<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { PHASE_LABELS, VISIBILITY_LABELS } from "$lib/domain/labels";

  type Production = {
    id: string;
    title: string;
    venue: string | null;
    synopsis: string | null;
    startDate: string | null;
    endDate: string | null;
    currentPhase: string;
    visibility: string;
  };

  const pid = $derived($page.params.pid ?? "");

  let production = $state<Production | null>(null);
  let loading = $state(true);
  let saving = $state(false);

  let title = $state("");
  let venue = $state("");
  let synopsis = $state("");
  let startDate = $state("");
  let endDate = $state("");
  let currentPhase = $state("PLANNING");

  onMount(load);

  async function load() {
    loading = true;
    try {
      production = await apiRequest<Production>(`/productions/${pid}`);
      title = production.title;
      venue = production.venue ?? "";
      synopsis = production.synopsis ?? "";
      startDate = production.startDate ? production.startDate.slice(0, 10) : "";
      endDate = production.endDate ? production.endDate.slice(0, 10) : "";
      currentPhase = production.currentPhase;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연 정보를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    try {
      await apiRequest(`/productions/${pid}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          venue: venue.trim() || null,
          synopsis: synopsis.trim() || null,
          startDate: startDate ? new Date(startDate).toISOString() : null,
          endDate: endDate ? new Date(endDate).toISOString() : null,
          currentPhase
        })
      });
      toast.success("공연 정보를 저장했습니다");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  async function setVisibility(next: "PUBLISHED" | "DRAFT") {
    saving = true;
    try {
      await apiRequest(`/productions/${pid}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next })
      });
      toast.success(next === "PUBLISHED" ? "공연을 공개했습니다. 참여자에게 보입니다." : "공연을 비공개로 돌렸습니다.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "변경하지 못했습니다");
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>공연 설정 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl">
  <div class="py-2">
    <h1 class="text-xl font-bold tracking-tight">공연 설정</h1>
    <p class="text-muted-foreground text-sm">{production?.title ?? ""}</p>
  </div>

  {#if loading}
    <Skeleton class="mt-2 h-96 w-full rounded-2xl" />
  {:else if production}
    <Card.Root class="mt-2">
      <Card.Content>
        <form class="grid gap-4" onsubmit={save}>
          <div class="grid gap-2">
            <Label for="title">공연 이름</Label>
            <Input id="title" bind:value={title} required maxlength={120} />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="venue">장소</Label>
              <Input id="venue" bind:value={venue} maxlength={120} placeholder="미정이면 비워두세요" />
            </div>
            <div class="grid gap-2">
              <Label>진행 단계</Label>
              <Select.Root type="single" bind:value={currentPhase}>
                <Select.Trigger class="w-full">{PHASE_LABELS[currentPhase] ?? currentPhase}</Select.Trigger>
                <Select.Content>
                  {#each Object.entries(PHASE_LABELS) as [value, label] (value)}
                    <Select.Item {value} {label} />
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="grid gap-2">
              <Label for="startDate">공연 시작일</Label>
              <Input id="startDate" type="date" bind:value={startDate} />
            </div>
            <div class="grid gap-2">
              <Label for="endDate">공연 종료일</Label>
              <Input id="endDate" type="date" bind:value={endDate} />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="synopsis">한 줄 소개</Label>
            <Input id="synopsis" bind:value={synopsis} maxlength={200} placeholder="공연을 한 문장으로" />
          </div>
          <div class="flex justify-end">
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root class="mt-4">
      <Card.Content class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 font-semibold">
            공개 상태
            <Badge variant={production.visibility === "PUBLISHED" ? "default" : "outline"}>
              {VISIBILITY_LABELS[production.visibility] ?? production.visibility}
            </Badge>
          </p>
          <p class="text-muted-foreground mt-0.5 text-sm">
            공개하면 배정된 참여자의 "내 공연" 목록에 나타납니다.
          </p>
        </div>
        {#if production.visibility === "PUBLISHED"}
          <Button variant="outline" disabled={saving} onclick={() => setVisibility("DRAFT")}>비공개로 전환</Button>
        {:else}
          <Button disabled={saving} onclick={() => setVisibility("PUBLISHED")}>공연 공개</Button>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
