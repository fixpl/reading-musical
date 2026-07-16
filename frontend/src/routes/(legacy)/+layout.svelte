<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { onMount } from "svelte";
  import AppFrame from "$lib/components/AppFrame.svelte";
  import { apiRequest, getAccessToken, getWsBaseUrl } from "$lib/api/client";
  import "$lib/styles/legacy.css";

  type RealtimeSocket = {
    disconnect: () => void;
    on: (event: string, listener: (payload?: unknown) => void) => RealtimeSocket;
    off: (event: string, listener: (payload?: unknown) => void) => RealtimeSocket;
  };

  let { children } = $props();
  let unreadNotifications = $state(0);
  let notificationReady = $state(false);
  let notificationSocket: RealtimeSocket | null = null;
  let notificationSocketToken = "";

  async function loadNotificationSummary() {
    if (typeof localStorage === "undefined" || !getAccessToken()) {
      unreadNotifications = 0;
      notificationReady = false;
      return;
    }

    try {
      const summary = await apiRequest<{ unreadCount: number }>("/notifications/summary");
      unreadNotifications = summary.unreadCount;
      notificationReady = true;
    } catch {
      unreadNotifications = 0;
      notificationReady = false;
    }
  }

  onMount(() => {
    void loadNotificationSummary();
    void connectNotificationSocket();
    const listener = () => void loadNotificationSummary();
    window.addEventListener("reading-musical:notifications-changed", listener);
    return () => {
      window.removeEventListener("reading-musical:notifications-changed", listener);
      disconnectNotificationSocket();
    };
  });

  afterNavigate(() => {
    void loadNotificationSummary();
    void connectNotificationSocket();
  });

  async function connectNotificationSocket() {
    if (typeof window === "undefined") return;
    const token = getAccessToken();
    if (!token) {
      disconnectNotificationSocket();
      return;
    }
    if (notificationSocket && notificationSocketToken === token) {
      return;
    }

    disconnectNotificationSocket();
    const { io } = await import("socket.io-client");
    const socket = io(getWsBaseUrl(), {
      auth: { token },
      transports: ["websocket"],
      withCredentials: true
    }) as RealtimeSocket;
    socket.on("notification.created", handleRealtimeNotification);
    socket.on("notification.updated", handleRealtimeNotification);
    socket.on("notification.summary_changed", handleRealtimeNotification);
    socket.on("notification.error", () => disconnectNotificationSocket());
    notificationSocket = socket;
    notificationSocketToken = token;
  }

  function disconnectNotificationSocket() {
    if (notificationSocket) {
      notificationSocket.off("notification.created", handleRealtimeNotification);
      notificationSocket.off("notification.updated", handleRealtimeNotification);
      notificationSocket.off("notification.summary_changed", handleRealtimeNotification);
      notificationSocket.disconnect();
    }
    notificationSocket = null;
    notificationSocketToken = "";
  }

  function handleRealtimeNotification() {
    void loadNotificationSummary();
    window.dispatchEvent(new CustomEvent("reading-musical:notifications-realtime"));
  }
</script>

<div class="legacy-shell">
  <AppFrame {unreadNotifications} {notificationReady}>
    {@render children()}
  </AppFrame>
</div>

<style>
  .legacy-shell {
    min-height: 100dvh;
  }
</style>
