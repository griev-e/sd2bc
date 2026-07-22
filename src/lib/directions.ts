import type { LngLat } from "./geo";

/*
  Hand a day's drive to a real navigation app. Every scheme here is a keyless
  universal/deep link that opens the native app on the phone (and falls back to
  the web where there is one), which keeps this in line with the no-paid-APIs
  rule. We offer three so each traveler can use whichever app they live in:

  - Google Maps — universal URL, full multi-stop support (up to ~9 vias).
  - Apple Maps  — universal URL; intermediate stops chained with `+to:`.
  - Waze        — deep link; destination only (Waze has no waypoint URL param),
                  so it navigates from the phone's current location.
*/

export type NavProvider = "google" | "apple" | "waze";

export interface NavOption {
  provider: NavProvider;
  label: string;
  url: string;
}

/** Google/Apple both cap mobile directions links at ~9 intermediate waypoints. */
const MAX_WAYPOINTS = 9;

const fmt = ([lng, lat]: LngLat) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/**
 * Thin intermediate points down to Google/Apple's cap by sampling evenly across
 * the list rather than truncating, so the link still traces the whole day.
 */
function thinMiddle(middle: LngLat[]): LngLat[] {
  if (middle.length <= MAX_WAYPOINTS) return middle;
  const step = middle.length / MAX_WAYPOINTS;
  return Array.from({ length: MAX_WAYPOINTS }, (_, i) => middle[Math.floor(i * step)]);
}

function googleUrl(points: LngLat[]): string {
  const middle = thinMiddle(points.slice(1, -1));
  const params = new URLSearchParams({
    api: "1",
    origin: fmt(points[0]),
    destination: fmt(points[points.length - 1]),
    travelmode: "driving",
  });
  if (middle.length > 0) params.set("waypoints", middle.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function appleUrl(points: LngLat[]): string {
  // Apple Maps' universal link takes a single `daddr`; intermediate stops are
  // chained with `+to:` (classic Maps URL scheme). `dirflg=d` = driving.
  const middle = thinMiddle(points.slice(1, -1));
  const daddr = [...middle, points[points.length - 1]].map(fmt).join("+to:");
  const params = new URLSearchParams({ saddr: fmt(points[0]), dirflg: "d" });
  // URLSearchParams would percent-encode the "+to:" separators, so append daddr raw.
  return `https://maps.apple.com/?${params.toString()}&daddr=${daddr}`;
}

function wazeUrl(points: LngLat[]): string {
  // Waze has no waypoint URL param, so we can only hand it the final
  // destination; it routes there from the phone's current location.
  const [lng, lat] = points[points.length - 1];
  return `https://waze.com/ul?ll=${lat.toFixed(5)},${lng.toFixed(5)}&navigate=yes`;
}

/**
 * Build one nav link per supported app for an ordered point list (first =
 * origin, last = destination). Returns an empty list if there is nothing to
 * navigate (fewer than two points).
 */
export function directionsOptions(points: LngLat[]): NavOption[] {
  if (points.length < 2) return [];
  return [
    { provider: "apple", label: "Apple Maps", url: appleUrl(points) },
    { provider: "google", label: "Google Maps", url: googleUrl(points) },
    { provider: "waze", label: "Waze", url: wazeUrl(points) },
  ];
}
