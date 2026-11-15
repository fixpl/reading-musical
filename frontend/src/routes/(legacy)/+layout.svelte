<script lang="ts">
  // 이전에 발급한 게스트 리딩 링크(/r/…)만 남아 있는 구역. 전용 스타일을 이 구역에서만 불러온다.
  import "$lib/styles/legacy.css";

  let { children } = $props();
</script>

<div class="legacy-shell">{@render children()}</div>

<style>
  .legacy-shell { min-height: 100dvh; }
</style>
