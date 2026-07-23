"use client";

/**
 * The moving "where are we right now" marker for the map.
 *
 * Two halves:
 *  - a device-local pick of which emoji the marker wears (mirrors theme.ts —
 *    useSyncExternalStore + localStorage, changed in More → settings), and
 *  - pure geometry that turns the day routes into one continuous timeline and
 *    answers "where along it is the trip at distance D / at clock T".
 *
 * Live mode drives the distance from the real clock through the trip schedule
 * (before the trip it sits at the origin, after it rests at the finish); the
 * map's "drive it" control instead sweeps the distance start→finish to
 * simulate the whole loop. Both feed the same {@link positionAtDistance}.
 */

import { haversineM, type LngLat } from "./geo";
import { localDateISO } from "./format";
import { DAY_START_MIN, type StopSchedule } from "./schedule";
import type { Day, DayRoute, Stop } from "./types";

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

/** One day's slice of the timeline, by distance. */
export interface JourneyLeg {
  dayId: string;
  /** Index into the orderedDays passed to buildJourney. */
  index: number;
  startDist: number;
  endDist: number;
}

export interface Journey {
  points: JourneyPoint[];
  legs: JourneyLeg[];
  totalDist: number;
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
    const coords = (routes[day.id]?.coordinates ?? []) as LngLat[];
    if (coords.length < 2) {
      legs.push({ dayId: day.id, index, startDist: cum, endDist: cum });
      return;
    }
    const startDist = cum;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) cum += haversineM(coords[i - 1], coords[i]);
      points.push({ lngLat: coords[i], cumDist: cum });
    }
    legs.push({ dayId: day.id, index, startDist, endDist: cum });
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

/**
 * Distance along the timeline for the real clock, honoring the trip schedule:
 * before departure day → 0 (parked at the origin); after the final day → the
 * finish. On a travel day the marker eases from the day's morning departure to
 * its last arrival across that day's leg, and rests at either end outside those
 * hours. Mirrors schedule.ts: day one leaves from the origin's own departure,
 * later days from the 9:00 default.
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
    .sort((a, b) => a.seq - b.seq);
  const first = dayStops[0];
  const last = dayStops[dayStops.length - 1];
  // day one departs from the origin's own clock; later days from 9:00
  const depart =
    dayIdx === 0 && first ? schedule.get(first.id)?.departMin ?? DAY_START_MIN : DAY_START_MIN;
  const arrive = last ? schedule.get(last.id)?.arrivalMin ?? depart : depart;
  if (arrive <= depart) return leg.startDist;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const frac = Math.max(0, Math.min(1, (nowMin - depart) / (arrive - depart)));
  return leg.startDist + frac * (leg.endDist - leg.startDist);
}
