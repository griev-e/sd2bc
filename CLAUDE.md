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
npm run dev      # next dev — local development
npm run build    # next build — production build (run before pushing UI changes)
npm run lint     # eslint (next/core-web-vitals + next/typescript)
npm test         # vitest — unit tests for the lib domain layer
```

Unit tests (Vitest) cover the pure domain layer in `src/lib/*.test.ts` — run
`npm test`. There is no CI workflow in the repo, so verify changes by running
`npm run lint`, `npm test`, and `npm run build`, and by exercising the affected
flow in `npm run dev`. `npm run build` is the real typecheck gate (`tsc
--noEmit` runs as part of it) since the project has no standalone `typecheck`
script.

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
  components/              # UI: MapView, Sheet, *Sheet editors, BottomNav, Icons, games/
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
| `budget.ts` | `computeBudget()` — the whole cost forecast as one pure function, shared by the Budget tab and the AI analyzer. |
| `directions.ts` | Keyless Google Maps directions deep link for a day's drive. |
| `ics.ts` | Client-side iCalendar export of the itinerary (one all-day event per day). |
| `server/auth.ts` | Server-only `verifyTraveler()` — Bearer-token gate for `/api/analyze` and `/api/overpass`. |
| `osrm.ts` | `fetchRoute()` with memory → Supabase `route_cache` → network. |
| `overpass.ts` | POI suggestions along a route corridor (Overpass/QLever, cached). |
| `geo.ts` | Pure geometry: haversine, point-to-polyline, region-by-latitude, `hashKey`. |
| `costs.ts` | Seed cost model (2026 regional averages) + `seedEstimate()`. |
| `schedule.ts` | Arrival/departure ETA computation per stop. |
| `weather.ts` | Open-Meteo forecasts per stop cluster (Zustand store). |
| `clusters.ts` | Group nearby stops so forecasts aren't repeated. |
| `shaping.ts` | Insert an invisible via/shaping point on a day's route. |
| `analysis.ts` | AI trip analyzer client half: `analysisKey()` (cache key = hash of the itinerary + budget knobs) and `buildAnalysisPayload()` (the compact snapshot `/api/analyze` feeds to Claude). |
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
- **Offline resilience.** The last good load is persisted to localStorage
  (`coastline-snapshot-v1`) and hydrated when `init()` can't reach Supabase;
  a service worker (`public/sw.js`) keeps the app shell openable offline. A
  failed load with no snapshot sets `loadError`, which the tabs layout renders
  as a retry screen.
- **`seq` ordering.** Ordered lists (stops within a day, days, packing within a
  category) use an integer `seq`. New `seq` is `max(existing) + 1`, **never
  `count + 1`** — deletions leave gaps and count+1 would collide. Reordering
  rewrites every affected row's `seq`.
- **`created_by` / `updated_by`** are stamped from `userId` on write.
- **Via (shaping) points** are route-only: they bend the OSRM line but never
  appear in the itinerary and are never real stops. Deleting a stop cascades to
  its via points locally and in the DB.
- **Route computation** is debounced (`scheduleRoutes`, 500ms) and re-runs only
  when route *geometry* changed — `routeGeometryChanged()` compares incoming
  Realtime rows against local state on the fields that feed `dayRoutePoints()`,
  which also swallows the echo of our own writes. Geometry mutations schedule
  the recompute locally. It's superseded-run-safe via a `routeRun` counter — a
  newer edit invalidates an in-flight batch. Days route concurrently with a
  worker pool capped at 6 to be polite to the public OSRM server.

The **Games tab** (`(tabs)/games`, `components/games/*`) is a lighter-weight
extra: five backseat mini-games (Plates, I Spy, Chains, $$$ Cars, Word Rush)
that share one append-only `game_events` table via `addGameEvent` /
`deleteGameEvent`, following the same optimistic-write-then-Realtime-reconcile
pattern as everything else. `GameId`/`GameEventKind` in `types.ts` and static
content in `gameData.ts` are the source of truth for what each game shows.

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
- **Nominatim** search is debounced and only fires from explicit user input.
- **Open-Meteo** forecasts are cached ~30 min and requested once per stop
  cluster, not per stop.

- **Anthropic** (the one keyed, paid service — used sparingly) powers the AI
  trip check. It is **manual-trigger only** and every result is cached in
  `trip_analyses`, keyed by `analysisKey()` — a hash of the exact trip state —
  so re-opens and the second phone read the cache instead of re-calling.
  `/api/analyze` is stateless; the *client* writes the cache row through the
  authenticated Supabase client (RLS applies) and Realtime syncs it across.

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
ship in the client bundle. `/api/analyze` and `/api/overpass` are gated the
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
  (`api/analyze`). Same rules: never `NEXT_PUBLIC_`, never in the client
  bundle. Without it the route answers 503 and the rest of the app is
  unaffected.

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
- Before pushing, run `npm run lint`, `npm test`, **and** `npm run build`.
- Keep changes free-service-friendly and RLS-safe. If a change needs a schema
  migration, it happens in Supabase (via the Supabase MCP) and `types.ts` must
  be updated to match — the repo has no migration files to edit.
