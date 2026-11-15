<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { useSidebar } from "$lib/components/ui/sidebar/context.svelte";
  const sidebar = useSidebar();
  afterNavigate(() => sidebar.setOpenMobile(false));
</script>
