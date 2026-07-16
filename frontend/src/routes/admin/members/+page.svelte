<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Table from "$lib/components/ui/table";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest } from "$lib/api/client";
  import { PROFILE_TYPE_LABELS, USER_STATUS_LABELS, formatDate } from "$lib/domain/labels";

  type Member = {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    profileType: string;
    profileComplete: boolean;
    status: string;
    platformRole: string;
    createdAt: string;
    memberships: Array<{
      id: string;
      primaryRole: string;
      production: { id: string; title: string };
    }>;
  };

  let members = $state<Member[]>([]);
  let query = $state("");
  let loading = $state(true);

  let statusTarget = $state<Member | null>(null);
  let statusReason = $state("");
  let statusSaving = $state(false);

  onMount(load);

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams({ take: "200" });
      if (query.trim()) params.set("q", query.trim());
      members = await apiRequest<Member[]>(`/admin/members?${params.toString()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "회원 목록을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  function searchSubmit(event: SubmitEvent) {
    event.preventDefault();
    void load();
  }

  function nextStatus(member: Member) {
    return member.status === "BLOCKED" ? "ACTIVE" : "BLOCKED";
  }

  async function changeStatus() {
    if (!statusTarget) return;
    statusSaving = true;
    try {
      await apiRequest(`/admin/users/${statusTarget.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus(statusTarget), reason: statusReason.trim() })
      });
      toast.success(nextStatus(statusTarget) === "BLOCKED" ? "계정을 차단했습니다" : "계정을 복구했습니다");
      statusTarget = null;
      statusReason = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "상태를 변경하지 못했습니다");
    } finally {
      statusSaving = false;
    }
  }
</script>

<form class="flex max-w-md gap-2" onsubmit={searchSubmit}>
  <Input bind:value={query} placeholder="이름·이메일·연락처 검색" />
  <Button type="submit" variant="secondary">검색</Button>
</form>

<Card.Root>
  <Card.Content class="p-0">
    {#if loading}
      <div class="space-y-2 p-4">
        {#each Array(5) as _, i (i)}
          <Skeleton class="h-12 w-full" />
        {/each}
      </div>
    {:else if members.length === 0}
      <p class="text-muted-foreground py-14 text-center text-sm">조건에 맞는 회원이 없습니다.</p>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>이름</Table.Head>
            <Table.Head class="hidden md:table-cell">직군</Table.Head>
            <Table.Head class="hidden lg:table-cell">참여 공연</Table.Head>
            <Table.Head class="w-24">프로필</Table.Head>
            <Table.Head class="w-20">상태</Table.Head>
            <Table.Head class="hidden w-28 sm:table-cell">가입일</Table.Head>
            <Table.Head class="w-20 text-right">관리</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each members as member (member.id)}
            <Table.Row
              class="hover:bg-accent/50 cursor-pointer"
              onclick={() => goto(`/admin/members/${member.id}`)}
            >
              <Table.Cell>
                <p class="font-medium">
                  {member.name}
                  {#if member.platformRole !== "MEMBER"}
                    <Badge variant="outline" class="ms-1">운영자</Badge>
                  {/if}
                </p>
                <p class="text-muted-foreground text-xs">{member.email}</p>
              </Table.Cell>
              <Table.Cell class="hidden md:table-cell">
                {PROFILE_TYPE_LABELS[member.profileType] ?? member.profileType}
              </Table.Cell>
              <Table.Cell class="text-muted-foreground hidden lg:table-cell">
                {#if member.memberships.length === 0}
                  <span class="text-xs">-</span>
                {:else}
                  <span class="block max-w-[340px] truncate text-xs">
                    {member.memberships.map((m) => m.production.title).join(", ")}
                  </span>
                {/if}
              </Table.Cell>
              <Table.Cell>
                <Badge variant={member.profileComplete ? "secondary" : "outline"}>
                  {member.profileComplete ? "완성" : "미완성"}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <Badge variant={member.status === "BLOCKED" ? "destructive" : "secondary"}>
                  {USER_STATUS_LABELS[member.status] ?? member.status}
                </Badge>
              </Table.Cell>
              <Table.Cell class="text-muted-foreground hidden text-xs sm:table-cell">
                {formatDate(member.createdAt)}
              </Table.Cell>
              <Table.Cell class="text-right">
                {#if member.platformRole === "MEMBER"}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={(event) => {
                      event.stopPropagation();
                      statusTarget = member;
                      statusReason = "";
                    }}
                  >
                    {member.status === "BLOCKED" ? "복구" : "차단"}
                  </Button>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>

<Dialog.Root open={statusTarget !== null} onOpenChange={(open) => !open && (statusTarget = null)}>
  <Dialog.Content class="sm:max-w-md">
    {#if statusTarget}
      <Dialog.Header>
        <Dialog.Title>
          {statusTarget.name} 계정 {nextStatus(statusTarget) === "BLOCKED" ? "차단" : "복구"}
        </Dialog.Title>
        <Dialog.Description>운영 기록에 남길 사유를 입력해 주세요.</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="statusReason">사유</Label>
        <Textarea id="statusReason" bind:value={statusReason} rows={3} placeholder="예: 본인 요청으로 계정 정지" />
      </div>
      <Dialog.Footer>
        <Button variant="ghost" onclick={() => (statusTarget = null)}>취소</Button>
        <Button
          variant={nextStatus(statusTarget) === "BLOCKED" ? "destructive" : "default"}
          onclick={changeStatus}
          disabled={statusSaving || !statusReason.trim()}
        >
          {statusSaving ? "처리 중..." : nextStatus(statusTarget) === "BLOCKED" ? "차단" : "복구"}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
