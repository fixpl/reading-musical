<script module lang="ts">
  export type AppIconName =
    | "bell"
    | "book-open"
    | "building"
    | "calendar"
    | "check-square"
    | "chevron-left"
    | "chevron-right"
    | "dashboard"
    | "file-edit"
    | "home"
    | "list"
    | "menu"
    | "music"
    | "panel"
    | "settings"
    | "shield"
    | "stage"
    | "user"
    | "user-check"
    | "users";
</script>

<script lang="ts">
  type Props = {
    name: AppIconName;
    size?: number;
    label?: string;
  };

  let { name, size = 18, label }: Props = $props();
</script>

<svg
  class="app-icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={label ? undefined : "true"}
  role={label ? "img" : undefined}
  aria-label={label}
>
  {#if name === "bell"}
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 21h4" />
  {:else if name === "book-open"}
    <path d="M12 7v14" />
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H12V5H6.5A2.5 2.5 0 0 0 4 7.5z" />
    <path d="M20 19.5A2.5 2.5 0 0 0 17.5 17H12V5h5.5A2.5 2.5 0 0 1 20 7.5z" />
  {:else if name === "building"}
    <path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16" />
    <path d="M9 21v-5h3v5" />
    <path d="M8 7h1" />
    <path d="M12 7h1" />
    <path d="M8 11h1" />
    <path d="M12 11h1" />
    <path d="M3 21h18" />
  {:else if name === "calendar"}
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18" />
    <path d="M8 14h.01" />
    <path d="M12 14h.01" />
    <path d="M16 14h.01" />
  {:else if name === "check-square"}
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12.5 2.4 2.4 4.9-5.4" />
  {:else if name === "chevron-left"}
    <path d="m15 18-6-6 6-6" />
  {:else if name === "chevron-right"}
    <path d="m9 18 6-6-6-6" />
  {:else if name === "dashboard"}
    <rect x="3" y="3" width="7" height="8" rx="2" />
    <rect x="14" y="3" width="7" height="5" rx="2" />
    <rect x="14" y="12" width="7" height="9" rx="2" />
    <rect x="3" y="15" width="7" height="6" rx="2" />
  {:else if name === "file-edit"}
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    <path d="M14 3v5h5" />
    <path d="m12 16 5.5-5.5 2 2L14 18l-3 .5z" />
  {:else if name === "home"}
    <path d="m3 11 9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M9 20v-6h6v6" />
  {:else if name === "list"}
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
  {:else if name === "menu"}
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  {:else if name === "music"}
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  {:else if name === "panel"}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16" />
    <path d="M3 9h18" />
  {:else if name === "settings"}
    <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-2 .1 1.7 1.7 0 0 0-.8 1.6V22H9.2v-.2a1.7 1.7 0 0 0-.8-1.6 1.7 1.7 0 0 0-2-.1l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H2v-4h1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 2-.1A1.7 1.7 0 0 0 9.2 2V2h5.6v.2a1.7 1.7 0 0 0 .8 1.6 1.7 1.7 0 0 0 2 .1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h1v4h-1a1.7 1.7 0 0 0-1.6 1" />
  {:else if name === "shield"}
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    <path d="m9 12 2 2 4-5" />
  {:else if name === "stage"}
    <rect x="4" y="5" width="16" height="12" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    <path d="M8 9h8" />
    <path d="M8 13h5" />
  {:else if name === "user"}
    <circle cx="12" cy="8" r="4" />
    <path d="M5 21a7 7 0 0 1 14 0" />
  {:else if name === "user-check"}
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 12.2-4.6" />
    <path d="m16 19 2 2 4-5" />
  {:else if name === "users"}
    <path d="M16 21a6 6 0 0 0-12 0" />
    <circle cx="10" cy="8" r="4" />
    <path d="M22 21a5 5 0 0 0-4-4.9" />
    <path d="M16 4.2a4 4 0 0 1 0 7.6" />
  {/if}
</svg>
