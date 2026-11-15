<script lang="ts">
  let { src, alt, class: className = "", fallback = "사진 준비 중", eager = false, onloaded, onfailed }: {
    src: string | null;
    alt: string;
    class?: string;
    fallback?: string;
    eager?: boolean;
    onloaded?: (source: string) => void;
    onfailed?: (source: string) => void;
  } = $props();
  let failedSource = $state<string | null>(null);
</script>

<div class={`relative overflow-hidden bg-muted ${className}`}>
  {#if src && failedSource !== src}
    <img {src} {alt} loading={eager ? "eager" : "lazy"} class="size-full object-contain" onload={(event) => onloaded?.(event.currentTarget.getAttribute("src") || "")} onerror={(event) => { const source = event.currentTarget.getAttribute("src") || ""; failedSource = source; onfailed?.(source); }} />
  {:else}
    <div class="text-muted-foreground flex size-full min-h-24 flex-col items-center justify-center gap-3 p-4 text-center" role="img" aria-label={`${alt} — ${src ? "사진을 불러오지 못했어요" : fallback}`}>
      <svg class="size-8 opacity-50" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 5h18v22H7zM11 10h10M11 14h7M11 21h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      <span class="text-xs leading-5">{src ? "사진을 불러오지 못했어요" : fallback}</span>
    </div>
  {/if}
</div>
