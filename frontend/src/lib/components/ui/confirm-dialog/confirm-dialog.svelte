<script lang="ts">
  import { onDestroy } from "svelte";
  import { AlertDialog } from "bits-ui";
  import { buttonVariants } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import type { ConfirmOptions, ConfirmReasonOptions, ConfirmResult } from "./index";

  let open = $state(false);
  let title = $state("");
  let description = $state("");
  let confirmLabel = $state("계속");
  let destructive = $state(false);
  let reasonOptions = $state<ConfirmReasonOptions | null>(null);
  let reasonText = $state("");
  let resolve: ((result: ConfirmResult) => void) | undefined;

  const reasonMissing = $derived(Boolean(reasonOptions?.required) && !reasonText.trim());

  function show(next: { title: string; description: string; confirmLabel: string; destructive: boolean; reason: ConfirmReasonOptions | null }): Promise<ConfirmResult> {
    resolve?.({ confirmed: false });
    title = next.title; description = next.description; confirmLabel = next.confirmLabel; destructive = next.destructive;
    reasonOptions = next.reason; reasonText = ""; open = true;
    return new Promise<ConfirmResult>((done) => { resolve = done; });
  }
  export function ask(message: string, heading?: string, acceptLabel?: string): Promise<boolean>;
  export function ask(options: ConfirmOptions): Promise<ConfirmResult>;
  export function ask(first: string | ConfirmOptions, heading = "변경사항 확인", acceptLabel = "계속"): Promise<boolean | ConfirmResult> {
    if (typeof first === "string") {
      return show({ title: heading, description: first, confirmLabel: acceptLabel, destructive: false, reason: null }).then((result) => result.confirmed);
    }
    return show({ title: first.title, description: first.description ?? "", confirmLabel: first.confirmLabel ?? "계속", destructive: Boolean(first.destructive), reason: first.reason ?? null });
  }
  function settle(confirmed: boolean) {
    if (confirmed && reasonMissing) return;
    const done = resolve; resolve = undefined; open = false;
    done?.(confirmed ? { confirmed, ...(reasonOptions ? { reason: reasonText.trim() } : {}) } : { confirmed: false });
  }
  onDestroy(() => { resolve?.({ confirmed: false }); });
</script>
<AlertDialog.Root {open} onOpenChange={(value) => { if (!value) settle(false); }}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-[70] bg-black/40" />
    <AlertDialog.Content class="fixed left-1/2 top-1/2 z-[71] grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg outline-none">
      <AlertDialog.Title class="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{title}</AlertDialog.Title>
      {#if description}<AlertDialog.Description class="min-w-0 text-sm leading-7 text-muted-foreground [word-break:keep-all] [overflow-wrap:anywhere]">{description}</AlertDialog.Description>{/if}
      {#if reasonOptions}
        <div class="grid gap-1.5">
          <label for="confirm-dialog-reason" class="text-sm font-medium">{reasonOptions.label}</label>
          <Textarea id="confirm-dialog-reason" bind:value={reasonText} placeholder={reasonOptions.placeholder} required={reasonOptions.required} aria-required={reasonOptions.required} rows={3} />
        </div>
      {/if}
      <div class="flex justify-end gap-2">
        <AlertDialog.Cancel type="button" class={buttonVariants({ variant: "outline", size: "touch" })} onclick={() => settle(false)}>취소</AlertDialog.Cancel>
        <AlertDialog.Action type="button" class={buttonVariants({ variant: destructive ? "destructive" : "default", size: "touch" })} data-confirm-action disabled={reasonMissing} onclick={() => settle(true)}>{confirmLabel}</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
