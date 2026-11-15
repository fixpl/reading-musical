<script lang="ts">
  // 앱 아이콘과 같은 색(호박색 바탕, 먹색 도형)을 쓴다 — 어디서든 같은 모양으로 보이게 테마 색과 분리했다.
  // 펼친 대본과 음표를 결합한 리딩뮤지컬 마크. 앱·웹에서 같은 아이콘을 사용한다.
  let { size = 32, class: className = "", rounded = true, label = "" }: { size?: number; class?: string; rounded?: boolean; label?: string } = $props();
</script>

<img src="/artbridge-icon-v3-192.png" width={size} height={size} class={className} style:border-radius={rounded ? "22%" : "0"} alt={label} aria-hidden={label ? undefined : "true"} />
