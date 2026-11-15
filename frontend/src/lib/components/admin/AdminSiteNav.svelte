<script lang="ts">
  import { page } from "$app/stores";
  import { buttonVariants } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { ADMIN_SITE_LINKS, isAdminPath } from "$lib/domain/admin-navigation";
</script>
<nav aria-label="사이트 운영 메뉴" class="flex min-w-0 flex-wrap items-center gap-2 border-b pb-4">
  {#each ADMIN_SITE_LINKS as item (item.href)}
    {@const active = isAdminPath($page.url.pathname, item.href)}
    <a href={item.href} aria-current={active ? "page" : undefined} class={cn(buttonVariants({ variant: active ? "secondary" : "ghost", size: "default" }), "min-h-10", active && "font-semibold ring-1 ring-border")}>{item.label}</a>
  {/each}
</nav>
