/*
  Offline shell + offline maps for Coastline.

  Two caches, two very different jobs:

  - SHELL: the app itself (pages, hashed JS/CSS chunks, fonts, icons). The trip
    DATA is persisted separately by the store (see lib/snapshot.ts); this only
    has to make sure the app opens in a dead zone.

  - MAP: OpenFreeMap style/sprite/glyph/tile responses, cache-first. Without
    this the itinerary survives a canyon but the map behind it is blank grey —
    which on a coastal road trip is most of the good parts. Tiles are cached as
    they're used AND can be warmed ahead of time from More → Offline maps
    (lib/offlineMaps.ts fetches through here; a cache-first hit costs nothing,
    so a re-run resumes rather than re-downloads).

  Strategy:
  - navigations: network-first, falling back to the last cached copy of that
    page (then /map, the default tab) when offline
  - /_next/static + /icons: cache-first — the filenames are content-hashed,
    so a cache hit can never be stale
  - OpenFreeMap: cache-first, bounded by entry count (oldest evicted first)
  - everything else (Supabase, weather, satellite imagery, /api/*): untouched.
    Caching live data here would fight the store's own reconciliation, and
    raster satellite tiles would eat the storage budget the vector map needs.
*/
const SHELL_CACHE = "coastline-shell-v1";
const MAP_CACHE = "coastline-map-v1";
const KEEP = [SHELL_CACHE, MAP_CACHE];

/** Only the keyless vector-map host. Satellite stays online-only, by design. */
const MAP_HOSTS = new Set(["tiles.openfreemap.org"]);

/**
 * Ceiling on cached map responses. Comfortably above a full trip download
 * (~a few thousand tiles) while staying a bounded, predictable footprint —
 * the browser evicts the whole origin if we're greedy, shell included.
 */
const MAX_MAP_ENTRIES = 9000;
/** Trim runs are O(cache), so amortize them rather than run one per tile. */
const TRIM_EVERY = 250;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

let putsSinceTrim = 0;

/**
 * Evict oldest-first back down to the cap. `cache.keys()` resolves in insertion
 * order, so the head of the list is the least recently ADDED — good enough, and
 * the Cache API offers no access time to do better.
 */
async function trimMapCache() {
  const cache = await caches.open(MAP_CACHE);
  const keys = await cache.keys();
  const over = keys.length - MAX_MAP_ENTRIES;
  for (let i = 0; i < over; i++) await cache.delete(keys[i]);
}

async function mapFirst(req) {
  const cache = await caches.open(MAP_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;

  try {
    const res = await fetch(req);
    // Only store real, readable responses. An opaque (no-cors) response can be
    // cached but counts many times its true size against the quota, and we
    // can't tell a 404 from a tile inside one.
    if (res.ok && (res.type === "basic" || res.type === "cors" || res.type === "default")) {
      await cache.put(req, res.clone());
      if (++putsSinceTrim >= TRIM_EVERY) {
        putsSinceTrim = 0;
        // don't make the tile wait on housekeeping
        trimMapCache().catch(() => {});
      }
    }
    return res;
  } catch {
    // Offline with nothing cached for this tile. Answer rather than throw so
    // MapLibre logs a miss and moves on (it overzooms from what it does have)
    // instead of treating it as a hard style failure.
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (MAP_HOSTS.has(url.hostname)) {
    event.respondWith(mapFirst(req));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
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
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
