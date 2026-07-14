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

const memCache = new Map<string, OsrmRoute>();
const inflight = new Map<string, Promise<OsrmRoute>>();

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
    const { data } = await db
      .from("route_cache")
      .select("geometry, legs, distance_m, duration_s")
      .eq("key", key)
      .maybeSingle();

    if (data) {
      const route: OsrmRoute = {
        coordinates: data.geometry as LngLat[],
        legs: data.legs as OsrmLeg[],
        distance: Number(data.distance_m),
        duration: Number(data.duration_s),
      };
      memCache.set(key, route);
      return route;
    }

    const coordStr = points.map((p) => `${p[0]},${p[1]}`).join(";");
    const url = `${OSRM_URL}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const json = await res.json();
    if (json.code !== "Ok" || !json.routes?.[0]) {
      throw new Error(`OSRM: ${json.code ?? "no route"}`);
    }
    const r = json.routes[0];
    const route: OsrmRoute = {
      coordinates: r.geometry.coordinates as LngLat[],
      legs: (r.legs as OsrmLeg[]).map((l) => ({
        distance: l.distance,
        duration: l.duration,
      })),
      distance: r.distance,
      duration: r.duration,
    };
    memCache.set(key, route);

    // Fire-and-forget: share the computed route with the other phone.
    db.from("route_cache")
      .upsert({
        key,
        geometry: route.coordinates,
        legs: route.legs,
        distance_m: route.distance,
        duration_s: route.duration,
        updated_at: new Date().toISOString(),
      })
      .then(() => {});

    return route;
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
