"use client";

import { hashKey, regionOf } from "./geo";
import { getSchedule, minutesToHHMM } from "./schedule";
import {
  ACTIVITIES_PER_PERSON_DAY,
  BIG_CITY_PATTERN,
  FOOD_PER_PERSON_DAY,
  nightCost,
} from "./costs";
import { WEATHER_LABEL, weatherKind, type DayWeather } from "./weather";
import type { Day, DayRoute, Stop, Trip, ViaPoint } from "./types";

/*
  AI trip analyzer — the pure client half. Builds the compact JSON snapshot
  the /api/analyze route feeds to Claude, and the cache key that lets both
  phones share one analysis per exact trip state (memory/store → Supabase
  trip_analyses → network, same shape as the OSRM cache).
*/

/** What the model sees for one stop — enough to judge pacing, not the world. */
interface AnalyzeStop {
  seq: number;
  name: string;
  kind: Stop["kind"];
  overnight: boolean;
  lodging_free: boolean;
  /** Known nightly cost in USD; null = regional estimate applies. */
  lodging_cost: number | null;
  /** Estimated nightly cost the budget forecast uses for this stay (USD). */
  night_estimate: number | null;
  /** Planned stay in minutes; null = pass-through. */
  stay_min: number | null;
  /** Estimated arrival "HH:MM", when a route exists. */
  arrival: string | null;
}

interface AnalyzeDay {
  seq: number;
  date: string;
  title: string;
  region: string;
  drive_miles: number;
  drive_min: number;
  has_overnight: boolean;
  /** Forecast for the day's overnight area; null beyond the ~16-day horizon. */
  weather: { condition: string; high_f: number; low_f: number } | null;
  stops: AnalyzeStop[];
  /** Stop→stop legs, to spot long segments with no food or fuel stop. */
  legs: { from: string; to: string; miles: number; min: number }[];
}

export interface AnalyzePayload {
  trip: {
    name: string;
    start_date: string;
    mpg: number;
    travelers: number;
    total_days: number;
    food_per_person_day: number;
    activities_per_person_day: number;
  };
  budget: {
    total_miles: number;
    est_gas: number;
    est_lodging: number;
    est_food: number;
    est_activities: number;
    nights_planned: number;
    nights_free: number;
  };
  days: AnalyzeDay[];
}

const M_PER_MI = 1609.344;

function sortedDays(days: Day[]): Day[] {
  return [...days].sort((a, b) => a.seq - b.seq);
}

/**
 * Cache key for the current trip state — hashes exactly the inputs that can
 * change an analysis (itinerary geometry/order, stays, budget knobs). Route
 * distances are *derived* from this geometry, so they don't need hashing;
 * that keeps the key stable while routes are still computing.
 */
export function analysisKey(
  trip: Trip,
  days: Day[],
  stops: Stop[],
  viaPoints: ViaPoint[],
  /**
   * Coarse freshness bucket (today's YYYY-MM-DD). The payload carries live
   * weather, so a cached analysis must not outlive the forecast that shaped
   * it — bucketing by day invalidates the cache each morning without
   * thrashing it on every forecast refresh.
   */
  dateBucket?: string,
): string {
  const parts: string[] = [
    `t:${trip.start_date}|${trip.mpg}|${trip.travelers}|${trip.food_per_day ?? ""}|${trip.activities_per_day ?? ""}`,
  ];
  if (dateBucket) parts.push(`w:${dateBucket}`);
  for (const day of sortedDays(days)) {
    parts.push(`d:${day.seq}|${day.date}`);
    const dayStops = stops
      .filter((s) => s.day_id === day.id)
      .sort((a, b) => a.seq - b.seq);
    for (const s of dayStops) {
      parts.push(
        `s:${s.seq}|${s.name}|${s.kind}|${s.lat.toFixed(5)},${s.lng.toFixed(5)}|` +
          `${s.is_overnight ? 1 : 0}|${s.lodging_free ? 1 : 0}|${s.lodging_cost ?? ""}|` +
          `${s.start_time ?? ""}|${s.duration_min ?? ""}`,
      );
    }
  }
  // via points bend routes (and therefore miles), so they shape the analysis
  for (const v of [...viaPoints].sort((a, b) => a.seq - b.seq)) {
    parts.push(`v:${v.after_stop_id}|${v.seq}|${v.lat.toFixed(5)},${v.lng.toFixed(5)}`);
  }
  return "analysis-v1-" + hashKey(parts.join("\n"));
}

