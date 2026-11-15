<script lang="ts">
  import { ImagePlus } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";

  let { label, hint = "PNG·JPEG·WebP · 한 장당 최대 10MB", multiple = false, disabled = false, onFiles }: {
    label: string;
    hint?: string;
    multiple?: boolean;
    disabled?: boolean;
    onFiles: (files: File[]) => void;
  } = $props();

  let input: HTMLInputElement;
  let dragDepth = $state(0);
  const dragging = $derived(!disabled && dragDepth > 0);

  function selected(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    target.value = "";
    if (!disabled && files.length) onFiles(multiple ? files : files.slice(0, 1));
  }

  function dragEnter(event: DragEvent) {
    event.preventDefault();
    if (!disabled && event.dataTransfer?.types.includes("Files")) dragDepth += 1;
  }

  function dragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  }

  function dragLeave(event: DragEvent) {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    dragDepth = 0;
    if (disabled) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }
</script>

<div
  role="group"
  aria-label={`${label} 놓기`}
  aria-disabled={disabled}
  class={`flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20"} ${disabled ? "opacity-60" : ""}`}
  ondragenter={dragEnter}
  ondragover={dragOver}
  ondragleave={dragLeave}
  ondrop={drop}
>
  <ImagePlus class="size-6 text-muted-foreground" aria-hidden="true" />
  <p class="text-sm font-medium">{label} 파일을 끌어다 놓아 주세요</p>
  <p class="text-xs leading-5 text-muted-foreground">{hint}</p>
  <Button type="button" variant="outline" {disabled} onclick={() => input.click()}>파일 선택</Button>
  <input bind:this={input} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" {multiple} {disabled} aria-label={label} class="sr-only" onchange={selected} />
</div>
