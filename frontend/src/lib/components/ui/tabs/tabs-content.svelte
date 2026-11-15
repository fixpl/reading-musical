<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "$lib/utils";
  let { ref = $bindable(null), class: className, children, ...restProps }: TabsPrimitive.ContentProps = $props();
</script>
<TabsPrimitive.Content bind:ref data-slot="tabs-content" class={cn("min-w-0 pt-5 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden", className)} {...restProps}>
  {@render children?.()}
</TabsPrimitive.Content>
