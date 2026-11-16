/* Rack service worker: app-shell caching (never API data) + Web Push. */
const SHELL = "rack-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon-192.png"])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // always live, never cached

  if (url.pathname.startsWith("/assets/")) {
    // hashed filenames: cache-first is safe
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    // network-first so deploys show up; offline falls back to the cached shell
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/")),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Rack", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Rack", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      image: data.image || undefined,
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const internal = url.startsWith(self.location.origin) || url.startsWith("/");
      if (internal) {
        for (const w of wins) {
          if ("focus" in w) return w.navigate(url).then(() => w.focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
