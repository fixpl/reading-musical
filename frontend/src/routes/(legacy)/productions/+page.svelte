<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { fetchCurrentUser, isAdminRole } from "$lib/api/auth";

  // 구 공연 목록 — 역할에 따라 새 화면으로 보낸다.
  onMount(async () => {
    const me = await fetchCurrentUser();
    if (!me) {
      await goto("/login");
      return;
    }
    await goto(isAdminRole(me.platformRole) ? "/admin/productions" : "/app", { replaceState: true });
  });
</script>

<p class="text-muted-foreground p-6 text-sm">새 화면으로 이동 중…</p>
