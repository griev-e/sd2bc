"use client";

import { NOMINATIM_URL } from "./config";

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
  detail: string;
  /** Full formatted address (Nominatim display_name) — what's actually there. */
  label: string;
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
    label: r.display_name,
  }));
}

/**
 * Reverse-geocode a coordinate to a human address via Nominatim. Used to keep
 * a stop's address label in step with where its pin actually sits. Returns the
 * full display name, or null if nothing resolves.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const url = `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { display_name?: string };
  return json.display_name && json.display_name.length > 0
    ? json.display_name
    : null;
}
