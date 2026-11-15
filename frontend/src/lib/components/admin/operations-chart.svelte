<script lang="ts">
  import type { PhaseCount } from "$lib/domain/operations-dashboard";

  let { items }: { items: PhaseCount[] } = $props();
  const largest = $derived(Math.max(1, ...items.map((item) => item.count)));
</script>

<dl class="space-y-3">
  {#each items as item (item.key)}
    <div class="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 text-sm">
      <dt class="text-muted-foreground">{item.label}</dt>
      <dd class="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3">
        <span aria-hidden="true" class="bg-muted h-2 overflow-hidden rounded-full">
          <span class="bg-primary block h-full rounded-full" style:width={`${(item.count / largest) * 100}%`}></span>
        </span>
        <span class="text-right font-medium tabular-nums">{item.count.toLocaleString()}편</span>
      </dd>
    </div>
  {/each}
</dl>
