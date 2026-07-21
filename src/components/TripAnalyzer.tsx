"use client";

import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { IconSparkle, IconX } from "@/components/Icons";
import { analysisKey, buildAnalysisPayload } from "@/lib/analysis";
import { computeBudget } from "@/lib/budget";
import { localDateISO } from "@/lib/format";
import { FADE, SPRING, STAGGER_S } from "@/lib/motion";
import { dayRoutePoints, sortDays, stopsForDay, useTrip } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { useWeather } from "@/lib/weather";
import type { AnalysisInsight, InsightCategory } from "@/lib/types";

/*
  AI trip check — the manual entry point for the analyzer. Tapping Analyze
  sends the current plan snapshot to /api/analyze once per exact trip state;
  the result lands in the shared trip_analyses cache, so the other phone and
  every re-open show these cards without another API call. Dismissals sync
  the same way.

  Presentation: one continuous glass surface, not a stack of boxes. Findings
  are hairline-divided rows in the model's best-first order with the category
  carried by a colored eyebrow, a one-glance tally up top, and swipe-left (or
  the ✕) to dismiss. While the model reads the plan, a rotating status line
  and a light beam on the hairline stand in for a spinner.
*/

const CATEGORY_ORDER: InsightCategory[] = ["pacing", "route", "budget", "weather"];
const CATEGORY_META: Record<InsightCategory, { label: string; color: string }> = {
  pacing: { label: "Pacing", color: "var(--gold)" },
  route: { label: "Route", color: "var(--sky)" },
  budget: { label: "Budget", color: "var(--green)" },
  weather: { label: "Weather", color: "var(--violet)" },
};

/** Status copy while the model works — advances and holds on the last line
 *  (rather than looping) so it reads as progress, not a stuck spinner. */
const SCAN_PHRASES = [
  "Reading the whole plan…",
  "Pacing out the days…",
  "Tracing the route…",
  "Weighing the budget…",
  "Writing it up…",
];

