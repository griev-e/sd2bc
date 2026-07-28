/*
  "Where are we, what's next, are we late?" — the live-trip view.

  Everything here is derived from state the app already keeps (the day list, the
  cascading schedule, the computed routes). It exists as its own pure function
  so the Today panel can't drift from the itinerary it summarizes, and so the
  awkward parts — the grace window, what counts as "remaining" — are pinned
  down by tests instead of by feel.
*/

import { localDateISO } from "./format";
import { dayDepartMin, type StopSchedule } from "./schedule";
import { bySeq, type Day, type DayRoute, type Stop } from "./types";

/**
 * How long a stop stays "current" after its planned departure. Without it the
 * panel skips ahead to the next town the moment you sit down to lunch.
 */
export const NOW_GRACE_MIN = 15;

export interface TodayView {
  day: Day;
  /** 0-based index into orderedDays; day number is this + 1. */
  dayIndex: number;
  totalDays: number;
  /** When the day pulls out, minutes since midnight. */
  departMin: number;
  /** True before that clock — we haven't left yet. */
  beforeDeparture: boolean;
  /** Stops the clock hasn't passed yet, in drive order. */
  upcoming: Stop[];
  /** The stop to head for right now (first of `upcoming`). */
  next: Stop | null;
  nextSched: StopSchedule | undefined;
  /** Tonight's stay, if one is marked on this day. */
  overnight: Stop | null;
  /** The day's whole drive. */
  totalM: number;
  totalS: number;
  /** What's left of it — legs arriving at stops still ahead. */
  remainingM: number;
  remainingS: number;
  /** True once every stop's departure is behind us. */
  done: boolean;
}

/**
 * Today's slice of the trip, or null when the clock isn't on a trip day (before
 * departure, after the last day, or a rest date between two).
 */
export function buildToday(
  orderedDays: Day[],
  stops: Stop[],
  routes: Record<string, DayRoute>,
  schedule: Map<string, StopSchedule>,
  now: Date,
): TodayView | null {
  const todayIso = localDateISO(now);
  const dayIndex = orderedDays.findIndex((d) => d.date === todayIso);
  if (dayIndex === -1) return null;

  const day = orderedDays[dayIndex];
  const dayStops = stops.filter((s) => s.day_id === day.id).sort(bySeq);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Day one leaves from its origin stop, whose own time outranks the day's.
  const departMin = dayDepartMin(day, dayIndex === 0 ? dayStops[0] : undefined);

  const upcoming = dayStops.filter((s) => {
    const sched = schedule.get(s.id);
    // No ETA yet (no route) — it's still ahead of us by definition.
    if (!sched) return true;
    return sched.departMin >= nowMin - NOW_GRACE_MIN;
  });

  const ahead = new Set(upcoming.map((s) => s.id));
  const segments = routes[day.id]?.segments ?? [];
  let totalM = 0;
  let totalS = 0;
  let remainingM = 0;
  let remainingS = 0;
  for (const seg of segments) {
    totalM += seg.distanceM;
    totalS += seg.durationS;
    // A leg counts as remaining when the stop it arrives at is still ahead.
    if (ahead.has(seg.toStopId)) {
      remainingM += seg.distanceM;
      remainingS += seg.durationS;
    }
  }

  return {
    day,
    dayIndex,
    totalDays: orderedDays.length,
    departMin,
    beforeDeparture: nowMin < departMin,
    upcoming,
    next: upcoming[0] ?? null,
    nextSched: upcoming[0] ? schedule.get(upcoming[0].id) : undefined,
    overnight: dayStops.find((s) => s.is_overnight) ?? null,
    totalM,
    totalS,
    remainingM,
    remainingS,
    done: upcoming.length === 0 && dayStops.length > 0,
  };
}
