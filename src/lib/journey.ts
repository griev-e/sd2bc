"use client";

/**
 * The map's plan marker — the vehicle emoji that shows where the schedule
 * says we're *supposed* to be right now.
 *
 * Two halves:
 *  - a device-local pick of which emoji the marker wears (mirrors theme.ts —
 *    useSyncExternalStore + localStorage, changed in More → settings), and
 *  - pure geometry that turns the day routes into one continuous timeline and
 *    answers "where along it is distance D", "what distance is closest to this
 *    coordinate", and "where would the clock put us".
 *
 * Where we *actually* are is `lib/location.ts` (real GPS, its own blip). This
 * file only powers the plan: {@link liveDistance} reads the clock against the
 * trip schedule to place the marker, and {@link nearestOnJourney} snaps the
 * live fix onto the same timeline so the map can say how far ahead of or
 * behind the plan we're running.
 */

import { closestOnSegment, haversineM, type LngLat } from "./geo";
import { localDateISO } from "./format";
import { dayDepartMin, type StopSchedule } from "./schedule";
import { bySeq, type Day, type DayRoute, type RouteSegment, type Stop } from "./types";

/* ---- vehicle preference (device-local, like theme) --------------------- */

export interface Vehicle {
  key: string;
  emoji: string;
  label: string;
}

/** The marker's costume options — pickable in More. Road-trip flavored. */
export const VEHICLES: Vehicle[] = [
  { key: "van", emoji: "🚐", label: "Van" },
  { key: "car", emoji: "🚗", label: "Car" },
  { key: "suv", emoji: "🚙", label: "SUV" },
  { key: "pickup", emoji: "🛻", label: "Pickup" },
  { key: "bus", emoji: "🚌", label: "Bus" },
  { key: "speedster", emoji: "🏎️", label: "Speedster" },
  { key: "moto", emoji: "🏍️", label: "Motorcycle" },
  { key: "bike", emoji: "🚲", label: "Bike" },
  { key: "sail", emoji: "⛵", label: "Sailboat" },
];

const DEFAULT_VEHICLE = "van";
const KEY = "coastline-vehicle";
const listeners = new Set<() => void>();

/** For useSyncExternalStore — re-renders subscribers when the pick changes. */
export function vehicleSubscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getVehiclePref(): string {
  if (typeof window === "undefined") return DEFAULT_VEHICLE;
  const v = localStorage.getItem(KEY);
  return VEHICLES.some((x) => x.key === v) ? (v as string) : DEFAULT_VEHICLE;
}

export function serverVehiclePref(): string {
  return DEFAULT_VEHICLE;
}

export function setVehiclePref(key: string) {
  if (!VEHICLES.some((x) => x.key === key)) return;
  if (key === DEFAULT_VEHICLE) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, key);
  for (const l of listeners) l();
}

/** Emoji for a vehicle key, with a safe fallback. */
export function vehicleEmoji(key: string): string {
  return VEHICLES.find((v) => v.key === key)?.emoji ?? VEHICLES[0].emoji;
}

/* ---- journey geometry (pure) ------------------------------------------- */

interface JourneyPoint {
  lngLat: LngLat;
  /** Meters from the trip's start along the concatenated route. */
  cumDist: number;
}

/** A stop the day's route passes, pinned to its distance along the timeline. */
export interface JourneyAnchor {
  stopId: string;
  /** Meters from the trip's start. */
  dist: number;
  /**
   * Seconds of driving from the previous anchor (0 on the leg's first anchor,
   * which nothing drives to). Lets {@link liveDistance} back a departure out of
   * an arrival the same way the Days card's "Leave by" line does.
   */
  driveS: number;
}

/** One day's slice of the timeline, by distance. */
export interface JourneyLeg {
  dayId: string;
  /** Index into the orderedDays passed to buildJourney. */
  index: number;
  startDist: number;
  endDist: number;
  /**
   * Every stop on this leg in drive order, by distance — `anchors[0]` is where
   * the leg begins (the previous night's stay for days after the first), then
   * one per stop the day drives to. This is what lets {@link liveDistance} walk
   * the day stop by stop instead of assuming one constant-speed slog: without
   * it a planned two-hour lunch has the marker gliding right through town.
   * Empty when the day's route has no segments yet.
   */
  anchors: JourneyAnchor[];
}

export interface Journey {
  points: JourneyPoint[];
  legs: JourneyLeg[];
  totalDist: number;
}

/**
 * Place each stop on the leg's distance range.
 *
 * The segments carry OSRM's road distances while the leg is measured by
 * haversine over the drawn polyline — the same road, rounded differently. So
 * stops are placed by their *share* of the day's driving and scaled onto the
 * leg, which keeps the last anchor exactly on the leg's end no matter how the
 * two totals disagree.
 */
