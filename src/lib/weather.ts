"use client";

import { create } from "zustand";
import type { Day, Stop } from "./types";
import { clusterKey, clusterStops } from "./clusters";
import { localDateISO } from "./format";

/**
 * Daily forecasts from Open-Meteo — free, keyless, CORS-enabled.
 * One representative point per trip day (the overnight stop, else the last
 * stop), batched into a single request. Forecasts exist ~16 days out;
 * days beyond that simply have no weather yet.
 */

export interface DayWeather {
  /** WMO weather code */
  code: number;
  tMaxF: number;
  tMinF: number;
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

interface WeatherState {
  /** Forecast per trip day (representative point) — powers the day header. */
  byDay: Record<string, DayWeather | undefined>;
  /** Forecast per stop cluster, keyed by `${dayId}:${repStopId}`. */
  byCluster: Record<string, DayWeather | undefined>;
  sync: (days: Day[], stops: Stop[]) => void;
}

let lastKey = "";
let lastFetched = 0;
let inflight = false;

export const useWeather = create<WeatherState>((set) => ({
  byDay: {},
  byCluster: {},

  sync: (days, stops) => {
    const today = localDateISO(new Date());
    const horizon = localDateISO(new Date(Date.now() + 15 * 86400000));

    // One point per stop cluster; the day header reuses the cluster holding the
    // day's representative stop (overnight, else last).
    const targets: {
      clusterKey: string;
      dayId: string;
      date: string;
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
        targets.push({
          clusterKey: clusterKey(day.id, c.repStopId),
          dayId: day.id,
          date: day.date,
          lat: c.lat,
          lng: c.lng,
        });
      }

      const rep = dayStops.find((s) => s.is_overnight) ?? dayStops[dayStops.length - 1];
      const repCluster = clusters.find((c) => c.stopIds.includes(rep.id));
      if (repCluster) dayRepKey[day.id] = clusterKey(day.id, repCluster.repStopId);
    }

    if (targets.length === 0) {
      set({ byDay: {}, byCluster: {} });
      return;
    }

    const key = targets
      .map((t) => `${t.clusterKey}:${t.date}:${t.lat.toFixed(2)},${t.lng.toFixed(2)}`)
      .join("|");
    if (inflight || (key === lastKey && Date.now() - lastFetched < 30 * 60000)) return;
    inflight = true;

    const dates = targets.map((t) => t.date).sort();
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${targets.map((t) => t.lat.toFixed(3)).join(",")}` +
      `&longitude=${targets.map((t) => t.lng.toFixed(3)).join(",")}` +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
      "&temperature_unit=fahrenheit&timezone=auto" +
      `&start_date=${dates[0]}&end_date=${dates[dates.length - 1]}`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        const results = Array.isArray(json) ? json : [json];
        const byCluster: Record<string, DayWeather> = {};
        targets.forEach((t, i) => {
          const daily = results[i]?.daily;
          if (!daily?.time) return;
          const di = (daily.time as string[]).indexOf(t.date);
          if (di === -1) return;
          const code = daily.weather_code?.[di];
          const tMaxF = daily.temperature_2m_max?.[di];
          const tMinF = daily.temperature_2m_min?.[di];
          if (code == null || tMaxF == null) return;
          byCluster[t.clusterKey] = { code, tMaxF: Math.round(tMaxF), tMinF: Math.round(tMinF) };
        });
        const byDay: Record<string, DayWeather> = {};
        for (const [dayId, repKey] of Object.entries(dayRepKey)) {
          const w = byCluster[repKey];
          if (w) byDay[dayId] = w;
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
      });
  },
}));
