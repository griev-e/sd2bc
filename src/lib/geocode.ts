"use client";

import { NOMINATIM_URL } from "./config";

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
  detail: string;
}

/** Free-text place search via Nominatim (OSM). Keyless; used sparingly. */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const url = `${NOMINATIM_URL}/search?format=jsonv2&limit=6&countrycodes=us,ca&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    display_name: string;
    name?: string;
    lat: string;
    lon: string;
  }[];
  return json.map((r) => ({
    name: r.name && r.name.length > 0 ? r.name : r.display_name.split(",")[0],
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    detail: r.display_name.split(",").slice(1, 3).join(",").trim(),
  }));
}
