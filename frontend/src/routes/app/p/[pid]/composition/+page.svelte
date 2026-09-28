<script lang="ts">
  import { page } from "$app/stores";
  import CompositionWorkspace from "$lib/components/app/composition-workspace.svelte";
  const pid = $derived($page.params.pid ?? "");
</script>

{#key pid}
  <CompositionWorkspace {pid} />
{/key}
