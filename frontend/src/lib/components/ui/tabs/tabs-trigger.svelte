<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "$lib/utils";
  let { ref = $bindable(null), class: className, children, ...restProps }: TabsPrimitive.TriggerProps = $props();
</script>
<TabsPrimitive.Trigger bind:ref data-slot="tabs-trigger" class={cn("inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50", className)} {...restProps}>
  {@render children?.()}
</TabsPrimitive.Trigger>
