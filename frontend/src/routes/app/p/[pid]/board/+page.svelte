<script lang="ts">
  import { page } from "$app/stores";
  import ProductionCommunity from "$lib/components/app/production-community.svelte";
</script>

<ProductionCommunity pid={$page.params.pid ?? ""} />
