<script lang="ts">
  import { Switch as SwitchPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils";
  let { ref = $bindable(null), checked = $bindable(false), class: className, ...restProps }: WithoutChildrenOrChild<SwitchPrimitive.RootProps> = $props();
</script>
<SwitchPrimitive.Root bind:ref bind:checked data-slot="switch" class={cn("peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50", checked ? "bg-primary" : "bg-input", className)} {...restProps}>
  <SwitchPrimitive.Thumb data-slot="switch-thumb" class={cn("pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0")} />
</SwitchPrimitive.Root>