export default function TripAnalyzer() {
  const trip = useTrip((s) => s.trip);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const viaPoints = useTrip((s) => s.viaPoints);
  const routes = useTrip((s) => s.routes);
  const routesPending = useTrip((s) => s.routesPending);
  const analyses = useTrip((s) => s.analyses);
  const saveAnalysis = useTrip((s) => s.saveAnalysis);
  const dismissInsight = useTrip((s) => s.dismissInsight);
  const reorderStops = useTrip((s) => s.reorderStops);
  const weatherByDay = useWeather((s) => s.byDay);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same math as the Budget tab — computeBudget keeps the two in lockstep.
  const budget = useMemo(
    () => computeBudget(trip, days, stops, routes),
    [trip, days, stops, routes],
  );

  // Key includes today's date: the payload carries live weather, so a cached
  // analysis must not outlive the forecast that shaped it.
  const key = useMemo(
    () => (trip ? analysisKey(trip, days, stops, viaPoints, localDateISO()) : null),
    [trip, days, stops, viaPoints],
  );

  // Every day that CAN have a route must have one computed — analyzing a
  // half-routed plan would cache "0-mile days" under the correct key.
  const routesReady = useMemo(() => {
    const ordered = sortDays(days);
    return ordered.every((d, i) => {
      const points = dayRoutePoints(d, i > 0 ? ordered[i - 1] : null, stops, viaPoints);
      return points.length < 2 || routes[d.id] !== undefined;
    });
  }, [days, stops, viaPoints, routes]);

  // fetchAllRows orders ascending, so the newest analysis sits last
  const latest = analyses.length > 0 ? analyses[analyses.length - 1] : null;
  const fresh = latest !== null && latest.key === key;
  const canAnalyze =
    trip !== null && stops.length > 0 && !routesPending && routesReady && !busy && !fresh;

  async function analyze() {
    if (!trip || !key || !canAnalyze) return;
    setBusy(true);
    setError(null);
    try {
      const { data: sess } = await supabase().auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("You're signed out — sign in again first.");
      const payload = buildAnalysisPayload(
        trip,
        days,
        stops,
        routes,
        { ...budget.estimates, totalMiles: budget.totalMiles },
        weatherByDay,
      );
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        // a hair over the route's own 60s budget, so a hung connection can't
        // pin the "Analyzing…" state forever
        signal: AbortSignal.timeout(65_000),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        model?: string;
        insights?: AnalysisInsight[];
      } | null;
      if (!res.ok || !json?.insights) {
        throw new Error(json?.error ?? "The analysis failed — try again.");
      }
      await saveAnalysis(key, json.model ?? "unknown", json.insights);
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      setError(
        timedOut
          ? "The analysis took too long — try again."
          : err instanceof Error
            ? err.message
            : "The analysis failed — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * If a route finding carries a usable stop order for its day, return the
   * one-tap apply action; null when the names don't line up with the day
   * anymore (plan moved) or the order is already in effect.
   */
  function orderApplication(insight: AnalysisInsight): (() => void) | null {
    const order = insight.suggested_order;
    if (!order || insight.day_seq == null) return null;
    const day = days.find((d) => d.seq === insight.day_seq);
    if (!day) return null;
    const dayStops = stopsForDay(stops, day.id);
    if (dayStops.length !== order.length) return null;
    const pool = [...dayStops];
    const ids: string[] = [];
    for (const name of order) {
      const idx = pool.findIndex((s) => s.name === name);
      if (idx === -1) return null;
      ids.push(pool[idx].id);
      pool.splice(idx, 1);
    }
    if (ids.every((id, i) => dayStops[i].id === id)) return null; // already applied
    return () => void reorderStops(day.id, ids);
  }

  const visible = latest ? latest.insights.filter((i) => !latest.dismissed.includes(i.id)) : [];
  const warnCount = visible.filter((i) => i.severity === "warn").length;
  const dismissedCount = latest ? latest.insights.length - visible.length : 0;

  return (
    <section className="card relative overflow-hidden">
      {/* soft aura in the top corner — the whole panel reads as one lit surface */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 70% at 100% -10%, var(--accent-soft), transparent 62%)",
        }}
      />

      <div className="relative flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5">
            <IconSparkle size={11} strokeWidth={2.2} className="text-accent" />
            AI trip check
          </p>
          <p className="mt-1.5 text-[11px] leading-4 text-fg-muted">
            {latest
              ? fresh
                ? `Checked ${fmtWhen(latest.created_at)} — current with the plan.`
                : "The plan has moved since the last check."
              : "Reads the whole plan for pacing, route, and budget issues."}
          </p>
        </div>
        <button
          onClick={() => void analyze()}
          disabled={!canAnalyze}
          className={`pressable flex h-11 flex-shrink-0 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold ${
            fresh ? "btn-ghost" : "btn-primary"
          } disabled:opacity-50`}
        >
          <IconSparkle size={13} strokeWidth={2.2} />
          {busy ? "Analyzing…" : latest ? (fresh ? "Up to date" : "Re-analyze") : "Analyze trip"}
        </button>
      </div>

      {busy && <ScanIndicator />}

      {error && !busy && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={FADE}
          className="relative border-t border-hairline bg-coral-soft px-5 py-3 text-xs leading-4.5 text-fg-muted"
        >
          {error}
        </motion.p>
      )}

      {latest && !busy && (
        // keyed by analysis id so a re-run replays the staggered reveal
        <div key={latest.id} className="relative border-t border-hairline">
          {latest.insights.length === 0 ? (
            <AllClear />
          ) : visible.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={FADE}
              className="px-5 py-5 text-center text-[11px] text-fg-faint"
            >
              All {latest.insights.length} findings dismissed.
            </motion.p>
          ) : (
            <>
              {/* one-glance tally of what the read turned up */}
              <div className="flex items-center gap-3.5 px-5 pt-3.5 pb-3">
                {CATEGORY_ORDER.map((cat) => {
                  const n = visible.filter((i) => i.category === cat).length;
                  if (n === 0) return null;
                  const meta = CATEGORY_META[cat];
                  return (
                    <motion.span
                      key={cat}
                      layout
                      transition={{ layout: SPRING }}
                      className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: meta.color }}
                      />
                      {n} {meta.label.toLowerCase()}
                    </motion.span>
                  );
                })}
                {(warnCount > 0 || dismissedCount > 0) && (
                  <span
                    className={`ml-auto text-[11px] font-medium ${
                      warnCount > 0 ? "text-danger" : "text-fg-faint"
                    }`}
                  >
                    {warnCount > 0 ? `${warnCount} flagged` : `${dismissedCount} dismissed`}
                  </span>
                )}
              </div>

              <AnimatePresence>
                {visible.map((insight, i) => (
                  <InsightRow
                    key={insight.id}
                    insight={insight}
                    index={i}
                    onDismiss={() => void dismissInsight(latest.id, insight.id)}
                    onApply={orderApplication(insight)}
                  />
                ))}
              </AnimatePresence>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One finding — a hairline-divided row, not a card. Category rides in a
 * colored eyebrow, warnings get a small "!" chip, and the row can be swiped
 * left to dismiss (a ✕ glyph fades in behind it as it's pulled); the ✕
 * button covers taps, desktop, and assistive tech.
 */
function InsightRow({
  insight,
  index,
  onDismiss,
  onApply,
}: {
  insight: AnalysisInsight;
  index: number;
  onDismiss: () => void;
  /** One-tap apply for a suggested stop order; null when not applicable. */
  onApply: (() => void) | null;
}) {
  const meta = CATEGORY_META[insight.category];
  const x = useMotionValue(0);
  const hintOpacity = useTransform(x, [-64, -16], [1, 0]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.3, ease: "easeOut", delay: Math.min(index, 6) * STAGGER_S },
      }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.22, ease: "easeOut" } }}
      transition={{ layout: SPRING }}
      className="relative overflow-hidden border-t border-hairline"
    >
      <motion.div
        aria-hidden
        style={{ opacity: hintOpacity }}
        className="absolute inset-y-0 right-5 flex items-center text-danger"
      >
        <IconX size={14} strokeWidth={2.4} />
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.45, right: 0.03 }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -64 || (info.velocity.x < -500 && info.offset.x < -24)) {
            onDismiss();
          }
        }}
        // pan-y keeps vertical page scrolling alive over the draggable row
        style={{ x, touchAction: "pan-y" }}
        exit={{ x: -72, opacity: 0 }}
        className="relative flex items-start gap-3 px-5 py-3.5"
      >
        <div className="min-w-0 flex-1">
          <p className="eyebrow" style={{ color: meta.color }}>
            {meta.label}
            {insight.day_seq != null && (
              <span className="text-fg-faint"> · day {insight.day_seq}</span>
            )}
          </p>
          <p className="mt-1 text-[13px] font-semibold leading-snug">
            {insight.severity === "warn" && (
              <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-md bg-coral-soft align-[-2px] text-[10px] font-bold text-danger">
                !
              </span>
            )}
            {insight.title}
          </p>
          <p className="mt-1 text-xs leading-4.5 text-fg-muted">{insight.detail}</p>
          {onApply && (
            <button
              onClick={onApply}
              className="pressable mt-2 rounded-lg bg-accent-soft px-3 py-1.5 text-[11px] font-semibold text-accent"
            >
              Apply this order
            </button>
          )}
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss finding"
          className="pressable -mr-2 -mt-1.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-fg-faint"
        >
          <IconX size={13} strokeWidth={2.2} />
        </button>
      </motion.div>
    </motion.div>
  );
}

