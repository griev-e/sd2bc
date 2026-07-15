# Coastline

Glass UI over a live map, realtime sync between two
phones, progressive cost forecasting — built on entirely free, keyless services.

## Stack

- **Next.js 16** (App Router, TypeScript) — deploys to Vercel
- **Supabase** — Postgres, Auth (username/password), Realtime (`postgres_changes`)
- **Tailwind CSS v4** with a custom glass design-token layer
- **MapLibre GL JS** + **OpenFreeMap** vector tiles (no key)
- **OSRM** public demo server for driving routes (no key, cached in Supabase)
- **Overpass API** + **Nominatim** for stop suggestions & place search (no key, cached)

## Features

- **Map** — full-screen loop route, numbered squircle markers color-coded by day,
  day filter chips, fly-to camera moves.
- **Custom route shaping** — tap the route line to drop an invisible shaping
  point, drag it onto the road you want (Hwy 1 over I-5), OSRM re-routes through
  it. Tap the dot to remove. Shaping points never appear in the itinerary.
- **Itinerary** — 15 seeded days, drag-and-drop stop reordering (touch-friendly),
  per-segment miles + drive time, arrival estimates, overnight flags, notes.
- **Long-press the map** to add a real stop anywhere; **"Suggest nearby"** pulls
  food / gas / viewpoints / beaches / lodging along the day's route corridor.
- **Budget** — seeded 2026 regional averages (gas $/gal per state, lodging/night,
  meals) that blend into a live forecast as real expenses are logged (3+ entries
  per category → your averages win). Editable MPG, per-category bullet bars,
  50/50 split summary, expense log.
- **Packing** — pre-seeded shared checklist, assignment (me / her / shared),
  attribution dots, live sync.
- **Realtime** — every table syncs between both phones via Supabase Realtime
  with optimistic updates (last-write-wins).
- **Two accounts max** — enforced in the signup edge function *and* a database
  trigger. Signup UI is username/password; e-mail is synthesized internally.
- **PWA** — add to home screen on iOS; standalone display, safe-area aware,
  dark mode follows the system.

## Local development

```bash
npm install
npm run dev
```

Environment variables (optional — safe public defaults are compiled in via
`src/lib/config.ts`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
```

The Supabase anon/publishable key is designed to ship in client bundles;
all data access is enforced by Row Level Security (authenticated-only).

## Supabase layout

Tables: `profiles`, `trips`, `days`, `stops`, `via_points` (route shaping),
`expenses`, `packing_items`, `route_cache`, `poi_cache`, `activity_log`.
All tables have RLS (authenticated role only — the app is a private two-person
workspace). Realtime publication covers every shared table. Triggers maintain
`updated_at` and write the activity feed. The `signup` edge function creates
pre-confirmed users and hard-caps the crew at two.

Migrations live in the Supabase project (`coastline_schema`, `coastline_seed`,
`security_hardening`) and were applied via the Supabase MCP.

## Free-service etiquette

- OSRM responses are cached in `route_cache` (memory → Supabase → network) and
  keyed by the exact waypoint list, so re-opens and the second phone never
  re-fetch. Route recomputes are debounced 500 ms.
- Overpass results are cached 7 days in `poi_cache`.
- Nominatim search is debounced 450 ms and only fires from explicit user input.