function legAnchors(
  segments: RouteSegment[],
  startDist: number,
  endDist: number,
): JourneyAnchor[] {
  if (segments.length === 0) return [];
  const total = segments.reduce((sum, seg) => sum + seg.distanceM, 0);
  const span = endDist - startDist;
  const anchors: JourneyAnchor[] = [
    { stopId: segments[0].fromStopId, dist: startDist, driveS: 0 },
  ];
  let run = 0;
  for (const seg of segments) {
    run += seg.distanceM;
    anchors.push({
      stopId: seg.toStopId,
      dist: total > 0 ? startDist + (run / total) * span : endDist,
      driveS: seg.durationS,
    });
  }
  return anchors;
}

/**
 * Stitch every day's drawn route into one distance-parameterized polyline.
 * Consecutive days already share their boundary point (each day's line begins
 * at the previous overnight stop), so concatenating adds a ~0-length hop at
 * the seam rather than a visible jump. Days with no drivable route contribute
 * a zero-length leg pinned at the current distance (the marker just rests).
 */
export function buildJourney(
  orderedDays: Day[],
  routes: Record<string, DayRoute>,
): Journey {
  const points: JourneyPoint[] = [];
  const legs: JourneyLeg[] = [];
  let cum = 0;

  orderedDays.forEach((day, index) => {
    const route = routes[day.id];
    const coords = (route?.coordinates ?? []) as LngLat[];
    if (coords.length < 2) {
      legs.push({ dayId: day.id, index, startDist: cum, endDist: cum, anchors: [] });
      return;
    }
    const startDist = cum;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) cum += haversineM(coords[i - 1], coords[i]);
      points.push({ lngLat: coords[i], cumDist: cum });
    }
    legs.push({
      dayId: day.id,
      index,
      startDist,
      endDist: cum,
      anchors: legAnchors(route?.segments ?? [], startDist, cum),
    });
  });

  return { points, legs, totalDist: cum };
}

/** The leg (day) whose distance range contains d. */
function legAt(journey: Journey, d: number): JourneyLeg | null {
  for (const leg of journey.legs) {
    if (d <= leg.endDist + 1e-6) return leg;
  }
  return journey.legs[journey.legs.length - 1] ?? null;
}

export interface JourneyPosition {
  lngLat: LngLat;
  /** orderedDays index the marker is on (day number = dayIndex + 1). */
  dayIndex: number;
  dayId: string | null;
  /** 0–1 across the whole trip. */
  progress: number;
}

/**
 * Interpolate the marker's coordinate at distance `dist` (clamped to the
 * timeline). Binary-searches the vertex list, then lerps within the straddling
 * segment — smooth motion even between sparse OSRM vertices.
 */
export function positionAtDistance(journey: Journey, dist: number): JourneyPosition | null {
  const { points, totalDist } = journey;
  if (points.length === 0) return null;
  const d = Math.max(0, Math.min(dist, totalDist));

  // first vertex whose cumulative distance has reached d
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].cumDist < d) lo = mid + 1;
    else hi = mid;
  }

  let lngLat: LngLat;
  if (lo === 0) {
    lngLat = points[0].lngLat;
  } else {
    const a = points[lo - 1];
    const b = points[lo];
    const span = b.cumDist - a.cumDist;
    const t = span > 0 ? (d - a.cumDist) / span : 0;
    lngLat = [
      a.lngLat[0] + (b.lngLat[0] - a.lngLat[0]) * t,
      a.lngLat[1] + (b.lngLat[1] - a.lngLat[1]) * t,
    ];
  }

  const leg = legAt(journey, d);
  return {
    lngLat,
    dayIndex: leg?.index ?? -1,
    dayId: leg?.dayId ?? null,
    progress: totalDist > 0 ? d / totalDist : 0,
  };
}

export interface NearestOnJourney {
  /** Distance along the timeline of the closest point to the query. */
  dist: number;
  /** How far the query sits off the route, in meters. */
  offRouteM: number;
  /** The on-route point itself. */
  lngLat: LngLat;
}

/**
 * Snap a real-world position onto the timeline: the point on the drawn route
 * closest to `p`, expressed as a distance along the whole loop. This is what
 * lets the map compare where we actually are against where the schedule says
 * we should be, in route miles rather than straight-line ones.
 *
 * Every segment is tested (the loop is a few thousand vertices at most, and
 * this runs on a slow tick, not per frame). A sweep is deliberate: the route doubles
 * back on itself up the coast and down again, so a local search from the last
 * known position could snap to the wrong pass.
 */
export function nearestOnJourney(journey: Journey, p: LngLat): NearestOnJourney | null {
  const { points } = journey;
  if (points.length === 0) return null;
  if (points.length === 1) {
    return { dist: points[0].cumDist, offRouteM: haversineM(p, points[0].lngLat), lngLat: points[0].lngLat };
  }

  let best: NearestOnJourney | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const proj = closestOnSegment(p, a.lngLat, b.lngLat);
    if (best && proj.distM >= best.offRouteM) continue;
    best = {
      dist: a.cumDist + (b.cumDist - a.cumDist) * proj.t,
      offRouteM: proj.distM,
      lngLat: proj.point,
    };
  }
  return best;
}

