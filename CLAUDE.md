# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

**Coastline** (repo `sd2bc`, package `coastline`) is a two-person road-trip
command center for a **San Diego → Vancouver → San Diego** loop departing
**2026-07-27**. It's a mobile-first PWA: a glass UI over a live map, realtime
sync between two phones, and a progressively-sharpening cost forecast — built
entirely on **free, keyless public services** (no paid APIs, no server we run
beyond Supabase and Vercel).

Read `README.md` for the product-level feature tour; this file is about how the
code is organized and the conventions to hold to.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (`strict: true`),
  deployed to **Vercel**.
- **Supabase** — Postgres, Auth, and Realtime (`postgres_changes`). This is the
  only backend. Schema/migrations live in the Supabase project itself (applied
  via the Supabase MCP), **not** in this repo — there is no `supabase/` dir.
- **Zustand** for client state (`src/lib/store.ts` is the heart of the app).
- **MapLibre GL JS** + **OpenFreeMap** vector tiles (light/dark) and an Esri
  raster satellite style.
- **Tailwind CSS v4** (PostCSS plugin, no `tailwind.config`) over a hand-rolled
  CSS-variable design-token layer in `src/app/globals.css`.
- **@dnd-kit** for drag-and-drop stop reordering; **motion** for animation.

External data services (all keyless): **OSRM** demo server (driving routes),
**Overpass** + **QLever** OSM SPARQL (POI suggestions), **Nominatim** (place
search), **Open-Meteo** (weather). See `src/lib/config.ts` for every endpoint.

## Commands

```bash
npm install
npm run dev        # next dev — local development
npm run build      # next build — production build (run before pushing UI changes)
npm run lint       # eslint (next/core-web-vitals + next/typescript)
npm run typecheck  # tsc --noEmit — covers test files too, which next build does not
npm test           # vitest — unit tests for the lib domain layer
```

Unit tests (Vitest) cover the pure domain layer in `src/lib/*.test.ts` — run
`npm test`. `.github/workflows/ci.yml` runs lint → typecheck → test → build on
every push and PR, but run them locally too, and exercise the affected flow in
`npm run dev`. Use `npm run typecheck`, not `npm run build`, as the type gate:
`next build` does not typecheck the `*.test.ts` fixtures, so a field added to a
row type can pass a build and still be wrong.

## Layout

```
src/
  app/
    layout.tsx            # root: fonts, PWA metadata, viewport, pre-paint theme script
    page.tsx              # "/" — redirects to /map or /login by session
    login/page.tsx        # PIN + username/password sign-in
    manifest.ts           # PWA manifest
    (tabs)/               # authed app shell (route group, max-w-md, BottomNav)
      layout.tsx          #   auth guard + store.init() + weather sync
      map/ days/ budget/ packing/ games/ more/   # the six tabs (see BottomNav order)
    api/
      overpass/route.ts   # hedged Overpass proxy (needs a real User-Agent)
      pin-login/route.ts  # shared-PIN → Supabase magic-link (uses secret key)
      analyze/route.ts    # AI trip analyzer → Anthropic API (uses ANTHROPIC_API_KEY)
      car-price/route.ts  # MSRP fallback for the cars game → Haiku (uses ANTHROPIC_API_KEY)
  components/              # UI: MapView, Sheet, *Sheet editors, BottomNav, Icons, games/
                           #   MapView keeps ONE MapLibre map alive across tab
                           #   switches (module-level singleton, detached on
                           #   unmount, style-fetch retries) — never map.remove()
  lib/                    # all non-UI logic (see below)
```

`src/lib/` — the domain layer, worth knowing by name:

