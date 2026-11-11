// Service Worker: zeigt Push-Nachrichten an, auch wenn die App geschlossen ist.

// Außerdem: Offline-Modus für Funklöcher im Park. Alles wird zuerst frisch aus dem Netz geholt;
// klappt das nicht (schnell genug), kommt die zuletzt gespeicherte Version.

const CACHE = "ep-v2";
const SHELL = ["/", "/app.js", "/style.css", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function networkFirst(request, ms) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(ms)]);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (!cached) throw e;
    // Markieren, damit die App „Offline“ anzeigen kann
    const headers = new Headers(cached.headers);
    headers.set("X-Offline", "1");
    return new Response(cached.body, { status: cached.status, headers });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.startsWith("/api/") && url.pathname !== "/api/waits") return;
  if (sameOrigin || url.hostname === "unpkg.com") {
    event.respondWith(networkFirst(req, url.pathname === "/api/waits" ? 8000 : 4000));
  }
  // Kartenkacheln usw. laufen normal übers Netz
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Europa-Park", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/badge.png",
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) if ("focus" in client) return client.focus();
      return self.clients.openWindow("/");
    }),
  );
});
