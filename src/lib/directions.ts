import type { LngLat } from "./geo";

/*
  Hand a day's drive to a real navigation app. Google Maps' universal URL
  scheme works keyless on iOS and Android (and falls back to the web), which
  keeps this in line with the no-paid-APIs rule.
*/

/** Google caps mobile directions links at ~9 intermediate waypoints. */
const MAX_WAYPOINTS = 9;

const fmt = ([lng, lat]: LngLat) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/**
 * Directions URL through an ordered point list (first = origin, last =
 * destination). Intermediate points beyond Google's cap are thinned evenly
 * rather than truncated so the link still traces the whole day.
 */
export function directionsUrl(points: LngLat[]): string | null {
  if (points.length < 2) return null;
  let middle = points.slice(1, -1);
  if (middle.length > MAX_WAYPOINTS) {
    const step = middle.length / MAX_WAYPOINTS;
    middle = Array.from({ length: MAX_WAYPOINTS }, (_, i) => middle[Math.floor(i * step)]);
  }
  const params = new URLSearchParams({
    api: "1",
    origin: fmt(points[0]),
    destination: fmt(points[points.length - 1]),
    travelmode: "driving",
  });
  if (middle.length > 0) params.set("waypoints", middle.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
