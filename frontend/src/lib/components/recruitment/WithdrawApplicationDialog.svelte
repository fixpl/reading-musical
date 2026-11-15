<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  let { title, busy = false, error = "", onConfirm, onCancel }: {
    title: string; busy?: boolean; error?: string; onConfirm: () => void; onCancel: () => void;
  } = $props();
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
  <!-- 요청 중에는 primitive가 open 상태를 바꾸기 전에 닫기 이벤트를 막아 결과 안내를 유지한다. -->
  <Dialog.Content
    showCloseButton={false}
    class="max-h-[90dvh] overflow-y-auto sm:max-w-md"
    onEscapeKeydown={(event) => { if (busy) event.preventDefault(); }}
    onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
  >
    <Dialog.Header><Dialog.Title>지원을 취소할까요?</Dialog.Title><Dialog.Description>‘{title}’ 지원 검토가 종료돼요. 모집이 접수 중이면 다시 지원할 수 있어요.</Dialog.Description></Dialog.Header>
    {#if error}<p role="alert" class="text-sm leading-6 text-destructive">{error}</p>{/if}
    <Dialog.Footer class="gap-2"><Button type="button" variant="outline" class="min-h-11" disabled={busy} onclick={onCancel}>돌아가기</Button><Button type="button" variant="destructive" class="min-h-11" disabled={busy} onclick={onConfirm}>{busy ? "취소 중…" : "지원 취소"}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
