"use client";

import { OVERPASS_URL, QLEVER_OSM_URL } from "./config";
import { distToSegmentM, hashKey, samplePolyline, type LngLat } from "./geo";
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

/**
 * OSM tag values per category for the QLever SPARQL query, plus which extra
 * tags to pull back as quality/detail signals.
 */
const CATEGORY_TAGS: Record<
  SuggestionCategory,
  { key: string; values: string[]; nameOptional?: boolean; extras: string[] }
> = {
  food: { key: "amenity", values: ["restaurant", "cafe"], extras: ["cuisine", "brand"] },
  gas: { key: "amenity", values: ["fuel"], extras: ["brand"] },
  scenic: { key: "tourism", values: ["viewpoint"], nameOptional: true, extras: [] },
  attractions: {
    key: "tourism",
    values: ["attraction", "museum", "aquarium", "zoo"],
    extras: [],
  },
  lodging: {
    key: "tourism",
    values: ["hotel", "motel", "camp_site", "guest_house"],
    extras: ["stars", "brand"],
  },
  beach: { key: "natural", values: ["beach"], extras: [] },
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
  /** OSM links this place to Wikipedia/Wikidata — a strong "worth seeing" signal */
  notable?: boolean;
  tags: Record<string, string>;
}

interface Candidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** total OSM tag count — well-maintained places carry hours, website, … */
  facts: number;
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
 * Supabase poi_cache (2 days, shared by both phones; rows are purged
 * server-side on the same schedule) → QLever, with Overpass as a fallback
 * when QLever is down.
 */
