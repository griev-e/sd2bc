"use client";

import { useMemo } from "react";
import CountdownPill from "@/components/CountdownPill";
import { ExpenseCategoryIcon } from "@/components/CategoryIcon";
import { EXPENSE_COLOR } from "@/lib/colors";
import {
  CATEGORY_LABEL,
  CATEGORIES,
  GAS_PRICE_USD_PER_GAL,
  BIG_CITY_PATTERN,
  projectCategory,
  type SeedInputs,
} from "@/lib/costs";
import { fmtMoney } from "@/lib/format";
import { regionOf, type Region } from "@/lib/geo";
import { useTrip } from "@/lib/store";

export default function BudgetPage() {
  const trip = useTrip((s) => s.trip);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const updateTrip = useTrip((s) => s.updateTrip);

  const seed: SeedInputs = useMemo(() => {
    const milesByRegion: Record<Region, number> = { CA: 0, OR: 0, WA: 0, BC: 0 };
    const stopById = new Map(stops.map((s) => [s.id, s]));
    for (const r of Object.values(routes)) {
      for (const seg of r.segments) {
        const from = stopById.get(seg.fromStopId);
        if (!from) continue;
        milesByRegion[regionOf(from.lat)] += seg.distanceM / 1609.344;
      }
    }
    const nights = stops
      .filter((s) => s.is_overnight)
      .map((s) => ({ region: regionOf(s.lat), bigCity: BIG_CITY_PATTERN.test(s.name) }));
    return {
      milesByRegion,
      mpg: trip?.mpg ?? 28,
      travelers: trip?.travelers ?? 2,
      totalDays: Math.max(1, days.length),
      nights,
    };
  }, [routes, stops, trip, days.length]);

  const projections = useMemo(
    () => CATEGORIES.map((c) => projectCategory(c, [], seed, 0)),
    [seed],
  );

  const total = useMemo(
    () => projections.reduce((s, p) => s + p.estimate, 0),
    [projections],
  );
  const maxEstimate = Math.max(...projections.map((p) => p.estimate), 1);

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3.5 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Two travelers · 50/50</p>
              <h1 className="display mt-0.5 text-[22px] tracking-tight">Budget</h1>
            </div>
            <CountdownPill />
          </div>
        </div>
      </header>

      <div className="space-y-3.5 px-4 pt-4">
        {/* hero number */}
        <section className="card relative overflow-hidden p-5">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(90% 90% at 85% -20%, var(--accent-soft), transparent 60%)," +
                "radial-gradient(60% 70% at 0% 120%, var(--coral-soft), transparent 60%)",
            }}
          />
          <p className="eyebrow">Estimated trip total</p>
          <p className="display tnum mt-2 text-[46px] leading-none">
            {fmtMoney(total)}
          </p>
          <div className="stat-strip mt-5">
            <span>
              <span className="mono block text-[13px] font-semibold">
                {fmtMoney(total / 2)}
              </span>
              <span className="eyebrow mt-0.5 block">each</span>
            </span>
            <span>
              <span className="mono block text-[13px] font-semibold">
                {fmtMoney(total / Math.max(1, days.length))}
              </span>
              <span className="eyebrow mt-0.5 block">per day</span>
            </span>
            <span>
              <span className="mono block text-[13px] font-semibold">{days.length}</span>
              <span className="eyebrow mt-0.5 block">days</span>
            </span>
          </div>
        </section>

        {/* per-category breakdown */}
        <section className="card space-y-4 p-5">
          {projections.map((p) => {
            const color = EXPENSE_COLOR[p.category];
            return (
              <div key={p.category}>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="flex items-center gap-2.5 text-sm font-semibold">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ background: color.bg, color: color.fg }}
                    >
                      <ExpenseCategoryIcon category={p.category} size={14} strokeWidth={2} />
                    </span>
                    {CATEGORY_LABEL[p.category]}
                  </p>
                  <p className="tnum text-sm font-semibold">{fmtMoney(p.estimate)}</p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-fg/5">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${(p.estimate / maxEstimate) * 100}%`,
                      background: color.fg,
                    }}
                  />
                </div>
              </div>
            );
          })}
          <p className="hairline-t pt-3 text-[10px] leading-4 text-fg-faint">
            Seeded from 2026 regional averages for CA · OR · WA · BC, plus fuel
            computed from your actual route miles.
          </p>
        </section>

        {/* gas assumptions */}
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Fuel model</p>
              <p className="tnum mt-1 text-[11px] leading-4 text-fg-muted">
                CA ${GAS_PRICE_USD_PER_GAL.CA} · OR ${GAS_PRICE_USD_PER_GAL.OR} · WA $
                {GAS_PRICE_USD_PER_GAL.WA} · BC ${GAS_PRICE_USD_PER_GAL.BC} /gal
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                onClick={() => trip && void updateTrip({ mpg: Math.max(10, Number(trip.mpg) - 1) })}
                className="btn-ghost pressable flex h-10 w-10 items-center justify-center rounded-xl text-lg font-semibold"
                aria-label="Lower MPG"
              >
                −
              </button>
              <div className="w-12 text-center">
                <p className="tnum text-lg font-bold leading-none">
                  {trip ? Number(trip.mpg) : "—"}
                </p>
                <p className="eyebrow mt-0.5">mpg</p>
              </div>
              <button
                onClick={() => trip && void updateTrip({ mpg: Math.min(80, Number(trip.mpg) + 1) })}
                className="btn-ghost pressable flex h-10 w-10 items-center justify-center rounded-xl text-lg font-semibold"
                aria-label="Raise MPG"
              >
                +
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
