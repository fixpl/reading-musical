<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import SiteFooter from "$lib/components/site/SiteFooter.svelte";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner";
  import { flushSync, onMount } from "svelte";
  import { captureSession, subscribeSession, watchSession } from "$lib/api/session";

  let { children } = $props();
  let sessionGeneration = $state(captureSession().generation);
  onMount(() => {
    sessionGeneration = captureSession().generation;
    // 인증 경계 변경은 미저장 초안보다 우선한다. 기존 화면과 socket을 같은 flush에서 폐기한다.
    const unsubscribe = subscribeSession((session) => {
      const reset = () => { sessionGeneration = session.generation; };
      if ($effect.tracking()) reset();
      else flushSync(reset);
    });
    const stop = watchSession();
    return () => { unsubscribe(); stop(); };
  });
</script>

<ModeWatcher defaultMode="light" modeStorageKey="artbridge-mode" />
<Toaster position="top-center" richColors />
{#key sessionGeneration}{@render children()}{/key}
{#if !$page.url.pathname.startsWith("/admin") && $page.url.pathname !== "/app" && !$page.url.pathname.startsWith("/app/")}
  <SiteFooter site={$page.data.site ?? null} errorMessage={$page.data.siteError ?? ""} />
{/if}
