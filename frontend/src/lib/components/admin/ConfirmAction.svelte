<script lang="ts">
  // 호환용 래퍼: 확인 창 본체는 ui/confirm-dialog로 옮겼고, admin 화면의 import와 ask API는 그대로 유지해요.
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  let dialog: { ask: ConfirmAsk };
  export const ask: ConfirmAsk = ((...args: Parameters<ConfirmAsk>) => (dialog.ask as (...values: unknown[]) => unknown)(...args)) as ConfirmAsk;
</script>
<ConfirmDialog bind:this={dialog} />
