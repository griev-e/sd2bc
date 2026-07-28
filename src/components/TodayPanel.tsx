"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import NavAppSheet from "./NavAppSheet";
import { StopKindIcon, WeatherIcon } from "./CategoryIcon";
import { IconMoon, IconPin } from "./Icons";
import { clusterKey, clusterStops } from "@/lib/clusters";
import { KIND_COLOR } from "@/lib/colors";
import { directionsOptions } from "@/lib/directions";
import { DEFAULT_TANK_GAL, planFuel } from "@/lib/fuel";
import { fmtClock, fmtDate, fmtDuration, fmtMiles } from "@/lib/format";
import type { LngLat } from "@/lib/geo";
import { buildJourney, liveDistance, nearestOnJourney } from "@/lib/journey";
import { useLocation } from "@/lib/location";
import { FADE, riseIn, SPRING } from "@/lib/motion";
import { useSchedule } from "@/lib/schedule";
import { stopsForDay, useOrderedDays, useTrip } from "@/lib/store";
import { buildToday } from "@/lib/today";
import { useWeather, weatherKind } from "@/lib/weather";

/** Within this of the plan (measured along the route), we're on schedule. */
const ON_PACE_M = 800;
/** A fix this far off the line says nothing about progress along it. */
const OFF_ROUTE_LIMIT_M = 60_000;
/** The clock only needs re-reading on the scale a car moves. */
const TICK_MS = 30_000;

/**
 * The live-trip panel: where we are in the day, what's next, whether we're
 * running late, and what's left to drive. Everything it shows is derived from
 * the same schedule the itinerary below it uses (lib/today.ts), so the two can
 * never tell different stories.
 *
 * Renders nothing at all when the clock isn't on a trip day — before departure
 * the countdown pill already says what's happening, and afterwards there is no
 * "today" to report.
 */
