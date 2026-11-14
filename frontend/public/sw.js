// The staff app's service worker: it shows alerts the server pushes while the app
// is closed, and opens the app when one is tapped. It has no fetch handler on
// purpose: pages load from the network exactly as they would without it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function tellPages(message) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  windows.forEach((client) => client.postMessage(message));
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // An open staff app shows the new alert at once, without waiting for its next refresh.
      await tellPages({ type: "alert-pushed", tag: data.tag ?? null });
      try {
        await self.registration.showNotification(data.title || "התראה חדשה", {
          body: data.body || "",
          // A newer alert for the same item replaces the one before, and rings again.
          tag: data.tag,
          renotify: Boolean(data.tag),
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          dir: "rtl",
          lang: "he",
          data: { url: data.url || "/staff" },
        });
        await tellPages({ type: "alert-shown", tag: data.tag ?? null });
      } catch (error) {
        await tellPages({ type: "alert-not-shown", message: String(error) });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/staff", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(target));
      if (open) {
        await open.focus();
        open.postMessage({ type: "alert-opened" });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
