<script lang="ts">
  import { page } from "$app/stores";
  import * as Avatar from "$lib/components/ui/avatar";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { PRODUCTION_ROLE_LABELS, PROFILE_TYPE_LABELS } from "$lib/domain/labels";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";

  type Person = {
    id: string;
    primaryRole: string;
    roles: string[];
    user: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      profileType: string;
      contactVisible: boolean;
    };
    staffAssignments: Array<{ id: string; discipline: string; customLabel: string | null }>;
    castAssignments: Array<{ id: string; kind: string; role: { id: string; name: string } }>;
  };

  const pid = $derived($page.params.pid ?? "");

  const DISCIPLINE_LABELS: Record<string, string> = {
    SOUND: "음향",
    LIGHTING: "조명",
    STAGE_CREW: "무대",
    PROPS: "소품",
    COSTUME: "의상",
    MAKEUP: "분장",
    VIDEO: "영상",
    FRONT_OF_HOUSE: "하우스",
    PRODUCTION_ASSISTANT: "진행",
    ACCOMPANIST: "반주",
    OTHER: "기타"
  };

  let people = $state<Person[]>([]);
  let title = $state("참여자");
  let loading = $state(true);

  let loadError = $state("");
  let search = $state("");
  let requestVersion = 0;
  const filteredPeople = $derived(people.filter((person) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || [person.user.name, PROFILE_TYPE_LABELS[person.user.profileType] ?? person.user.profileType,
      ...[person.primaryRole, ...person.roles].map((role) => PRODUCTION_ROLE_LABELS[role] ?? role), subtitle(person)]
      .some((text) => text.toLocaleLowerCase().includes(query));
  }));

  async function loadPage(productionId = pid, signal?: AbortSignal) {
    const version = ++requestVersion;
    loading = true; loadError = "";
    try {
      const result = await apiRequest<{ production: { title: string }; people: Person[] }>(`/productions/${productionId}/people`, { signal });
      if (signal?.aborted || productionId !== pid || version !== requestVersion) return;
      title = result.production.title;
      people = result.people;
    } catch (error) {
      if (!signal?.aborted && productionId === pid && version === requestVersion) loadError = error instanceof Error ? error.message : "공연팀을 불러오지 못했어요.";
    } finally {
      if (!signal?.aborted && productionId === pid && version === requestVersion) loading = false;
    }
  }

  $effect(() => {
    const id = pid;
    const controller = new AbortController();
    people = []; title = "공연팀"; search = "";
    void loadPage(id, controller.signal);
    return () => controller.abort();
  });

  function subtitle(person: Person) {
    const parts: string[] = [];
    const cast = person.castAssignments.map((assignment) => assignment.role.name);
    if (cast.length > 0) {
      parts.push(`배역 · ${cast.join(", ")}`);
    }
    const staff = person.staffAssignments.map(
      (assignment) => assignment.customLabel ?? DISCIPLINE_LABELS[assignment.discipline] ?? assignment.discipline
    );
    if (staff.length > 0) {
      parts.push(`담당 · ${staff.join(", ")}`);
    }
    if (parts.length === 0) {
      parts.push(PROFILE_TYPE_LABELS[person.user.profileType] ?? person.user.profileType);
    }
    return parts.join(" / ");
  }
</script>

<svelte:head>
  <title>공연팀 — {title}</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl">
  <div class="flex items-center gap-1 py-2">
    <Button href={`/app/p/${pid}`} variant="ghost" size="icon" class="-ms-2 size-11" aria-label="공연 홈으로">
      <ChevronLeftIcon />
    </Button>
    <div>
      <h1 class="text-xl font-bold tracking-tight">공연팀</h1>
      <p class="text-muted-foreground text-sm">{title}{#if !loading && !loadError} · {people.length}명{/if}</p>
    </div>
  </div>

  {#if !loading && !loadError && people.length}<label class="mt-4 grid gap-2 text-sm font-medium">공연팀 찾기<Input class="min-h-11" type="search" bind:value={search} placeholder="이름·역할·배역·담당 분야 검색" /></label><p class="mt-2 text-xs text-muted-foreground" role="status">{filteredPeople.length}명 표시</p>{/if}

  {#if loading}
    <div class="mt-4 space-y-2">
      {#each Array(5) as _, i (i)}
        <Skeleton class="h-16 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if loadError}
    <ErrorPanel class="mt-4" title="공연팀을 불러오지 못했어요" message={loadError} onRetry={() => loadPage()} />
  {:else if people.length === 0}
    <EmptyState class="mt-4" title="아직 참여자가 없어요" description="운영팀이 참여자를 배정하거나 초대하면 이곳에서 확인할 수 있어요." />
  {:else if filteredPeople.length === 0}
    <EmptyState class="mt-4" title="검색에 맞는 참여자가 없어요" description="이름이나 담당 분야를 바꿔 검색해 보세요.">{#snippet action()}<Button variant="outline" class="min-h-11" onclick={() => search = ""}>검색어 지우기</Button>{/snippet}</EmptyState>
  {:else}
    <div class="mt-4 grid gap-2">
      {#each filteredPeople as person (person.id)}
        <div class="bg-card flex items-center gap-4 rounded-2xl px-5 py-4">
          <Avatar.Root class="size-10 rounded-xl">
            <Avatar.Fallback class="rounded-xl">{person.user.name.slice(0, 1)}</Avatar.Fallback>
          </Avatar.Root>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="break-words font-semibold">{person.user.name}</span>
              <Badge variant="secondary" class="text-xs">
                {PRODUCTION_ROLE_LABELS[person.primaryRole] ?? person.primaryRole}
              </Badge>
            </div>
            <p class="text-muted-foreground mt-0.5 break-words text-sm leading-6">{subtitle(person)}</p>
            {#if person.user.contactVisible}
              <div class="mt-1 flex flex-wrap gap-x-4 text-sm">
                {#if person.user.phone}<a href={`tel:${person.user.phone.replace(/[^+0-9]/g, "")}`} class="inline-flex min-h-11 items-center break-all underline underline-offset-4">{person.user.phone}</a>{/if}
                {#if person.user.email}<a href={`mailto:${encodeURIComponent(person.user.email)}`} class="inline-flex min-h-11 items-center break-all underline underline-offset-4">{person.user.email}</a>{/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