export default function TodayPanel() {
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const trip = useTrip((s) => s.trip);
  const setSelectedDay = useTrip((s) => s.setSelectedDay);
  const setSelectedStop = useTrip((s) => s.setSelectedStop);
  const orderedDays = useOrderedDays();
  const schedule = useSchedule();
  const byCluster = useWeather((s) => s.byCluster);
  // Subscribe to the STATUS, never the fix: a live GPS watch pushes a new fix
  // about once a second, and both the journey build and the route-wide sweep
  // below are far too heavy to redo at that cadence. The fix itself is sampled
  // imperatively on the same slow tick everything else here runs on.
  const locStatus = useLocation((s) => s.status);

  const [navOpen, setNavOpen] = useState(false);
  // Re-derive on a slow tick so "next stop" advances on its own while the
  // phone sits in the cupholder.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const view = useMemo(
    () => buildToday(orderedDays, stops, routes, schedule, now),
    [orderedDays, stops, routes, schedule, now],
  );

  // Pacing needs the whole loop stitched into one timeline. Only worth building
  // when tracking is actually live to compare against.
  const journey = useMemo(
    () => (locStatus === "live" ? buildJourney(orderedDays, routes) : null),
    [locStatus, orderedDays, routes],
  );
  const paceM = useMemo(() => {
    if (!journey || journey.totalDist <= 0) return null;
    const fix = useLocation.getState().fix;
    if (!fix) return null;
    // A fix wildly off the line says nothing about progress along it — report
    // no delta rather than a confident wrong one.
    const near = nearestOnJourney(journey, fix.lngLat);
    if (!near || near.offRouteM > OFF_ROUTE_LIMIT_M) return null;
    return near.dist - liveDistance(journey, orderedDays, stops, schedule, now);
  }, [journey, orderedDays, stops, schedule, now]);

  const fuel = useMemo(() => {
    if (!trip) return null;
    return planFuel(
      orderedDays,
      stops,
      routes,
      Number(trip.mpg),
      Number(trip.tank_gal ?? DEFAULT_TANK_GAL),
    );
  }, [trip, orderedDays, stops, routes]);

  const next = view?.next ?? null;

  // Nav from where we actually are when we know, otherwise from the stop before
  // this one — either way the link lands on the next stop.
  // Plain per-render code, no useMemo: it reads the live fix (which changes far
  // faster than we want to re-render for) and builds three URLs — the same
  // trade the map page makes for its "next stop" chip. Each slow tick above
  // re-renders us, so the origin stays roughly current without subscribing.
  const navOptions = (() => {
    if (!next || !view) return [];
    const dayStops = stopsForDay(stops, view.day.id);
    const idx = dayStops.findIndex((s) => s.id === next.id);
    const fix = locStatus === "live" ? useLocation.getState().fix : null;
    const origin: LngLat | null = fix
      ? fix.lngLat
      : idx > 0
        ? [dayStops[idx - 1].lng, dayStops[idx - 1].lat]
        : null;
    return origin ? directionsOptions([origin, [next.lng, next.lat]]) : [];
  })();

  const nextWeather = useMemo(() => {
    if (!next || !view) return undefined;
    const dayStops = stopsForDay(stops, view.day.id);
    const cluster = clusterStops(dayStops).find((c) => c.stopIds.includes(next.id));
    return cluster ? byCluster[clusterKey(view.day.id, cluster.repStopId)] : undefined;
  }, [next, view, stops, byCluster]);

  if (!view) return null;

  const todayFuel = fuel?.byDay[view.day.id] ?? [];
  const kindColor = next ? KIND_COLOR[next.kind] : null;

  return (
    <motion.section
      {...riseIn(0)}
      className="card relative overflow-hidden p-4"
      // the one card that's about right now — give it the accent wash
      style={{ borderColor: "var(--accent)" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 80% at 90% -30%, var(--accent-soft), transparent 65%)",
        }}
      />

      <div className="relative flex items-baseline justify-between">
        <p className="eyebrow text-accent">
          Today · Day {view.dayIndex + 1} of {view.totalDays}
        </p>
        <p className="eyebrow">{fmtDate(view.day.date)}</p>
      </div>

      {/* the headline: what to point the car at */}
      {next ? (
        <button
          onClick={() => {
            setSelectedDay(view.day.id);
            setSelectedStop(next.id);
          }}
          className="relative mt-3 flex w-full items-center gap-3 text-left"
        >
          <span
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
            style={{ background: kindColor!.bg, color: kindColor!.fg }}
          >
            <StopKindIcon kind={next.kind} size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="eyebrow block">
              {view.beforeDeparture ? "First up" : "Next"}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 truncate text-[15px] font-semibold leading-tight tracking-tight">
              <span className="truncate">{next.name}</span>
              {next.is_overnight && (
                <IconMoon size={12} className="flex-shrink-0 text-fg-faint" />
              )}
            </span>
            <span className="tnum mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-muted">
              {view.nextSched && (
                <span className={view.nextSched.anchored ? "font-semibold text-accent" : ""}>
                  {view.nextSched.anchored ? "" : "~"}
                  {fmtClock(view.nextSched.arrivalMin)}
                </span>
              )}
              {nextWeather && (
                <span className="flex items-center gap-1">
                  <WeatherIcon kind={weatherKind(nextWeather.code)} size={12} strokeWidth={2} />
                  {nextWeather.tempF}°
                </span>
              )}
            </span>
          </span>
        </button>
      ) : (
        <p className="relative mt-3 rounded-xl bg-fg/[0.03] px-3 py-2.5 text-center text-xs text-fg-faint">
          {view.done
            ? "That's the day's driving done. 🌙"
            : "Nothing planned for today yet — add a stop below."}
        </p>
      )}

      {navOptions.length > 0 && (
        <button
          onClick={() => setNavOpen(true)}
          className="btn-primary pressable relative mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold"
        >
          <IconPin size={14} /> Navigate there
        </button>
      )}

      <div className="hairline-t relative mt-3.5 pt-3" />

      {/* the rest of the day at a glance */}
      <div className="stat-strip relative">
        <Stat
          value={
            view.beforeDeparture
              ? fmtClock(view.departMin)
              : String(view.upcoming.length)
          }
          label={view.beforeDeparture ? "leave at" : "stops left"}
        />
        <Stat
          value={view.remainingM > 0 ? fmtMiles(view.remainingM) : "—"}
          label="still to drive"
        />
        <Stat
          value={view.remainingS > 0 ? fmtDuration(view.remainingS) : "—"}
          label="behind the wheel"
        />
      </div>

      {/* pacing — only when a live fix can actually answer it */}
      <AnimatePresence>
        {paceM != null && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: FADE }}
            transition={SPRING}
            className="relative mt-3 flex items-center gap-1.5 text-[11px] font-medium"
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{
                background:
                  Math.abs(paceM) < ON_PACE_M ? "var(--accent)" : "var(--coral)",
              }}
            />
            <span className="text-fg-muted">
              {Math.abs(paceM) < ON_PACE_M
                ? "Right on schedule"
                : `${fmtMiles(Math.abs(paceM))} ${paceM > 0 ? "ahead of" : "behind"} schedule`}
            </span>
          </motion.p>
        )}
      </AnimatePresence>

      {/* tonight */}
      {view.overnight && (
        <p className="relative mt-2 flex items-center gap-1.5 text-[11px] text-fg-muted">
          <IconMoon size={12} className="flex-shrink-0 text-fg-faint" />
          <span className="truncate">
            Tonight · <span className="font-semibold text-fg">{view.overnight.name}</span>
          </span>
        </p>
      )}

      {/* fuel — the one warning worth interrupting for */}
      {todayFuel.map((w) => (
        <p
          key={w.toStopId}
          className="relative mt-2 rounded-xl bg-coral-soft px-3 py-2 text-[11px] font-medium leading-4 text-coral"
        >
          ⛽ {fmtMiles(w.sinceFuelM)} since your last fuel stop by{" "}
          <span className="font-semibold">{w.toStopName}</span> — mark a stop as
          Fuel to plan the fill-up.
        </p>
      ))}

      <NavAppSheet
        title={next ? `Navigate to ${next.name}` : "Navigate"}
        options={navOptions}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        singleStop
      />
    </motion.section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="mono text-[13px] font-semibold leading-tight">{value}</p>
      <p className="eyebrow mt-0.5">{label}</p>
    </div>
  );
}
