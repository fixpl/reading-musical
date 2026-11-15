<script lang="ts">
  import { Popover } from "bits-ui";
  import XIcon from "@lucide/svelte/icons/x";

  let { id, title, text }: { id: string; title: string; text: string } = $props();
  let open = $state(false);
</script>

<span id={`${id}-description`} class="sr-only">{text}</span>
<Popover.Root bind:open>
  <Popover.Trigger
    {id}
    type="button"
    aria-label={`${title} 도움말`}
    class="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:size-7"
  >
    <span aria-hidden="true" class="inline-flex size-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold leading-none">?</span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side="bottom"
      align="start"
      sideOffset={6}
      collisionPadding={12}
      trapFocus={false}
      preventScroll={false}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-content`}
      data-field-help={id}
      class="z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
    >
      <div class="flex items-start justify-between gap-3">
        <h2 id={`${id}-title`} class="pt-0.5 text-xs font-semibold leading-5">{title}</h2>
        <Popover.Close type="button" aria-label={`${title} 도움말 닫기`} class="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:size-7"><XIcon aria-hidden="true" class="size-3.5" /></Popover.Close>
      </div>
      <p id={`${id}-content`} class="mt-1 whitespace-pre-line text-xs leading-6 text-muted-foreground [word-break:keep-all] [overflow-wrap:anywhere]">{text}</p>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