| File | Responsibility |
|------|----------------|
| `store.ts` | Zustand store: all shared entities, optimistic mutations, Realtime channel, route computation. **Start here.** |
| `types.ts` | Every DB row + computed type. The schema-of-record for the client. |
| `config.ts` | All external endpoints + Supabase credentials. |
| `supabase.ts` | Browser Supabase singleton; `usernameToEmail()`. |
| `outbox.ts` | Offline write queue: network-failed mutations park here (optimistic state kept) and replay FIFO on reconnect. |
| `snapshot.ts` | The device's offline copy of the trip. **IndexedDB** is the store of record — one day's route geometry is 100–460 KB, so ten days blow the ~5 MB localStorage quota (counted in UTF-16 units), which used to fail silently inside a bare `catch`. localStorage survives only as a fallback for browsers that refuse IndexedDB, and then holds a *lean* snapshot (`leanSnapshot()` strips route coordinates; distances, segments and ETAs stay). `getSnapshotStatus()` reports where it landed so the More tab can say so. |
| `today.ts` | `buildToday()` — the live-trip view: which day we're on, the next stop still ahead of the clock, what's left to drive, tonight's stay. Pure; powers `TodayPanel`. |
| `fuel.ts` | `planFuel()` — walks the whole trip's tank (carried across day boundaries), flagging every stretch that outruns `mpg × tank_gal × FUEL_RESERVE`. A stop of kind `fuel` resets the count, so the warnings are also the fix. Pure. |
| `tiles.ts` | Slippy-map tile math for the offline map download: which tiles a route corridor touches at each zoom, plus style/sprite/glyph URL extraction. Pure. |
| `offlineMaps.ts` | Drives the "Download maps for this trip" run (Zustand): resolves both styles, plans tiles, fetches them through the service worker on a 6-wide pool. |
| `budget.ts` | `computeBudget()` — the whole cost forecast as one pure function, shared by the Budget tab and the AI analyzer. |
| `directions.ts` | Keyless nav deep links for a day's drive. **Only Google Maps can take a multi-stop day in a URL** — Apple's `daddr` is a single destination point and Waze has no waypoint parameter, so those two get the *next* stop and say so. Never chain Apple's `daddr` with `+to:`: that's the classic Google syntax, Apple doesn't parse it, and `+` decodes to a space so Apple geocodes the whole run-on string as one bogus address. |
| `ics.ts` | Client-side iCalendar export of the itinerary (one all-day event per day). |
| `server/auth.ts` | Server-only `verifyTraveler()` — Bearer-token gate for `/api/analyze` and `/api/overpass`. |
| `osrm.ts` | `fetchRoute()` with memory → Supabase `route_cache` → network. Durations are calibrated (`DRIVE_TIME_CALIBRATION`, −10%) on the way out — the OSRM demo runs slow vs. Apple/Google — while `route_cache` always stores raw OSRM values. |
| `overpass.ts` | POI suggestions along a route corridor (Overpass/QLever, cached). |
| `geo.ts` | Pure geometry: haversine, point-to-segment projection, accuracy rings, region-by-latitude, `hashKey`. |
| `journey.ts` | The map's plan marker: stitches the day routes into one distance timeline, `positionAtDistance()`, `nearestOnJourney()` (snap a GPS fix onto the route), `liveDistance()` (where the clock says we'd be), plus the device-local vehicle-emoji pick. |
| `location.ts` | Live device location (Zustand): a `watchPosition` wrapper behind an explicit opt-in (More → My location, or the map's locate button). The on/off choice is device-local (`coastline-location`); nothing calls geolocation until it's set, so the browser prompt only ever follows a tap. Silent resume once granted, watch paused while backgrounded, fix kept in memory only. |
| `costs.ts` | Seed cost model (2026 regional averages) + `seedEstimate()`. |
| `schedule.ts` | Arrival/departure ETA computation per stop. |
| `weather.ts` | Open-Meteo forecasts per stop cluster (Zustand store). |
| `clusters.ts` | Group nearby stops so forecasts aren't repeated. |
| `shaping.ts` | Insert an invisible via/shaping point on a day's route. |
| `analysis.ts` | AI trip analyzer client half: `analysisKey()` (cache key = hash of the itinerary + budget knobs) and `buildAnalysisPayload()` (the compact snapshot `/api/analyze` feeds to Claude). |
| `plateRank.ts` | Beli-style license-plate rating: per-person ranking document (the latest `score` game event with key `ranking:<ownerId>` — writable by either traveler, so the passenger can enter the driver's take), sentiment buckets with fixed score bands, binary-insert duel math, positional 0–10 scores, combined leaderboard. Pure. |
| `carData.ts` | Car catalog for the `$$$ Cars` game: `CAR_CATALOG` is the current (`CATALOG_YEAR`) lineup, make → model → trim → base MSRP; `LEGACY_CATALOG` is past-generation trims tagged with the model years each was sold (`from`/`to`) at their price when new. Both hand-curated — no free keyless MSRP feed exists (NHTSA vPIC has makes/models but no prices or trims). The legacy half exists because most of what rolls past isn't new and the trim names are generation-specific: an AMG GT R is not an AMG GT 63. |
| `carPrice.ts` | `$$$ Cars` domain logic: **year-scoped** cascading make/model/trim lookups (`makeNames`/`modelsForMake`/`trimsForModel` all take a model year — an older year unlocks departed marques and era-correct trims), `catalogMsrp()` (exact hit from whichever table covers the year, or null — never a guess), price tiers with doubling point values (`tierOf`, `scoreFor`), the co-op scoreboard (`teamHaul()`, `HAUL_LEVELS`), `carPriceKey()` cache key, and `parseSighting()` (tolerates the game's original `{name, price}` rows). Pure. |
| `carPriceLookup.ts` | `$$$ Cars` price resolution: catalog → memory → Supabase `car_price_cache` → `/api/car-price`. Only a catalog miss can reach the network, and only behind an explicit tap. |
| `packingTags.ts` | Packing auto-tagging: `suggestCategory()` (learned-neighbor + curated-lexicon classifier with typo correction and a confidence score), `detectAssignee()`, `parsePackingEntries()`, `suggestRetags()`, plus the category palette/emoji. Pure and local — no network, no model. |
| `theme.ts` | Light/dark/system preference, persisted per device. |
| `motion.ts` | Shared Motion animation tokens (springs, fades, staggered rise). All structural animation (enter/exit, layout, sheets) uses Motion with these; micro feedback (`.pressable`, color transitions) stays CSS. `prefers-reduced-motion` is honored globally via `MotionProvider`. |
| `suggestionPreview.ts` | Transient Zustand bridge: pins the current "suggest nearby" results on the map while `SuggestSheet` is open. |
| `colors.ts` `emoji.ts` `format.ts` `geocode.ts` `gameData.ts` | Palette, day badges, formatters, Nominatim search, static game content. |

## Data model & the store

The **store (`src/lib/store.ts`) is the single source of truth on the client.**
Entities: `profiles`, `trip`, `days`, `stops`, `viaPoints`, `packing`,
`gameEvents`, `analyses`, plus derived `routes` and shared UI selection
(`selectedDayId` / `selectedStopId`). `activity` is fetched on demand.

Conventions every mutation follows — **match these when adding one**:

- **Optimistic writes.** Update local state first (inserts use a
  client-generated `crypto.randomUUID()` id), then persist to Supabase
  **through the store's `runWrite()` helper**. On a server rejection
  (`"error"`), roll back the optimistic change — inserts remove the row,
  updates restore only the fields the patch touched. On a dead connection,
  `runWrite` instead queues the op in the **outbox** (`lib/outbox.ts`), keeps
  the optimistic state, and surfaces the store `toast`; the queue replays on
  reconnect. Realtime will reconcile the authoritative row either way.
- **Realtime is the reconciler.** One channel (`coastline-sync`) subscribes to
  `postgres_changes` on every shared table and funnels through `applyChange()`,
  which upserts by `id`. Any table you sync must be added to the `tables` list
  **and** to the Realtime publication in Supabase. Conflict policy is
  **last-write-wins**.
  - Realtime enforces RLS with the subscriber's JWT — the store calls
    `realtime.setAuth(access_token)` before subscribing (and re-attaches it on
    `TOKEN_REFRESHED`) so events aren't silently filtered. Preserve that if you
    touch `init()`.
  - Missed events are never replayed, so the store does a full `refetchAll()`
    after any channel drop and when the app returns to the foreground.
- **Offline resilience.** The last good load is persisted per device by
  `lib/snapshot.ts` (IndexedDB, falling back to a lean localStorage copy) and
  hydrated when `init()` can't reach Supabase; a service worker
  (`public/sw.js`) keeps the app shell openable offline and cache-firsts
  OpenFreeMap tiles. A failed load with no snapshot sets `loadError`, which the
  tabs layout renders as a retry screen. Sign-out clears the snapshot.
- **`seq` ordering.** Ordered lists (stops within a day, days, packing within a
  category) use an integer `seq`. New `seq` is `max(existing) + 1`, **never
  `count + 1`** — deletions leave gaps and count+1 would collide. Reordering
  rewrites every affected row's `seq`.
- **`created_by` / `updated_by`** are stamped from `userId` on write.
- **Via (shaping) points** are route-only: they bend the OSRM line but never
  appear in the itinerary and are never real stops. Deleting a stop cascades to
  its via points locally and in the DB.
- **`routes` is keyed by day id and must be pruned.** It's written
  incrementally as each day resolves, so a deleted day's entry survives until a
  fully-successful batch replaces the map wholesale — and the Itinerary header
  sums `Object.values(routes)`, so a stale entry pads the trip's total miles.
  `pruneRoutes()` runs on the routing-error path and in `deleteDay`.
- **Route computation** is debounced (`scheduleRoutes`, 500ms) and re-runs only
  when route *geometry* changed — `routeGeometryChanged()` compares incoming
  Realtime rows against local state on the fields that feed `dayRoutePoints()`,
  which also swallows the echo of our own writes. Geometry mutations schedule
  the recompute locally. It's superseded-run-safe via a `routeRun` counter — a
  newer edit invalidates an in-flight batch. Days route concurrently with a
  worker pool capped at 6 to be polite to the public OSRM server.

The **Games tab** (`(tabs)/games`, `components/games/*`) is a lighter-weight
extra: six backseat mini-games (Wordle, Plates, I Spy, Chains, $$$ Cars, Word
Rush) that share one append-only `game_events` table via `addGameEvent` /
`deleteGameEvent`, following the same optimistic-write-then-Realtime-reconcile
pattern as everything else. `GameId`/`GameEventKind` in `types.ts` and static
content in `gameData.ts` are the source of truth for what each game shows.
Plates additionally carries a Beli-style rater (`lib/plateRank.ts`,
`games/PlateRater.tsx`): each traveler's whole plate ranking is one JSON
document — the latest `score` event with key `ranking:<ownerId>`. The owner
lives in the key rather than `created_by` so either phone can enter either
person's take (the passenger taps while the driver dictates); re-ranks
append a fresh document and delete the owner's older ones, so rankings are
last-write-wins per owner (legacy rows with bare key `"ranking"` are still
read via `created_by`).

`$$$ Cars` is structured rather than free-text: a sighting is a year / make /
model / trim picked from `carData.ts`, and the game prices it itself
(`lib/carPrice.ts`, `lib/carPriceLookup.ts`) — catalog first, cached Haiku
lookup only on a miss, manual entry always available as an override. The
pickers are scoped to the selected model year, so an older year offers the
marques and trims of that era rather than this year's lineup. It is the one
**cooperative** game: both phones fill a single shared haul, scored by
`teamHaul()` — one joint point total, the six price tiers as a collection to
complete, and the `HAUL_LEVELS` ladder as the thing to play against. Names ride
along on each row as credit (`AttributionDot`), not as a scoreline, and either
traveler can remove any row so the passenger can log and fix entries for the
driver. Entries store the structured fields plus `msrp`/`source`;
`parseSighting()` still reads the game's original `{name, price}` rows so old
sightings keep ranking.

## Free-service etiquette (do not regress this)

The whole app is designed to never hammer a free public endpoint:

- **OSRM** routes are cached memory → Supabase `route_cache` → network, keyed by
  the exact 5-decimal waypoint list, and shared between both phones. Recomputes
  are debounced 500ms.
- **Overpass** is proxied through `api/overpass` because public mirrors reject
  browser requests without a descriptive `User-Agent`. The proxy *hedges* across
  independent mirrors (staggered start, first good answer wins, losers aborted)
  and treats an HTTP-200 `remark`/empty-elements response as a failure. Results
  cached ~2 days in `poi_cache` (rows are purged server-side by pg_cron).
- **OpenFreeMap** tiles are cache-first in the service worker, bounded to
  `MAX_MAP_ENTRIES` and evicted oldest-first. The bulk download (More →
  Offline) is **an explicit tap only**, capped at `MAX_TILES` with coarse zooms
  kept first, and runs 6-wide. Zoom stops at 11 on purpose: vector tiles
  overzoom, so z11 still renders at z16 and each extra level would be 4× the
  tiles. Satellite (Esri raster) is deliberately *not* cached.
- **Nominatim** search is debounced and only fires from explicit user input.
- **Open-Meteo** forecasts are cached ~30 min and requested once per stop
  cluster, not per stop.

- **Anthropic** (the one keyed, paid service — used sparingly) powers the AI
  trip check. It is **manual-trigger only** and every result is cached in
  `trip_analyses`, keyed by `analysisKey()` — a hash of the exact trip state —
  so re-opens and the second phone read the cache instead of re-calling.
  `/api/analyze` is stateless; the *client* writes the cache row through the
  authenticated Supabase client (RLS applies) and Realtime syncs it across.
- **Anthropic (Haiku)** also backs the `$$$ Cars` MSRP lookup, and the same
  rules apply harder because it's the cheap path: the offline `carData.ts`
  catalog answers first, only a miss reaches `/api/car-price`, that call needs
  a deliberate tap, and every answer is written to `car_price_cache` keyed by
  the normalized car — so a given car is priced once, ever, for both phones.
  The route is sized to match: Haiku, a short system prompt, `max_tokens: 200`.

When adding an external call: cache it (memory + Supabase for anything shared),
debounce user-driven calls, and prefer the existing keyless endpoints in
`config.ts`.

## Auth

Two accounts, hard-capped. Two sign-in paths, both landing in Supabase Auth:

1. **Username/password** — the UI is username-based; `usernameToEmail()`
   synthesizes an internal `@coastline.app` address for Supabase.
2. **Shared PIN** — `api/pin-login` compares a PIN (constant-time) against the
   `PIN_CODE` env var and mints a one-shot magic-link token that the client
   redeems with `verifyOtp`. This route uses the **Supabase secret key** and is
   the one place server-only secrets are required.

All data access is gated by **Row Level Security** via the
`public.is_traveler()` function — every policy requires the caller's
`auth.uid()` to exist in `profiles`, so even a stray Supabase account created
with the public anon key sees nothing. The anon/publishable key is meant to
ship in the client bundle. `/api/analyze`, `/api/car-price` and `/api/overpass` are gated the
same way server-side (`verifyTraveler()` in `lib/server/auth.ts` — clients
send their session token as a Bearer header). `/api/pin-login` rate-limits
guesses through the `pin_attempts` table (service-role only).

## Environment variables

Safe public defaults are compiled into `src/lib/config.ts`, so the app builds
and runs with **no `.env`**. Env vars override when present:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — repoint the
  Supabase project without a code change.
- `PIN_CODE`, `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) —
  server-only, required for PIN sign-in (`api/pin-login`). Never expose these to
  the client or hardcode them.
- `ANTHROPIC_API_KEY` — server-only, required for the AI trip check
  (`api/analyze`) and the cars-game MSRP fallback (`api/car-price`). Same
  rules: never `NEXT_PUBLIC_`, never in the client bundle. Without it both
  routes answer 503 and the rest of the app is unaffected — the cars game
  still prices everything in the 2026 catalog and accepts manual entries.

## Conventions & style

- **`@/*` path alias** → `src/*` (see `tsconfig.json`). Use it for imports.
- **`"use client"`** at the top of every interactive component and any `lib`
  module that touches the browser (store, supabase, weather, theme). Server-only
  code lives in `api/*/route.ts` (Node runtime; uses `node:crypto`).
- **Design tokens, not raw colors.** Style with the CSS variables and utility
  classes defined in `globals.css` (`glass`, `--accent`, `--coral`, `mono`,
  `pt-safe`, `skeleton`, etc.). The app is theme-aware (light/dark/system via
  `data-theme` on `<html>`) and **safe-area aware** for iOS PWA — keep both.
- **Day colors** come from `dayColor(i, n)` (a teal→magenta sweep); **stop
  kinds** map to hue families in `KIND_COLOR`. Reuse these, don't invent colors.
- **Formatting** goes through `src/lib/format.ts` (`fmtMiles`, `fmtDuration`,
  `fmtMoney`) — miles/USD, tabular numerals. Distances are stored in meters and
  durations in seconds; convert only at display time.
- **Dates** are `YYYY-MM-DD` strings. Do timezone-proof date math like
  `shiftDate()` in the store (anchor at `T12:00:00`), never naive `new Date(iso)`.
- **The app is mobile-first**, constrained to `max-w-md` inside `(tabs)`. Build
  for a phone in the hand: touch targets, long-press, drag, bottom nav.

## Cost model note

The budget tab is a **live forecast from the seed model** in `costs.ts` — 2026
regional gas/lodging/food averages sharpened by real route miles (per-region,
by latitude) and actual overnight stays. The budget is deliberately
forecast-only: there is no expense logging (the old `expenses` table was
removed).

## Working agreements

- **Match the surrounding code.** This codebase favors small pure functions in
  `lib`, thorough explanatory comments on non-obvious decisions (caching,
  concurrency, timezone traps), and optimistic-with-rollback mutations. Keep
  that texture.
- Before pushing, run `npm run lint`, `npm run typecheck`, `npm test`, **and**
  `npm run build` — the same four CI runs.
- Keep changes free-service-friendly and RLS-safe. If a change needs a schema
  migration, it happens in Supabase (via the Supabase MCP) and `types.ts` must
  be updated to match — the repo has no migration files to edit.
