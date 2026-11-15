<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "$lib/utils";
  let { ref = $bindable(null), class: className, children, ...restProps }: TabsPrimitive.ListProps = $props();
</script>
<TabsPrimitive.List bind:ref data-slot="tabs-list" class={cn("inline-flex min-h-10 w-fit max-w-full items-center justify-start gap-1 rounded-lg bg-muted p-1 text-muted-foreground", className)} {...restProps}>
  {@render children?.()}
</TabsPrimitive.List>
