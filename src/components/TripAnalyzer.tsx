"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { IconSparkle, IconX } from "@/components/Icons";
import {
  analysisKey,
  buildAnalysisPayload,
  type AnalyzeEstimates,
} from "@/lib/analysis";
import { FADE, SPRING } from "@/lib/motion";
import { useTrip } from "@/lib/store";
import type { AnalysisInsight, InsightCategory } from "@/lib/types";

/*
  AI trip check — the manual entry point for the analyzer. Tapping Analyze
  sends the current plan snapshot to /api/analyze once per exact trip state;
  the result lands in the shared trip_analyses cache, so the other phone and
  every re-open show these cards without another API call. Dismissals sync
  the same way.
*/

const CATEGORY_ORDER: InsightCategory[] = ["pacing", "route", "budget"];
const CATEGORY_META: Record<InsightCategory, { label: string; color: string }> = {
  pacing: { label: "Pacing", color: "var(--gold)" },
  route: { label: "Route", color: "var(--sky)" },
  budget: { label: "Budget", color: "var(--green)" },
};

export default function TripAnalyzer({ estimates }: { estimates: AnalyzeEstimates }) {
  const trip = useTrip((s) => s.trip);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const viaPoints = useTrip((s) => s.viaPoints);
  const routes = useTrip((s) => s.routes);
  const routesPending = useTrip((s) => s.routesPending);
  const analyses = useTrip((s) => s.analyses);
  const saveAnalysis = useTrip((s) => s.saveAnalysis);
  const dismissInsight = useTrip((s) => s.dismissInsight);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = useMemo(
    () => (trip ? analysisKey(trip, days, stops, viaPoints) : null),
    [trip, days, stops, viaPoints],
  );

  // fetchAllRows orders ascending, so the newest analysis sits last
  const latest = analyses.length > 0 ? analyses[analyses.length - 1] : null;
  const fresh = latest !== null && latest.key === key;
  const canAnalyze = trip !== null && stops.length > 0 && !routesPending && !busy && !fresh;

  async function analyze() {
    if (!trip || !key || !canAnalyze) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildAnalysisPayload(trip, days, stops, routes, estimates);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      setError(err instanceof Error ? err.message : "The analysis failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  const visible = latest ? latest.insights.filter((i) => !latest.dismissed.includes(i.id)) : [];

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">AI trip check</p>
          <p className="mt-1 text-[11px] leading-4 text-fg-muted">
            {latest
              ? fresh
                ? `Checked ${fmtWhen(latest.created_at)} — current with the plan.`
                : "The plan has changed since the last check."
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

      {busy && (
        <div className="mt-4 space-y-2">
          <div className="skeleton h-14" />
          <div className="skeleton h-14" />
        </div>
      )}

      {error && !busy && (
        <p className="mt-3 rounded-xl bg-coral-soft px-3 py-2.5 text-xs leading-4 text-fg-muted">
          {error}
        </p>
      )}

      {latest && !busy && (
        <div className="mt-4 space-y-4">
          {latest.insights.length === 0 && (
            <p className="rounded-xl bg-accent-soft px-3 py-2.5 text-xs leading-4 text-fg-muted">
              Nothing to flag — the plan looks solid.
            </p>
          )}
          {latest.insights.length > 0 && visible.length === 0 && (
            <p className="text-center text-[11px] text-fg-faint">
              All findings dismissed.
            </p>
          )}
          {CATEGORY_ORDER.map((cat) => {
            const items = visible.filter((i) => i.category === cat);
            if (items.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <div key={cat}>
                <p className="eyebrow mb-2 flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: meta.color }}
                  />
                  {meta.label}
                </p>
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {items.map((insight) => (
                      <InsightCard
                        key={insight.id}
                        insight={insight}
                        color={meta.color}
                        onDismiss={() => void dismissInsight(latest.id, insight.id)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InsightCard({
  insight,
  color,
  onDismiss,
}: {
  insight: AnalysisInsight;
  color: string;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      layout
      initial={false}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ layout: SPRING, opacity: FADE }}
      className="overflow-hidden"
    >
      <div
        className="rounded-2xl border border-hairline bg-bg-elevated/60 p-3 pl-3.5"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-4">
              {insight.severity === "warn" && (
                <span className="mr-1.5 align-middle text-[10px] font-bold uppercase tracking-wide text-danger">
                  !
                </span>
              )}
              {insight.title}
              {insight.day_seq != null && (
                <span className="mono ml-1.5 text-[10px] font-medium text-fg-faint">
                  day {insight.day_seq}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs leading-4.5 text-fg-muted">{insight.detail}</p>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss finding"
            className="pressable -mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-fg-faint"
          >
            <IconX size={13} strokeWidth={2.2} />
          </button>
        </div>
      </div>
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
