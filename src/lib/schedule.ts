"use client";

import { useTrip } from "./store";
import type { Day, DayRoute, Stop } from "./types";

/** Default departure clock for a day when nothing anchors it (9:00 AM). */
export const DAY_START_MIN = 9 * 60;
/** Stay added at a stop when the user hasn't picked a length (a pass-through). */
const DEFAULT_STAY_MIN = 0;

export interface StopSchedule {
  /** Estimated arrival, minutes since local midnight. */
  arrivalMin: number;
  /** When we leave = arrival + planned stay. Seeds the next stop's ETA. */
  departMin: number;
  /** True when the arrival was pinned by the stop's own start_time. */
  anchored: boolean;
}

/** "14:30" → 870 minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 870 → "14:30" (wrapped into a single day). */
export function minutesToHHMM(min: number): string {
  const wrapped = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function stayOf(stop: Stop | undefined): number {
  return stop?.duration_min != null ? stop.duration_min : DEFAULT_STAY_MIN;
}

/**
 * Build a cascading schedule for the whole trip.
 *
 * Each day starts from a departure clock — the first day honours the origin
 * stop's own time (e.g. "leave home at 8:00"), later days default to
 * {@link DAY_START_MIN}. From there every arrival is derived live from the
 * route's drive times, so when a segment's duration changes the ETA moves with
 * it. A stop's planned stay pushes the *next* stop later, and a stop with its
 * own start_time re-anchors the chain from that point on (a reservation or
 * check-in that the estimate must bend to).
 */
function computeSchedule(
  orderedDays: Day[],
  stops: Stop[],
  routes: Record<string, DayRoute>,
): Map<string, StopSchedule> {
  const byId = new Map(stops.map((s) => [s.id, s]));
  const result = new Map<string, StopSchedule>();

  orderedDays.forEach((day, i) => {
    const dayStops = stops
      .filter((s) => s.day_id === day.id)
      .sort((a, b) => a.seq - b.seq);
    if (dayStops.length === 0) return;

    let dep: number;
    if (i === 0) {
      // Day one leaves from the origin itself: its time is a departure, not an
      // arrival — there is no drive before it.
      const origin = dayStops[0];
      dep = origin.start_time != null ? hhmmToMinutes(origin.start_time) : DAY_START_MIN;
      result.set(origin.id, {
        arrivalMin: dep,
        departMin: dep,
        anchored: origin.start_time != null,
      });
    } else {
      // Later days resume from the morning; the first segment drives in from
      // last night's stay.
      dep = DAY_START_MIN;
    }

    const route = routes[day.id];
    for (const seg of route?.segments ?? []) {
      const to = byId.get(seg.toStopId);
      let arrive = dep + seg.durationS / 60;
      const anchored = to?.start_time != null;
      if (anchored) arrive = hhmmToMinutes(to!.start_time!);
      result.set(seg.toStopId, {
        arrivalMin: arrive,
        departMin: arrive + stayOf(to),
        anchored,
      });
      dep = arrive + stayOf(to);
    }
  });

  return result;
}

// One shared cache for the whole app — the schedule is consumed by every
// DayCard, the stop editor, and the weather sync, and store arrays are
// immutable, so a reference check on the inputs is enough to reuse the result.
let memoDays: Day[] | null = null;
let memoStops: Stop[] | null = null;
let memoRoutes: Record<string, DayRoute> | null = null;
let memoResult: Map<string, StopSchedule> = new Map();

/** Memoized trip-wide schedule for the given store snapshot. */
export function getSchedule(
  days: Day[],
  stops: Stop[],
  routes: Record<string, DayRoute>,
): Map<string, StopSchedule> {
  if (days !== memoDays || stops !== memoStops || routes !== memoRoutes) {
    memoDays = days;
    memoStops = stops;
    memoRoutes = routes;
    const ordered = [...days].sort((a, b) => a.seq - b.seq);
    memoResult = computeSchedule(ordered, stops, routes);
  }
  return memoResult;
}

/** Live trip-wide schedule, recomputed as stops / stays / routes change. */
export function useSchedule(): Map<string, StopSchedule> {
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  return getSchedule(days, stops, routes);
}
