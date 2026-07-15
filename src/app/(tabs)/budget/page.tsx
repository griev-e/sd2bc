"use client";

import { useMemo, useState } from "react";
import CountdownPill from "@/components/CountdownPill";
import { ExpenseCategoryIcon } from "@/components/CategoryIcon";
import { IconChevronDown } from "@/components/Icons";
import { EXPENSE_COLOR } from "@/lib/colors";
import {
  ACTIVITIES_PER_PERSON_DAY,
  BIG_CITY_PATTERN,
  CATEGORY_LABEL,
  CATEGORIES,
  FOOD_PER_PERSON_DAY,
  GAS_PRICE_USD_PER_GAL,
  nightCost,
  seedEstimate,
  type SeedInputs,
} from "@/lib/costs";
import { fmtMiles, fmtMoney } from "@/lib/format";
import { regionOf, type Region } from "@/lib/geo";
import { useTrip } from "@/lib/store";
import type { DayRoute, ExpenseCategory, Stop } from "@/lib/types";

export default function BudgetPage() {
  const trip = useTrip((s) => s.trip);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const updateTrip = useTrip((s) => s.updateTrip);

  const [openCat, setOpenCat] = useState<ExpenseCategory | null>(null);

  const orderedDays = useMemo(() => [...days].sort((a, b) => a.seq - b.seq), [days]);
  const mpg = trip?.mpg ?? 28;
  const travelers = trip?.travelers ?? 2;

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
      .map((s) => ({
        region: regionOf(s.lat),
        bigCity: BIG_CITY_PATTERN.test(s.name),
        free: s.lodging_free,
        cost: s.lodging_cost,
      }));
    return {
      milesByRegion,
      mpg,
      travelers,
      totalDays: Math.max(1, days.length),
      nights,
      foodPerDay: trip?.food_per_day ?? FOOD_PER_PERSON_DAY,
      activitiesPerDay: trip?.activities_per_day ?? ACTIVITIES_PER_PERSON_DAY,
    };
  }, [routes, stops, mpg, travelers, days.length, trip?.food_per_day, trip?.activities_per_day]);

  const estimates = useMemo(
    () =>
      Object.fromEntries(CATEGORIES.map((c) => [c, seedEstimate(c, seed)])) as Record<
        ExpenseCategory,
        number
      >,
    [seed],
  );
  const total = CATEGORIES.reduce((s, c) => s + estimates[c], 0);
  const totalMiles = Object.values(seed.milesByRegion).reduce((a, b) => a + b, 0);

  // estimated spend per category per day — powers the trend bars
  const daily = useMemo(() => {
    const stopById = new Map(stops.map((s) => [s.id, s]));
    const byCat = {} as Record<ExpenseCategory, number[]>;
    for (const c of CATEGORIES) byCat[c] = [];
    for (const day of orderedDays) {
      const route: DayRoute | undefined = routes[day.id];
      let gas = 0;
      for (const seg of route?.segments ?? []) {
        const from = stopById.get(seg.fromStopId);
        if (!from) continue;
        gas +=
          ((seg.distanceM / 1609.344) * GAS_PRICE_USD_PER_GAL[regionOf(from.lat)]) /
          Math.max(1, mpg);
      }
      const overnight: Stop | undefined = stops.find(
        (s) => s.day_id === day.id && s.is_overnight,
      );
      const lodging = overnight
        ? nightCost({
            region: regionOf(overnight.lat),
            bigCity: BIG_CITY_PATTERN.test(overnight.name),
            free: overnight.lodging_free,
            cost: overnight.lodging_cost,
          })
        : 0;
      byCat.gas.push(gas);
      byCat.lodging.push(lodging);
      byCat.food.push(seed.foodPerDay * travelers);
      byCat.activities.push(seed.activitiesPerDay * travelers);
    }
    return byCat;
  }, [orderedDays, routes, stops, mpg, travelers, seed.foodPerDay, seed.activitiesPerDay]);

  // one-line "how it's figured" per category
  const assumption: Record<ExpenseCategory, string> = useMemo(() => {
    const gallons = totalMiles / Math.max(1, mpg);
    const avgGal = gallons > 0 ? estimates.gas / gallons : 0;
    const nights = seed.nights.length;
    const freeNights = seed.nights.filter((n) => n.free).length;
    const paidNights = nights - freeNights;
    const avgNight = paidNights > 0 ? estimates.lodging / paidNights : 0;
    const nDays = orderedDays.length || 1;
    return {
      gas:
        totalMiles > 0
          ? `${fmtMiles(totalMiles * 1609.344)} at ${mpg} mpg · avg ${fmtMoney(avgGal)}/gal`
          : "No route yet — add stops and this fills in from real miles",
      lodging:
        nights > 0
          ? `${nights} night${nights === 1 ? "" : "s"}${
              freeNights ? ` · ${freeNights} free` : ""
            }${paidNights > 0 ? ` · avg ${fmtMoney(avgNight)}/paid night` : ""}`
          : "No overnights marked yet — flag stops as overnight stays",
      food: `${fmtMoney(seed.foodPerDay)}/person/day × ${travelers} × ${nDays} days`,
      activities: `${fmtMoney(seed.activitiesPerDay)}/person/day × ${travelers} × ${nDays} days`,
    };
  }, [totalMiles, mpg, estimates, seed, orderedDays.length, travelers]);

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3.5 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Trip estimate</p>
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
          <p className="display tnum mt-2 text-[46px] leading-none">{fmtMoney(total)}</p>
          <div className="stat-strip mt-5">
            <span>
              <span className="mono block text-[13px] font-semibold">
                {totalMiles > 0 ? fmtMiles(totalMiles * 1609.344) : "—"}
              </span>
              <span className="eyebrow mt-0.5 block">route</span>
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

        {/* per-category breakdown — tap a row for the math + daily trend */}
        <section className="card p-2">
          {CATEGORIES.map((c) => {
            const color = EXPENSE_COLOR[c];
            const open = openCat === c;
            return (
              <div key={c} className={open ? "rounded-2xl bg-fg/[0.025]" : ""}>
                <button
                  onClick={() => setOpenCat(open ? null : c)}
                  className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left"
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{ background: color.bg, color: color.fg }}
                  >
                    <ExpenseCategoryIcon category={c} size={15} strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{CATEGORY_LABEL[c]}</span>
                    {/* uniform full-width bar per row — consistent, easy to scan */}
                    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full">
                      <span
                        className="block h-full rounded-full"
                        style={{ background: color.fg }}
                      />
                    </span>
                  </span>
                  <span className="tnum text-sm font-semibold">{fmtMoney(estimates[c])}</span>
                  <IconChevronDown
                    size={14}
                    className={`flex-shrink-0 text-fg-faint transition-transform duration-200 ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {open && (
                  <div className="rise-in px-3 pb-3.5 pt-1">
                    <p className="text-[11px] leading-4 text-fg-muted">{assumption[c]}</p>
                    {c === "food" || c === "activities" ? (
                      <RateEditor
                        value={c === "food" ? seed.foodPerDay : seed.activitiesPerDay}
                        travelers={travelers}
                        days={orderedDays.length}
                        color={color.fg}
                        onChange={(v) =>
                          trip &&
                          void updateTrip(
                            c === "food" ? { food_per_day: v } : { activities_per_day: v },
                          )
                        }
                      />
                    ) : (
                      <TrendBars
                        values={daily[c]}
                        color={color.fg}
                        average={estimates[c] / Math.max(1, orderedDays.length)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="hairline-t mx-3 mb-2 mt-1 pt-2.5 text-[10px] leading-4 text-fg-faint">
            Seeded from 2026 regional averages for CA · OR · WA · BC. Fuel and
            lodging sharpen as the route and overnight stays take shape.
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

/**
 * Day-by-day estimate for one category: thin rounded bars in the category
 * hue with a dashed line at the daily average. Labels use text tokens.
 */
function TrendBars({
  values,
  color,
  average,
}: {
  values: number[];
  color: string;
  average: number;
}) {
  const n = values.length;
  const max = Math.max(...values, 1);
  if (n === 0 || values.every((v) => v === 0)) {
    return (
      <p className="mt-2.5 rounded-xl bg-fg/[0.03] px-3 py-2.5 text-center text-[11px] text-fg-faint">
        The day-by-day curve appears once the itinerary has stops.
      </p>
    );
  }

  const W = 320;
  const H = 64;
  const PAD_TOP = 14;
  const gap = 2;
  const bw = (W - gap * (n - 1)) / n;
  const peak = values.indexOf(Math.max(...values));
  const avgY = PAD_TOP + (H - PAD_TOP) * (1 - average / max);

  return (
    <div className="mt-2.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Estimated cost per day">
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 3 : 1.5, (v / max) * (H - PAD_TOP));
          const x = i * (bw + gap);
          return (
            <rect
              key={i}
              x={x}
              y={H - h}
              width={bw}
              height={h}
              rx={Math.min(3, bw / 2)}
              fill={v > 0 ? color : "var(--hairline)"}
              opacity={v > 0 ? 0.9 : 1}
            />
          );
        })}
        {average > 0 && average < max && (
          <line
            x1={0}
            x2={W}
            y1={avgY}
            y2={avgY}
            stroke="var(--fg-faint)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {/* direct label on the peak day only */}
        <text
          x={Math.min(Math.max(peak * (bw + gap) + bw / 2, 16), W - 16)}
          y={Math.max(9, H - (values[peak] / max) * (H - PAD_TOP) - 4)}
          textAnchor="middle"
          fontSize={9}
          fill="var(--fg-muted)"
          className="tnum"
        >
          {fmtMoney(values[peak])}
        </text>
      </svg>
      <div className="mt-1 flex justify-between">
        <span className="eyebrow">day 1</span>
        <span className="eyebrow">avg {fmtMoney(average)}/day</span>
        <span className="eyebrow">day {n}</span>
      </div>
    </div>
  );
}

/**
 * Editable per-person/day rate for food or activities. Steppers nudge by $5,
 * the field takes a typed number, and the projected total updates live.
 */
function RateEditor({
  value,
  travelers,
  days,
  color,
  onChange,
}: {
  value: number;
  travelers: number;
  days: number;
  color: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);

  // Sync the field when the stored value changes (e.g. steppers) — the
  // recommended "adjust state during render" pattern, no effect needed.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  function commit(next: number) {
    const clamped = Math.max(0, Math.min(2000, Math.round(next)));
    onChange(clamped);
  }

  const total = value * travelers * Math.max(1, days);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => commit(value - 5)}
          aria-label="Lower rate"
          className="btn-ghost pressable flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
        >
          −
        </button>
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
            $
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={() => commit(Number(draft) || 0)}
            inputMode="decimal"
            aria-label="Per person per day"
            className="field w-full pl-6 text-center tnum font-semibold"
            style={{ color }}
          />
        </div>
        <button
          onClick={() => commit(value + 5)}
          aria-label="Raise rate"
          className="btn-ghost pressable flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
        >
          +
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-fg-muted">
        per person / day · <span className="tnum">{fmtMoney(total)}</span> projected
      </p>
    </div>
  );
}