export async function suggestAlongRoute(
  routeCoords: LngLat[],
  category: SuggestionCategory,
  radiusM = 2500,
): Promise<Suggestion[]> {
  if (routeCoords.length < 2) return [];
  const sampled = samplePolyline(routeCoords, 4000);
  const chain = sampled.map(([lng, lat]) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(",");
  const key = `poi-v3-${category}-${radiusM}-${hashKey(chain)}`;

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
    Date.now() - new Date(hit.updated_at).getTime() < 2 * 86400000 &&
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
  // cached empty would wrongly say "nothing here" for the next 2 days.
  if (top.length > 0) {
    db.from("poi_cache")
      .upsert({ key, payload: top, updated_at: new Date().toISOString() })
      .then(() => {});
  }

  return top;
}

/**
 * Quality score from OSM metadata. There are no review stars in OSM, but
 * places people care about accumulate tags (hours, website, cuisine, …) and
 * Wikipedia/Wikidata links — both discriminate surprisingly well.
 */
export function scoreCandidate(c: Candidate, category: SuggestionCategory): number {
  let s = Math.min(c.facts, 25);
  if (c.tags.wikipedia || c.tags.wikidata) s += 20;
  const stars = parseFloat(c.tags.stars ?? "");
  if (!Number.isNaN(stars)) s += 3 * Math.min(stars, 5);
  // For food, favor independents: chains are heavily tagged by bots, not fans.
  // For gas it's the opposite — a branded station is the dependable pick.
  if (c.tags.brand) s += category === "gas" ? 6 : category === "food" ? -6 : 0;
  return s;
}

/** How many route segments to spread picks across, so one dense town can't eat every slot. */
const SPREAD_BUCKETS = 6;
const MAX_RESULTS = 25;

/**
 * Rank candidates against the corridor: dedupe, score by quality and
 * closeness, then round-robin across sections of the route so suggestions
 * cover the whole day's drive. Final order follows the drive.
 */
export function rankCandidates(
  candidates: Candidate[],
  sampled: LngLat[],
  category: SuggestionCategory,
  radiusM: number,
): Suggestion[] {
  const nSegs = Math.max(1, sampled.length - 1);
  // gas is a utility stop — closeness to the route outweighs tag pedigree
  const distPenaltyM = category === "gas" ? 100 : 250;

  const scored: { sug: Suggestion; score: number; frac: number }[] = [];
  for (const c of candidates) {
    let offRouteM = Infinity;
    let segIdx = 0;
    for (let i = 0; i < nSegs; i++) {
      const d = distToSegmentM([c.lng, c.lat], sampled[i], sampled[Math.min(i + 1, nSegs)]);
      if (d < offRouteM) {
        offRouteM = d;
        segIdx = i;
      }
    }
    // small tolerance: distance is measured against the downsampled polyline,
    // which can read slightly long for POIs near the corridor edge
    if (offRouteM > radiusM * 1.1) continue;
    scored.push({
      sug: {
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        category,
        offRouteM: Math.round(offRouteM),
        detourS: Math.round((2 * offRouteM) / 12.5), // ~28 mph surface streets
        notable: !!(c.tags.wikipedia || c.tags.wikidata) || undefined,
        tags: c.tags,
      },
      score: scoreCandidate(c, category) - offRouteM / distPenaltyM,
      frac: segIdx / nSegs,
    });
  }

  // best-scored first, so dedupe keeps the strongest entry per place/name
  scored.sort((a, b) => b.score - a.score);
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const buckets: (typeof scored)[] = Array.from({ length: SPREAD_BUCKETS }, () => []);
  for (const s of scored) {
    if (seenIds.has(s.sug.id) || seenNames.has(s.sug.name)) continue;
    seenIds.add(s.sug.id);
    seenNames.add(s.sug.name);
    buckets[Math.min(SPREAD_BUCKETS - 1, Math.floor(s.frac * SPREAD_BUCKETS))].push(s);
  }

  // round-robin one pick per route section until full
  const picked: typeof scored = [];
  for (let round = 0; picked.length < MAX_RESULTS; round++) {
    let took = false;
    for (const b of buckets) {
      if (round < b.length && picked.length < MAX_RESULTS) {
        picked.push(b[round]);
        took = true;
      }
    }
    if (!took) break;
  }

  // present in drive order, not score order — the carousel follows the day
  picked.sort((a, b) => a.frac - b.frac || a.sug.offRouteM - b.sug.offRouteM);
  return picked.map((p) => p.sug);
}

async function fetchViaQlever(
  sampled: LngLat[],
  category: SuggestionCategory,
  radiusM: number,
): Promise<Suggestion[]> {
  const { key, values, nameOptional, extras } = CATEGORY_TAGS[category];
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
  // quality signals: total tag count + wiki links, plus per-category extras
  const extraVars = ["facts", "wikipedia", "wikidata", ...extras];
  const extraPatterns = [
    "OPTIONAL { ?id osm2rdf:facts ?facts . }",
    "OPTIONAL { ?id osmkey:wikipedia ?wikipedia . }",
    "OPTIONAL { ?id osmkey:wikidata ?wikidata . }",
    ...extras.map((t) => `OPTIONAL { ?id osmkey:${t} ?${t} . }`),
  ].join("\n      ");
  const payload = [
    "?name",
    "?id",
    ...(values.length > 1 ? ["?v"] : []),
    ...extraVars.map((v) => `?${v}`),
  ].join(" , ");
  // Circles around 4km-spaced samples must out-reach the corridor radius by
  // the half-step (2km) so POIs between two samples aren't missed; exact
  // off-route distance is re-checked client-side in rankCandidates.
  const searchM = Math.ceil(Math.hypot(radiusM, 2000));
  const query = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX osm2rdf: <https://osm2rdf.cs.uni-freiburg.de/rdf#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX spatialSearch: <https://qlever.cs.uni-freiburg.de/spatialSearch/>
SELECT ?id ?name (geof:centroid(?loc) AS ?center) ?dist ${(values.length > 1 ? ["v", ...extraVars] : extraVars).map((v) => `?${v}`).join(" ")} WHERE {
  VALUES ?pt { ${points} }
  SERVICE spatialSearch: {
    _:config spatialSearch:algorithm spatialSearch:s2 ;
             spatialSearch:left ?pt ;
             spatialSearch:right ?loc ;
             spatialSearch:maxDistance ${searchM} ;
             spatialSearch:bindDistance ?dist ;
             spatialSearch:payload ${payload} .
    {
      ${tagPattern}
      ${namePattern}
      ?id geo:hasGeometry/geo:asWKT ?loc .
      ${extraPatterns}
    }
  }
} ORDER BY ASC(?dist) LIMIT 800`;

  const res = await fetch(QLEVER_OSM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      Accept: "application/sparql-results+json",
    },
    body: query,
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`QLever ${res.status}`);
  const json = await res.json();
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) throw new Error("QLever: malformed response");

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const b of bindings) {
    const rawId = b.id?.value ?? "";
    if (seen.has(rawId)) continue; // one row per left point within reach
    seen.add(rawId);
    const m = /POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(b.center?.value ?? "");
    if (!m) continue;
    const name = b.name?.value ?? (category === "scenic" ? "Viewpoint" : null);
    if (!name) continue;
    const tags: Record<string, string> = {};
    for (const t of ["wikipedia", "wikidata", ...extras]) {
      if (b[t]?.value) tags[t] = b[t].value;
    }
    if (b.v?.value) tags[key] = b.v.value;
    // https://www.openstreetmap.org/node/123 → node-123
    const idMatch = /openstreetmap\.org\/(\w+)\/(\d+)/.exec(rawId);
    candidates.push({
      id: idMatch ? `${idMatch[1]}-${idMatch[2]}` : rawId || name,
      name,
      lat: parseFloat(m[2]),
      lng: parseFloat(m[1]),
      facts: parseInt(b.facts?.value ?? "0", 10) || 0,
      tags,
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
  const query = `[out:json][timeout:30];(${filters});out center 80;`;

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

  const candidates: Candidate[] = [];
  for (const el of (json.elements ?? []) as OverpassElement[]) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const name = el.tags?.name ?? (category === "scenic" ? "Viewpoint" : null);
    if (!name) continue;
    candidates.push({
      id: `${el.type}-${el.id}`,
      name,
      lat,
      lng,
      facts: Object.keys(el.tags ?? {}).length,
      tags: el.tags ?? {},
    });
  }
  return rankCandidates(candidates, sampled, category, radiusM);
}
