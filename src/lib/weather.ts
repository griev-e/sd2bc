"use client";

import { create } from "zustand";
import type { Day, Stop } from "./types";
import { clusterKey, clusterStops } from "./clusters";
import { localDateISO } from "./format";

/**
 * Forecasts from Open-Meteo — free, keyless, CORS-enabled. One request covers
 * every stop cluster. Each cluster carries both its *hourly* reading at that
 * cluster's arrival time — the badge temperature you'll actually pull in to —
 * and its own daily high/low, so the two never disagree: the arrival reading
 * always sits inside the same place's daily range. The day header and the map's
 * selected-stop card read the cluster's daily high/low.
 * Forecasts exist ~16 days out; anything further simply has no weather yet.
 */

/** Daily high/low for a day — powers the day header. */
export interface DayWeather {
  /** WMO weather code */
  code: number;
  tMaxF: number;
  tMinF: number;
}

/**
 * Per-cluster forecast — powers the map/itinerary badge *and* the map's
 * selected-stop card. It pairs the arrival-hour reading with that same
 * cluster's daily high/low and code, so a stop's badge temperature can never
 * contradict the high/low shown for the very same place.
 */
export interface ClusterWeather {
  /** WMO weather code at the arrival hour — the badge icon. */
  code: number;
  /** Temperature at the arrival hour, °F — the badge number. */
  tempF: number;
  /** Hour of day used (0–23), for context. */
  hour: number;
  /** Daily high / low for this cluster, °F. */
  tMaxF: number;
  tMinF: number;
  /** Daily WMO code for this cluster — the card / day condition. */
  dayCode: number;
}

export type WeatherKind =
  | "sun"
  | "partly"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "sun";
  if (code <= 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloud";
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  sun: "Clear",
  partly: "Partly sunny",
  cloud: "Overcast",
  fog: "Foggy",
  drizzle: "Drizzle",
  rain: "Rain",
  snow: "Snow",
  storm: "Thunderstorms",
};

/** Emoji per weather kind — for DOM contexts (map markers) without React. */
export const WEATHER_EMOJI: Record<WeatherKind, string> = {
  sun: "☀️",
  partly: "🌤️",
  cloud: "☁️",
  fog: "🌫️",
  drizzle: "🌦️",
  rain: "🌧️",
  snow: "❄️",
  storm: "⛈️",
};

interface WeatherState {
  /** Daily forecast per trip day (representative point) — day header. */
  byDay: Record<string, DayWeather | undefined>;
  /** Per-cluster forecast, keyed by `${dayId}:${repStopId}`. */
  byCluster: Record<string, ClusterWeather | undefined>;
  /**
   * @param arrivalMin  stopId → estimated arrival, minutes since midnight; the
   *   cluster badge samples the forecast at that hour (defaults to midday).
   */
  sync: (days: Day[], stops: Stop[], arrivalMin: Record<string, number>) => void;
}

let lastKey = "";
let lastFetched = 0;
let inflight = false;
/** Latest sync args that arrived while a fetch was inflight — replayed after. */
let queued: [Day[], Stop[], Record<string, number>] | null = null;

