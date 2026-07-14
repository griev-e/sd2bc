"use client";

import { OVERPASS_URL } from "./config";
import { distToPolylineM, hashKey, samplePolyline, type LngLat } from "./geo";
import { supabase } from "./supabase";

export type SuggestionCategory =
  | "food"
  | "gas"
  | "scenic"
  | "attractions"
  | "lodging"
  | "beach";

export const SUGGESTION_CATEGORIES: {
  key: SuggestionCategory;
  label: string;
  icon: string;
}[] = [
  { key: "food", label: "Food", icon: "🍽️" },
  { key: "gas", label: "Gas", icon: "⛽️" },
  { key: "scenic", label: "Viewpoints", icon: "🌅" },
  { key: "attractions", label: "Attractions", icon: "🎟️" },
  { key: "lodging", label: "Stay", icon: "🛏️" },
  { key: "beach", label: "Beaches", icon: "🏖️" },
];

const CATEGORY_FILTERS: Record<SuggestionCategory, string[]> = {
  food: ['["amenity"~"restaurant|cafe"]["name"]'],
  gas: ['["amenity"="fuel"]["name"]'],
  scenic: ['["tourism"="viewpoint"]'],
  attractions: ['["tourism"~"attraction|museum|aquarium|zoo"]["name"]'],
  lodging: ['["tourism"~"hotel|motel|camp_site|guest_house"]["name"]'],
  beach: ['["natural"="beach"]["name"]'],
};

export interface Suggestion {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: SuggestionCategory;
  /** straight-line distance off the route, meters */
  offRouteM: number;
  /** rough round-trip detour estimate, seconds (surface roads ~28 mph) */
  detourS: number;
  tags: Record<string, string>;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * POIs within `radiusM` of a day's route corridor. Results cached in
 * Supabase (7 days) so both phones and repeat visits skip Overpass.
 */
export async function suggestAlongRoute(
  routeCoords: LngLat[],
  category: SuggestionCategory,
  radiusM = 2500,
): Promise<Suggestion[]> {
  if (routeCoords.length < 2) return [];
  const sampled = samplePolyline(routeCoords, 4000);
  const chain = sampled.map(([lng, lat]) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(",");
  const key = `poi-v2-${category}-${radiusM}-${hashKey(chain)}`;

  const db = supabase();
  const { data: hit } = await db
    .from("poi_cache")
    .select("payload, updated_at")
    .eq("key", key)
    .maybeSingle();
  // Serve only non-empty cache hits — an empty payload is almost always a
  // stale "Overpass was busy" result, so fall through and re-query instead.
  if (
    hit &&
    Date.now() - new Date(hit.updated_at).getTime() < 7 * 86400000 &&
    Array.isArray(hit.payload) &&
    hit.payload.length > 0
  ) {
    return hit.payload as Suggestion[];
  }

  const filters = CATEGORY_FILTERS[category]
    .map((f) => `nwr${f}(around:${radiusM},${chain});`)
    .join("\n");
  const query = `[out:json][timeout:30];(${filters});out center 40;`;

  // proxied through our own API route — Overpass rejects browser requests
  // that can't send a descriptive User-Agent
  // give up client-side after 50s so the UI can offer a retry instead of
  // spinning forever
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json();
  // A remark with no elements = Overpass timed out under load. Surface it as an
  // error so the UI offers a retry rather than a misleading "nothing here".
  if (json.remark && (!json.elements || json.elements.length === 0)) {
    throw new Error(`Overpass busy: ${json.remark}`);
  }

  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const el of (json.elements ?? []) as OverpassElement[]) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const name = el.tags?.name ?? (category === "scenic" ? "Viewpoint" : null);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const offRouteM = distToPolylineM([lng, lat], sampled);
    out.push({
      id: `${el.type}-${el.id}`,
      name,
      lat,
      lng,
      category,
      offRouteM,
      detourS: Math.round((2 * offRouteM) / 12.5), // ~28 mph surface streets
      tags: el.tags ?? {},
    });
  }
  out.sort((a, b) => a.offRouteM - b.offRouteM);
  const top = out.slice(0, 25);

  // Never cache an empty result — it's usually a transient Overpass hiccup, and
  // a cached empty would wrongly say "nothing here" for the next 7 days.
  if (top.length > 0) {
    db.from("poi_cache")
      .upsert({ key, payload: top, updated_at: new Date().toISOString() })
      .then(() => {});
  }

  return top;
}
