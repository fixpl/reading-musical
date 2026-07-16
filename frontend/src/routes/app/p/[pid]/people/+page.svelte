<script lang="ts">
    import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Avatar from "$lib/components/ui/avatar";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
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

  async function loadPage() {
    try {
      const result = await apiRequest<{ production: { title: string }; people: Person[] }>(
        `/productions/${pid}/people`
      );
      title = result.production.title;
      people = result.people;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "참여자를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    void pid;
    void loadPage();
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
  <title>참여자 — {title}</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl">
  <div class="flex items-center gap-1 py-2">
    <Button href={`/app/p/${pid}`} variant="ghost" size="icon" class="-ms-2 size-8" aria-label="공연 홈으로">
      <ChevronLeftIcon />
    </Button>
    <div>
      <h1 class="text-xl font-bold tracking-tight">참여자</h1>
      <p class="text-muted-foreground text-sm">{title} · {people.length}명</p>
    </div>
  </div>

  {#if loading}
    <div class="mt-4 space-y-2">
      {#each Array(5) as _, i (i)}
        <Skeleton class="h-16 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if people.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">아직 참여자가 없습니다</p>
    </div>
  {:else}
    <div class="mt-4 grid gap-2">
      {#each people as person (person.id)}
        <div class="bg-card flex items-center gap-4 rounded-2xl px-5 py-4">
          <Avatar.Root class="size-10 rounded-xl">
            <Avatar.Fallback class="rounded-xl">{person.user.name.slice(0, 1)}</Avatar.Fallback>
          </Avatar.Root>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold">{person.user.name}</span>
              <Badge variant="secondary" class="text-xs">
                {PRODUCTION_ROLE_LABELS[person.primaryRole] ?? person.primaryRole}
              </Badge>
            </div>
            <p class="text-muted-foreground mt-0.5 truncate text-sm">{subtitle(person)}</p>
            {#if person.user.contactVisible && person.user.phone}
              <p class="text-muted-foreground mt-0.5 text-xs">{person.user.phone} · {person.user.email}</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
