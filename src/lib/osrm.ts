"use client";

import { OSRM_URL } from "./config";
import { hashKey, type LngLat } from "./geo";
import { supabase } from "./supabase";

export interface OsrmLeg {
  distance: number; // meters
  duration: number; // seconds
}

export interface OsrmRoute {
  coordinates: LngLat[];
  legs: OsrmLeg[];
  distance: number;
  duration: number;
}

export function routeCacheKey(points: LngLat[]): string {
  return (
    "osrm-v1-" +
    hashKey(points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";"))
  );
}

/**
 * The public OSRM demo's car profile runs consistently slow against reality on
 * US highways (its default speeds are conservative and unaware of traffic
 * flow): Apple/Google quote ~4h where it says ~4.5h on the Santa Barbara →
 * Big Sur leg. ETAs feed the whole schedule, so trim durations ~10% to match
 * what the navigation apps (and the actual car) will say.
 *
 * Applied at the conversion boundary only — `route_cache` rows and OSRM
 * responses stay raw, so both phones and any future re-calibration read the
 * same untouched source data. Distances are geometric truth and untouched.
 */
export const DRIVE_TIME_CALIBRATION = 0.9;

function calibrate(route: OsrmRoute): OsrmRoute {
  return {
    coordinates: route.coordinates,
    legs: route.legs.map((l) => ({
      distance: l.distance,
      duration: l.duration * DRIVE_TIME_CALIBRATION,
    })),
    distance: route.distance,
    duration: route.duration * DRIVE_TIME_CALIBRATION,
  };
}

/**
 * OSRM answered, it just can't connect these waypoints (a point snapped to an
 * island, a ferry-only hop). Deterministic — retrying the same request only
 * spends someone else's server time.
 */
export class NoRouteError extends Error {}

const memCache = new Map<string, OsrmRoute>();
const inflight = new Map<string, Promise<OsrmRoute>>();

interface RouteCacheRow {
  key: string;
  geometry: LngLat[];
  legs: OsrmLeg[];
  distance_m: number | string;
  duration_s: number | string;
}

/** Cache rows hold raw OSRM values — calibration happens here, exactly once. */
function rowToRoute(row: RouteCacheRow): OsrmRoute {
  return calibrate({
    coordinates: row.geometry,
    legs: row.legs,
    distance: Number(row.distance_m),
    duration: Number(row.duration_s),
  });
}

/**
 * Warm the in-memory cache for many routes with ONE Supabase read instead of
 * one per day — the difference between a single round trip and a dozen when
 * the app cold-starts. Best effort: on any failure fetchRoute() falls back to
 * its own per-route lookup.
 */
export async function primeRouteCache(pointLists: LngLat[][]): Promise<void> {
  const keys = [
    ...new Set(
      pointLists
        .filter((points) => points.length >= 2)
        .map(routeCacheKey)
        .filter((k) => !memCache.has(k)),
    ),
  ];
  if (keys.length < 2) return; // a lone lookup is no cheaper batched
  try {
    // bounded like every other network call here — computeRoutes awaits this
    // before any worker starts, so a stalled read would wedge all routing
    const { data } = await supabase()
      .from("route_cache")
      .select("key, geometry, legs, distance_m, duration_s")
      .in("key", keys)
      .abortSignal(AbortSignal.timeout(10_000));
    for (const row of (data ?? []) as RouteCacheRow[]) {
      memCache.set(row.key, rowToRoute(row));
    }
  } catch {
    // ignore — per-route lookups still work
  }
}

/**
 * Route through an ordered list of [lng, lat] points.
 * Cache order: memory → Supabase route_cache → OSRM public demo server.
 */
export async function fetchRoute(points: LngLat[]): Promise<OsrmRoute> {
  const key = routeCacheKey(points);
  const cached = memCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    const db = supabase();
    // a timed-out cache read resolves { data: null } (postgrest never rejects
    // on abort) — indistinguishable from a miss, so it falls through to OSRM
    const { data } = await db
      .from("route_cache")
      .select("geometry, legs, distance_m, duration_s")
      .eq("key", key)
      .abortSignal(AbortSignal.timeout(10_000))
      .maybeSingle();

    if (data) {
      const route = rowToRoute({ key, ...data } as RouteCacheRow);
      memCache.set(key, route);
      return route;
    }

    const coordStr = points.map((p) => `${p[0]},${p[1]}`).join(";");
    const url = `${OSRM_URL}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
    // hard timeout: a fetch that never settles on flaky cell data would pin
    // this key in `inflight` and hold a computeRoutes worker slot forever,
    // leaving the "routing…" pill up with no error and no retry
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const json = await res.json();
    if (json.code !== "Ok" || !json.routes?.[0]) {
      throw new NoRouteError(`OSRM: ${json.code ?? "no route"}`);
    }
    const r = json.routes[0];
    // raw, as OSRM said it — this is what the shared cache stores
    const raw: OsrmRoute = {
      coordinates: r.geometry.coordinates as LngLat[],
      legs: (r.legs as OsrmLeg[]).map((l) => ({
        distance: l.distance,
        duration: l.duration,
      })),
      distance: r.distance,
      duration: r.duration,
    };

    // Fire-and-forget: share the computed route with the other phone. Raw
    // values on purpose — rowToRoute calibrates on the way out, so a cached
    // route and a fresh one always agree.
    db.from("route_cache")
      .upsert({
        key,
        geometry: raw.coordinates,
        legs: raw.legs,
        distance_m: raw.distance,
        duration_s: raw.duration,
        updated_at: new Date().toISOString(),
      })
      .then(() => {});

    const route = calibrate(raw);
    memCache.set(key, route);
    return route;
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
