import type { LngLat } from "./geo";

/*
  Hand a day's drive to a real navigation app. Every scheme here is a keyless
  universal/deep link that opens the native app on the phone (and falls back to
  the web where there is one), which keeps this in line with the no-paid-APIs
  rule.

  Only ONE of the three can follow a whole day:

  - Google Maps — universal URL, real multi-stop support via `waypoints`, order
    preserved. This is the link that does what "navigate this day" promises.
  - Apple Maps  — single destination only. Apple's Map Links reference defines
    `daddr` as "the destination point", and there is no waypoint parameter in
    any documented form; the app's own multi-stop routing (iOS 16+) is reachable
    only from URLs Apple itself generates when you share a route.
  - Waze        — single destination only; Waze has no waypoint URL parameter.

  This used to chain Apple's `daddr` with `+to:`, which is the CLASSIC GOOGLE
  scheme, not Apple's. Apple doesn't parse it — and because `+` decodes to a
  space, Apple received one run-on string ("38.01,-121.36 to:41.77,-124.09
  to:45.53,-122.66") and geocoded it as a single nonsense address, which is how
  you end up being navigated somewhere nobody asked for. So the apps that can't
  chain now say so, and take you to the next place you actually drive to.

  Why the NEXT stop rather than the day's last one: skipping silently to the end
  is the dangerous failure. On a day that runs Stockton → redwoods → Portland,
  "route the day" collapsing to Portland puts you on I-5 past everything you
  came for. Getting the next stop and re-tapping on arrival costs a tap and
  can't quietly delete half the day.
*/

export type NavProvider = "google" | "apple" | "waze";

export interface NavOption {
  provider: NavProvider;
  label: string;
  url: string;
  /** True when this app follows every stop in order. */
  multiStop: boolean;
  /**
   * Index into the `points` list this app will actually navigate to. For a
   * multi-stop link that's the final destination; otherwise the first stop
   * after the origin. Lets the caller name the place in the UI.
   */
  targetIndex: number;
}

/**
 * Google caps mobile-browser links at 3 waypoints and everything else at 9. A
 * universal link opens the Google Maps app when it's installed, which is the 9
 * case and the one worth optimizing for; without the app the link lands in the
 * browser and the tail gets dropped.
 */
const MAX_WAYPOINTS = 9;

const fmt = ([lng, lat]: LngLat) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/**
 * Thin intermediate points down to Google's cap by sampling evenly across the
 * list rather than truncating, so the link still traces the whole day.
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
  // Pipe-separated, order preserved — Google Maps URLs, Directions action.
  if (middle.length > 0) params.set("waypoints", middle.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * One destination, from wherever the phone currently is. No `saddr`: pinning
 * the start to last night's stay is wrong the moment you tap this from
 * anywhere else, and routing from the current location is what a nav app is
 * for.
 */
function appleUrl(target: LngLat): string {
  const params = new URLSearchParams({ daddr: fmt(target), dirflg: "d" });
  return `https://maps.apple.com/?${params.toString()}`;
}

function wazeUrl(target: LngLat): string {
  const [lng, lat] = target;
  return `https://waze.com/ul?ll=${lat.toFixed(5)},${lng.toFixed(5)}&navigate=yes`;
}

/**
 * Build one nav link per supported app for an ordered point list (first =
 * where you're starting, rest = the stops in order). Returns an empty list if
 * there is nothing to navigate (fewer than two points).
 *
 * Google is first because it's the only one that honors the whole list.
 */
export function directionsOptions(points: LngLat[]): NavOption[] {
  if (points.length < 2) return [];
  // The next place we actually drive to — index 0 is where we're starting from.
  const nextIndex = 1;
  const next = points[nextIndex];
  const lastIndex = points.length - 1;

  return [
    {
      provider: "google",
      label: "Google Maps",
      url: googleUrl(points),
      multiStop: true,
      targetIndex: lastIndex,
    },
    {
      provider: "apple",
      label: "Apple Maps",
      url: appleUrl(next),
      multiStop: false,
      targetIndex: nextIndex,
    },
    {
      provider: "waze",
      label: "Waze",
      url: wazeUrl(next),
      multiStop: false,
      targetIndex: nextIndex,
    },
  ];
}