/**
 * When the day actually pulls out of wherever it started — the clock the marker
 * waits for before it moves an inch.
 *
 * The day's own `start_time` sets it, falling back to the app-wide 9:00
 * default (see {@link dayDepartMin}). A `start_time` on the first stop it drives to
 * then re-anchors the whole day, in either direction: a 1:00 PM check-in two
 * hours up the coast means we're still at last night's hotel until 10:52, and a
 * 7:30 AM tour six minutes away means we're gone by 7:24. The Days card already
 * shows exactly that ("Leave by …" = the first arrival minus the morning
 * drive), so the marker derives it the same way — otherwise the map has us
 * thirty miles up the road while the itinerary is still telling us not to
 * leave yet.
 *
 * Day one is the exception: its leg begins at the origin stop itself rather
 * than at a previous night's stay, so the origin's own time *is* the departure.
 */
function departMinFor(
  dayIdx: number,
  day: Day,
  leg: JourneyLeg,
  first: Stop | undefined,
  schedule: Map<string, StopSchedule>,
): number {
  if (dayIdx === 0) {
    return (first && schedule.get(first.id)?.departMin) ?? dayDepartMin(day, first);
  }
  // anchors[1] is the first stop the day drives to; anchors[0] is where we woke up
  const morning = leg.anchors[1];
  const arrival = morning ? schedule.get(morning.stopId)?.arrivalMin : undefined;
  return arrival != null ? arrival - morning.driveS / 60 : dayDepartMin(day);
}

/**
 * Distance along the timeline for the real clock, honoring the trip schedule:
 * before departure day → 0 (parked at the origin); after the final day → the
 * finish. On a travel day the marker follows the day's stops in order — driving
 * between them on each segment's own clock and *sitting still* for the length
 * of each planned stay — and rests at either end outside those hours. Mirrors
 * schedule.ts, including the day's real departure (see {@link departMinFor}):
 * the marker doesn't leave last night's stay until the itinerary says to.
 *
 * Walking the stops (rather than sweeping the day's whole distance between the
 * morning departure and the last arrival) is what keeps the marker honest as
 * the itinerary is edited: a long lunch, a 3pm check-in time, or a slow city
 * leg followed by a fast freeway one all move the marker differently, and a
 * single straight-line sweep gets every one of them wrong.
 */
export function liveDistance(
  journey: Journey,
  orderedDays: Day[],
  stops: Stop[],
  schedule: Map<string, StopSchedule>,
  now: Date,
): number {
  if (journey.totalDist === 0 || orderedDays.length === 0) return 0;

  const todayIso = localDateISO(now);
  if (todayIso < orderedDays[0].date) return 0;
  if (todayIso > orderedDays[orderedDays.length - 1].date) return journey.totalDist;

  const dayIdx = orderedDays.findIndex((d) => d.date === todayIso);
  if (dayIdx === -1) {
    // a rest date between days: sit at the most recent day's end
    let last = 0;
    for (const d of orderedDays) {
      if (d.date <= todayIso) {
        const leg = journey.legs.find((l) => l.dayId === d.id);
        if (leg) last = leg.endDist;
      }
    }
    return last;
  }

  const day = orderedDays[dayIdx];
  const leg = journey.legs.find((l) => l.dayId === day.id);
  if (!leg || leg.endDist <= leg.startDist) return leg?.startDist ?? 0;

  const dayStops = stops
    .filter((s) => s.day_id === day.id)
    .sort(bySeq);
  const first = dayStops[0];
  const last = dayStops[dayStops.length - 1];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const depart = departMinFor(dayIdx, day, leg, first, schedule);

  // Preferred path: hop stop to stop on the schedule's own times.
  if (leg.anchors.length >= 2) {
    if (nowMin <= depart) return leg.anchors[0].dist;
    let prevDepart = depart;
    for (let i = 1; i < leg.anchors.length; i++) {
      const anchor = leg.anchors[i];
      const stopSchedule = schedule.get(anchor.stopId);
      // A start_time can pull a stop earlier than the drive allows; treat a
      // non-positive window as "already there" rather than dividing by it.
      const arrivalMin = stopSchedule?.arrivalMin ?? prevDepart;
      if (nowMin < arrivalMin) {
        const prev = leg.anchors[i - 1];
        const window = arrivalMin - prevDepart;
        const frac = window > 0 ? Math.max(0, Math.min(1, (nowMin - prevDepart) / window)) : 1;
        return prev.dist + frac * (anchor.dist - prev.dist);
      }
      const departMin = stopSchedule?.departMin ?? arrivalMin;
      if (nowMin < departMin) return anchor.dist; // parked, mid-stay
      prevDepart = departMin;
    }
    return leg.anchors[leg.anchors.length - 1].dist; // day's driving done
  }

  // Fallback for a day whose route hasn't produced segments yet: sweep the
  // leg between the morning departure and the last arrival.
  const arrive = last ? schedule.get(last.id)?.arrivalMin ?? depart : depart;
  if (arrive <= depart) return leg.startDist;
  const frac = Math.max(0, Math.min(1, (nowMin - depart) / (arrive - depart)));
  return leg.startDist + frac * (leg.endDist - leg.startDist);
}
