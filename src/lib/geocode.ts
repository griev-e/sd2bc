"use client";

import { NOMINATIM_URL } from "./config";
import type { StopKind } from "./types";

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
  detail: string;
  /** Full formatted address (Nominatim display_name) — what's actually there. */
  label: string;
  /** Stop kind inferred from the place's OSM tags — colors the result icon
   *  and seeds the new stop's kind. */
  kind: StopKind;
}

// Nominatim jsonv2 reports each hit's OSM tag as category/type (e.g.
// amenity/restaurant, tourism/hotel). Map the common ones onto our stop
// kinds so a search result carries a hint of what it actually is.
const TYPE_KIND: Record<string, StopKind> = {
  restaurant: "food", cafe: "food", fast_food: "food", bar: "food",
  pub: "food", food_court: "food", ice_cream: "food", bakery: "food",
  deli: "food", biergarten: "food",
  fuel: "fuel", charging_station: "fuel",
  hotel: "lodging", motel: "lodging", hostel: "lodging",
  guest_house: "lodging", camp_site: "lodging", caravan_site: "lodging",
  chalet: "lodging", apartment: "lodging", camp_pitch: "lodging",
  beach: "beach", beach_resort: "beach",
  museum: "activity", theme_park: "activity", zoo: "activity",
  aquarium: "activity", gallery: "activity", water_park: "activity",
  attraction: "activity",
  viewpoint: "scenic", peak: "scenic", waterfall: "scenic",
  national_park: "scenic", protected_area: "scenic", nature_reserve: "scenic",
  cliff: "scenic", volcano: "scenic", hot_spring: "scenic", geyser: "scenic",
};

function kindFromOsm(category?: string, type?: string): StopKind {
  if (type && TYPE_KIND[type]) return TYPE_KIND[type];
  // anything tagged as nature we don't know by name still reads as scenic
  if (category === "natural" || category === "waterway") return "scenic";
  if (category === "leisure" && type === "park") return "scenic";
  return "stop";
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
    category?: string;
    type?: string;
  }[];
  return json.map((r) => ({
    name: r.name && r.name.length > 0 ? r.name : r.display_name.split(",")[0],
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    detail: r.display_name.split(",").slice(1, 3).join(",").trim(),
    label: r.display_name,
    kind: kindFromOsm(r.category, r.type),
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
