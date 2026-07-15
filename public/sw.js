/*
  Offline shell for Coastline. The itinerary data itself is persisted by the
  store (localStorage snapshot) — this worker only has to make sure the app
  SHELL opens in a dead zone: pages, hashed JS/CSS chunks, fonts, icons.

  Strategy:
  - navigations: network-first, falling back to the last cached copy of that
    page (then /map, the default tab) when offline
  - /_next/static + /icons: cache-first — the filenames are content-hashed,
    so a cache hit can never be stale
  - everything else (Supabase, tiles, weather, /api/*): untouched; caching
    live data here would fight the store's own reconciliation
*/
const CACHE = "coastline-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit ?? caches.match("/map"))
            .then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