/** Estimates by category, computed the same way the budget tab does. */
export interface AnalyzeEstimates {
  gas: number;
  lodging: number;
  food: number;
  activities: number;
  totalMiles: number;
}

/** The compact, model-facing snapshot of the whole plan. */
export function buildAnalysisPayload(
  trip: Trip,
  days: Day[],
  stops: Stop[],
  routes: Record<string, DayRoute>,
  estimates: AnalyzeEstimates,
  /** Daily forecast per day id (from the weather store); optional. */
  weatherByDay: Record<string, DayWeather | undefined> = {},
): AnalyzePayload {
  const ordered = sortedDays(days);
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const schedule = getSchedule(days, stops, routes);

  const nights = stops.filter((s) => s.is_overnight);
  const outDays: AnalyzeDay[] = ordered.map((day) => {
    const dayStops = stops
      .filter((s) => s.day_id === day.id)
      .sort((a, b) => a.seq - b.seq);
    const route = routes[day.id];
    const legs = (route?.segments ?? []).map((seg) => ({
      from: stopById.get(seg.fromStopId)?.name ?? "?",
      to: stopById.get(seg.toStopId)?.name ?? "?",
      miles: Math.round(seg.distanceM / M_PER_MI),
      min: Math.round(seg.durationS / 60),
    }));
    const first = dayStops[0];
    const w = weatherByDay[day.id];
    return {
      seq: day.seq,
      date: day.date,
      title: day.title,
      region: first ? regionOf(first.lat) : "",
      drive_miles: Math.round((route?.distanceM ?? 0) / M_PER_MI),
      drive_min: Math.round((route?.durationS ?? 0) / 60),
      has_overnight: dayStops.some((s) => s.is_overnight),
      weather: w
        ? { condition: WEATHER_LABEL[weatherKind(w.code)], high_f: w.tMaxF, low_f: w.tMinF }
        : null,
      stops: dayStops.map((s) => {
        const sched = schedule.get(s.id);
        return {
          seq: s.seq,
          name: s.name,
          kind: s.kind,
          overnight: s.is_overnight,
          lodging_free: s.lodging_free,
          lodging_cost: s.lodging_cost,
          night_estimate: s.is_overnight
            ? Math.round(
                nightCost({
                  region: regionOf(s.lat),
                  bigCity: BIG_CITY_PATTERN.test(s.name),
                  free: s.lodging_free,
                  cost: s.lodging_cost,
                }),
              )
            : null,
          stay_min: s.duration_min,
          arrival: sched ? minutesToHHMM(sched.arrivalMin) : null,
        };
      }),
      legs,
    };
  });

  return {
    trip: {
      name: trip.name,
      start_date: trip.start_date,
      mpg: trip.mpg,
      travelers: trip.travelers,
      total_days: Math.max(1, days.length),
      food_per_person_day: trip.food_per_day ?? FOOD_PER_PERSON_DAY,
      activities_per_person_day: trip.activities_per_day ?? ACTIVITIES_PER_PERSON_DAY,
    },
    budget: {
      total_miles: Math.round(estimates.totalMiles),
      est_gas: Math.round(estimates.gas),
      est_lodging: Math.round(estimates.lodging),
      est_food: Math.round(estimates.food),
      est_activities: Math.round(estimates.activities),
      nights_planned: nights.length,
      nights_free: nights.filter((s) => s.lodging_free).length,
    },
    days: outDays,
  };
}