/** The working state: rotating status line, a light beam sweeping the top
 *  hairline, and slim shimmer lines where the findings will land. */
function ScanIndicator() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setPhase((p) => Math.min(p + 1, SCAN_PHRASES.length - 1)),
      2400,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="relative border-t border-hairline px-5 py-4"
    >
      <motion.div
        aria-hidden
        className="absolute left-0 top-[-1px] h-px w-1/3"
        style={{
          background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
        }}
        animate={{ x: ["-100%", "400%"] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="flex items-center gap-2">
        <motion.span
          aria-hidden
          className="inline-flex text-accent"
          animate={{ rotate: [0, 180], scale: [1, 0.8, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <IconSparkle size={13} strokeWidth={2.2} />
        </motion.span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={phase}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="text-xs font-medium text-fg-muted"
          >
            {SCAN_PHRASES[phase]}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="mt-3.5 space-y-2">
        <div className="skeleton h-2.5 w-full" />
        <div className="skeleton h-2.5 w-4/5" />
        <div className="skeleton h-2.5 w-3/5" />
      </div>
    </motion.div>
  );
}

/** Clean bill of health — a drawn-on check instead of an alert-styled box. */
function AllClear() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="px-5 py-7 text-center"
    >
      <svg width="36" height="36" viewBox="0 0 36 36" className="mx-auto block" aria-hidden>
        <motion.circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.3"
          strokeWidth="1.5"
          transform="rotate(-90 18 18)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
        <motion.path
          d="M11 18.5l5 5 9-10"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.35 }}
        />
      </svg>
      <p className="mt-3 text-sm font-semibold">Nothing to flag</p>
      <p className="mx-auto mt-1 max-w-[32ch] text-xs leading-4.5 text-fg-muted">
        Pacing, route, and budget all read clean. Run it again when the plan changes.
      </p>
    </motion.div>
  );
}

/** "Jul 20, 3:15 PM" for the checked-at line. */
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