export const useWeather = create<WeatherState>((set) => ({
  byDay: {},
  byCluster: {},

  sync: (days, stops, arrivalMin) => {
    const today = localDateISO(new Date());
    const horizon = localDateISO(new Date(Date.now() + 15 * 86400000));

    // One point per stop cluster, sampled at that cluster's arrival hour. The
    // day header reuses the cluster holding the day's representative stop
    // (overnight, else last).
    const targets: {
      clusterKey: string;
      dayId: string;
      date: string;
      /** arrival hour of the cluster, 0–23 */
      hour: number;
      lat: number;
      lng: number;
    }[] = [];
    const dayRepKey: Record<string, string> = {};

    for (const day of days) {
      if (day.date < today || day.date > horizon) continue;
      const dayStops = stops
        .filter((s) => s.day_id === day.id)
        .sort((a, b) => a.seq - b.seq);
      if (dayStops.length === 0) continue;

      const clusters = clusterStops(dayStops);
      for (const c of clusters) {
        const eta = arrivalMin[c.repStopId];
        // fall back to midday when the ETA is unknown (no route yet)
        const hour = eta != null ? Math.min(23, Math.max(0, Math.round(eta / 60))) : 12;
        targets.push({
          clusterKey: clusterKey(day.id, c.repStopId),
          dayId: day.id,
          date: day.date,
          hour,
          lat: c.lat,
          lng: c.lng,
        });
      }

      const rep = dayStops.find((s) => s.is_overnight) ?? dayStops[dayStops.length - 1];
      const repCluster = clusters.find((c) => c.stopIds.includes(rep.id));
      if (repCluster) dayRepKey[day.id] = clusterKey(day.id, repCluster.repStopId);
    }

    if (targets.length === 0) {
      // reset the cache key too, or re-adding the same stops within the TTL
      // would be treated as "already fetched" and stay blank
      lastKey = "";
      queued = null; // an older queued sync must not resurrect this state
      set({ byDay: {}, byCluster: {} });
      return;
    }

    const key = targets
      .map((t) => `${t.clusterKey}:${t.date}@${t.hour}:${t.lat.toFixed(2)},${t.lng.toFixed(2)}`)
      .join("|");
    if (inflight) {
      // don't drop it — routes settle day by day during startup, and the last
      // call carries the final arrival hours; replay it once the fetch ends
      queued = [days, stops, arrivalMin];
      return;
    }
    if (key === lastKey && Date.now() - lastFetched < 30 * 60000) return;
    inflight = true;

    const dates = targets.map((t) => t.date).sort();
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${targets.map((t) => t.lat.toFixed(3)).join(",")}` +
      `&longitude=${targets.map((t) => t.lng.toFixed(3)).join(",")}` +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
      "&hourly=temperature_2m,weather_code" +
      "&temperature_unit=fahrenheit&timezone=auto" +
      `&start_date=${dates[0]}&end_date=${dates[dates.length - 1]}`;

    // hard timeout: `inflight` gates every future sync, so a fetch that never
    // settles (mobile network handoff) must not wedge forecasts for good
    fetch(url, { signal: AbortSignal.timeout(20_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        const results = Array.isArray(json) ? json : [json];
        const byCluster: Record<string, ClusterWeather> = {};
        const byDay: Record<string, DayWeather> = {};

        targets.forEach((t, i) => {
          const res = results[i];

          // this cluster's own daily high/low + code — the envelope both the
          // day header and the selected-stop card read.
          const daily = res?.daily;
          let tMaxF: number | undefined;
          let tMinF: number | undefined;
          let dayCode: number | undefined;
          if (daily?.time) {
            const di = (daily.time as string[]).indexOf(t.date);
            if (di !== -1) {
              dayCode = daily.weather_code?.[di];
              tMaxF = daily.temperature_2m_max?.[di];
              tMinF = daily.temperature_2m_min?.[di];
            }
          }
          // Without the daily envelope there is nothing to anchor the badge to,
          // so skip the cluster rather than show a lone, unbounded reading.
          if (tMaxF == null || tMinF == null || dayCode == null) return;

          // arrival-hour reading for the badge; fall back to the daily figures
          // when the exact hour is missing so the badge never disappears.
          const hourly = res?.hourly;
          let tempF: number | undefined;
          let hCode: number | undefined;
          if (hourly?.time) {
            const stamp = `${t.date}T${String(t.hour).padStart(2, "0")}:00`;
            const hi = (hourly.time as string[]).indexOf(stamp);
            if (hi !== -1) {
              tempF = hourly.temperature_2m?.[hi];
              hCode = hourly.weather_code?.[hi];
            }
          }

          byCluster[t.clusterKey] = {
            code: hCode ?? dayCode,
            tempF: Math.round(tempF ?? (tMaxF + tMinF) / 2),
            hour: t.hour,
            tMaxF: Math.round(tMaxF),
            tMinF: Math.round(tMinF),
            dayCode,
          };
        });

        // The day header reuses the cluster holding the day's representative
        // stop, so its high/low matches that stop's own badge.
        for (const [dayId, repKey] of Object.entries(dayRepKey)) {
          const w = byCluster[repKey];
          if (w) byDay[dayId] = { code: w.dayCode, tMaxF: w.tMaxF, tMinF: w.tMinF };
        }

        lastKey = key;
        lastFetched = Date.now();
        set({ byDay, byCluster });
      })
      .catch(() => {
        // quiet — weather is a garnish, never an error state
      })
      .finally(() => {
        inflight = false;
        if (queued) {
          const args = queued;
          queued = null;
          useWeather.getState().sync(...args);
        }
      });
  },
}));
