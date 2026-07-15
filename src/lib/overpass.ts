"use client";

import { OVERPASS_URL, QLEVER_OSM_URL } from "./config";
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

/** OSM tag values per category, for the QLever SPARQL query. */
const CATEGORY_TAGS: Record<
  SuggestionCategory,
  { key: string; values: string[]; nameOptional?: boolean }
> = {
  food: { key: "amenity", values: ["restaurant", "cafe"] },
  gas: { key: "amenity", values: ["fuel"] },
  scenic: { key: "tourism", values: ["viewpoint"], nameOptional: true },
  attractions: { key: "tourism", values: ["attraction", "museum", "aquarium", "zoo"] },
  lodging: { key: "tourism", values: ["hotel", "motel", "camp_site", "guest_house"] },
  beach: { key: "natural", values: ["beach"] },
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

const memCache = new Map<string, Suggestion[]>();
const inflight = new Map<string, Promise<Suggestion[]>>();

/**
 * POIs within `radiusM` of a day's route corridor. Cache order: memory →
 * Supabase poi_cache (7 days, shared by both phones) → QLever, with Overpass
 * as a fallback when QLever is down.
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

  const cached = memCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = fetchSuggestions(key, sampled, chain, category, radiusM);
  inflight.set(key, p);
  try {
    const result = await p;
    memCache.set(key, result);
    return result;
  } finally {
    inflight.delete(key);
  }
}

async function fetchSuggestions(
  key: string,
  sampled: LngLat[],
  chain: string,
  category: SuggestionCategory,
  radiusM: number,
): Promise<Suggestion[]> {
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

  // QLever first — it answers the corridor query in seconds, where public
  // Overpass instances routinely exceed their own 30s query timeout on it.
  let top: Suggestion[];
  try {
    top = await fetchViaQlever(sampled, category, radiusM);
  } catch {
    top = await fetchViaOverpass(sampled, chain, category, radiusM);
  }

  // Never cache an empty result — it's usually a transient hiccup, and a
  // cached empty would wrongly say "nothing here" for the next 7 days.
  if (top.length > 0) {
    db.from("poi_cache")
      .upsert({ key, payload: top, updated_at: new Date().toISOString() })
      .then(() => {});
  }

  return top;
}

/** Rank candidates against the corridor: dedupe, filter, sort, cap at 25. */
function rankCandidates(
  candidates: { id: string; name: string; lat: number; lng: number; tags: Record<string, string> }[],
  sampled: LngLat[],
  category: SuggestionCategory,
  radiusM: number,
): Suggestion[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: Suggestion[] = [];
  for (const c of candidates) {
    if (seenIds.has(c.id) || seenNames.has(c.name)) continue;
    const offRouteM = distToPolylineM([c.lng, c.lat], sampled);
    // small tolerance: distance is measured against the downsampled polyline,
    // which can read slightly long for POIs near the corridor edge
    if (offRouteM > radiusM * 1.1) continue;
    seenIds.add(c.id);
    seenNames.add(c.name);
    out.push({
      id: c.id,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      category,
      offRouteM,
      detourS: Math.round((2 * offRouteM) / 12.5), // ~28 mph surface streets
      tags: c.tags,
    });
  }
  out.sort((a, b) => a.offRouteM - b.offRouteM);
  return out.slice(0, 25);
}

async function fetchViaQlever(
  sampled: LngLat[],
  category: SuggestionCategory,
  radiusM: number,
): Promise<Suggestion[]> {
  const { key, values, nameOptional } = CATEGORY_TAGS[category];
  const points = sampled
    .map(([lng, lat]) => `"POINT(${lng.toFixed(4)} ${lat.toFixed(4)})"^^geo:wktLiteral`)
    .join(" ");
  const tagPattern =
    values.length === 1
      ? `?id osmkey:${key} "${values[0]}" .`
      : `VALUES ?v { ${values.map((v) => `"${v}"`).join(" ")} } ?id osmkey:${key} ?v .`;
  const namePattern = nameOptional
    ? "OPTIONAL { ?id osmkey:name ?name . }"
    : "?id osmkey:name ?name .";
  // Circles around 4km-spaced samples must out-reach the corridor radius by
  // the half-step (2km) so POIs between two samples aren't missed; exact
  // off-route distance is re-checked client-side in rankCandidates.
  const searchM = Math.ceil(Math.hypot(radiusM, 2000));
  const query = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX spatialSearch: <https://qlever.cs.uni-freiburg.de/spatialSearch/>
SELECT ?id ?name (geof:centroid(?loc) AS ?center) ?dist WHERE {
  VALUES ?pt { ${points} }
  SERVICE spatialSearch: {
    _:config spatialSearch:algorithm spatialSearch:s2 ;
             spatialSearch:left ?pt ;
             spatialSearch:right ?loc ;
             spatialSearch:maxDistance ${searchM} ;
             spatialSearch:bindDistance ?dist ;
             spatialSearch:payload ?name , ?id .
    {
      ${tagPattern}
      ${namePattern}
      ?id geo:hasGeometry/geo:asWKT ?loc .
    }
  }
} ORDER BY ASC(?dist) LIMIT 400`;

  const res = await fetch(QLEVER_OSM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      Accept: "application/sparql-results+json",
    },
    body: query,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`QLever ${res.status}`);
  const json = await res.json();
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) throw new Error("QLever: malformed response");

  const candidates = [];
  for (const b of bindings) {
    const m = /POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(b.center?.value ?? "");
    if (!m) continue;
    const name =
      b.name?.value ?? (category === "scenic" ? "Viewpoint" : null);
    if (!name) continue;
    // https://www.openstreetmap.org/node/123 → node-123
    const idMatch = /openstreetmap\.org\/(\w+)\/(\d+)/.exec(b.id?.value ?? "");
    candidates.push({
      id: idMatch ? `${idMatch[1]}-${idMatch[2]}` : (b.id?.value ?? name),
      name,
      lat: parseFloat(m[2]),
      lng: parseFloat(m[1]),
      tags: {},
    });
  }
  return rankCandidates(candidates, sampled, category, radiusM);
}

async function fetchViaOverpass(
  sampled: LngLat[],
  chain: string,
  category: SuggestionCategory,
  radiusM: number,
): Promise<Suggestion[]> {
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

  const candidates = [];
  for (const el of (json.elements ?? []) as OverpassElement[]) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const name = el.tags?.name ?? (category === "scenic" ? "Viewpoint" : null);
    if (!name) continue;
    candidates.push({ id: `${el.type}-${el.id}`, name, lat, lng, tags: el.tags ?? {} });
  }
  return rankCandidates(candidates, sampled, category, radiusM);
}
