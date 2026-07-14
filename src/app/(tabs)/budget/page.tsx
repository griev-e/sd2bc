"use client";

import { useMemo, useState } from "react";
import AttributionDot from "@/components/Attribution";
import CountdownPill from "@/components/CountdownPill";
import ExpenseSheet from "@/components/ExpenseSheet";
import { ExpenseCategoryIcon } from "@/components/CategoryIcon";
import { IconPlus, IconX } from "@/components/Icons";
import {
  CATEGORY_LABEL,
  CATEGORIES,
  GAS_PRICE_USD_PER_GAL,
  BIG_CITY_PATTERN,
  projectCategory,
  type SeedInputs,
} from "@/lib/costs";
import { daysUntil, fmtDate, fmtMoney } from "@/lib/format";
import { regionOf, type Region } from "@/lib/geo";
import { useTrip } from "@/lib/store";

export default function BudgetPage() {
  const trip = useTrip((s) => s.trip);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const expenses = useTrip((s) => s.expenses);
  const profiles = useTrip((s) => s.profiles);
  const updateTrip = useTrip((s) => s.updateTrip);
  const deleteExpense = useTrip((s) => s.deleteExpense);

  const [view, setView] = useState<"categories" | "log">("categories");
  const [addOpen, setAddOpen] = useState(false);

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

  const daysElapsed = useMemo(() => {
    if (!trip) return 0;
    const until = daysUntil(trip.start_date);
    if (until > 0) return 0;
    return Math.min(days.length, 1 - until);
  }, [trip, days.length]);

  const projections = useMemo(
    () => CATEGORIES.map((c) => projectCategory(c, expenses, seed, daysElapsed)),
    [expenses, seed, daysElapsed],
  );

  const totals = useMemo(
    () => ({
      estimate: projections.reduce((s, p) => s + p.estimate, 0),
      actual: projections.reduce((s, p) => s + p.actual, 0),
      projected: projections.reduce((s, p) => s + p.projected, 0),
    }),
    [projections],
  );

  const split = useMemo(() => {
    const byUser = new Map<string, number>();
    for (const e of expenses) {
      if (!e.created_by) continue;
      byUser.set(e.created_by, (byUser.get(e.created_by) ?? 0) + Number(e.amount));
    }
    return byUser;
  }, [expenses]);

  const anyBlended = projections.some((p) => p.blended);
  const maxTrack = Math.max(...projections.map((p) => Math.max(p.projected, p.estimate)), 1);

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3.5 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Budget</p>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight">The damage</h1>
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
                "radial-gradient(90% 90% at 85% -20%, var(--accent-soft), transparent 60%)",
            }}
          />
          <p className="eyebrow">Projected trip total</p>
          <p className="tnum mt-1.5 text-[40px] font-bold leading-none tracking-[-0.03em]">
            {fmtMoney(totals.projected)}
          </p>
          <div className="tnum mt-3 flex gap-5 text-xs">
            <span>
              <span className="block text-fg-faint">Spent</span>
              <span className="mt-0.5 block font-semibold">{fmtMoney(totals.actual)}</span>
            </span>
            <span>
              <span className="block text-fg-faint">Seed estimate</span>
              <span className="mt-0.5 block font-semibold">{fmtMoney(totals.estimate)}</span>
            </span>
            <span>
              <span className="block text-fg-faint">Forecast</span>
              <span className="mt-0.5 block font-semibold text-accent">
                {anyBlended ? "live-blended" : daysElapsed > 0 ? "refining" : "seeded"}
              </span>
            </span>
          </div>
        </section>

        {/* segmented control */}
        <div className="card flex rounded-2xl p-1">
          {(["categories", "log"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`pressable min-h-[40px] flex-1 rounded-xl text-sm font-semibold transition ${
                view === v ? "btn-primary" : "text-fg-muted"
              }`}
            >
              {v === "categories" ? "Breakdown" : "Expense log"}
            </button>
          ))}
        </div>

        {view === "categories" ? (
          <>
            {/* bullet chart per category: fill = actual, track = projected, tick = estimate */}
            <section className="card space-y-4 p-5">
              {projections.map((p) => (
                <div key={p.category}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="text-fg-muted">
                        <ExpenseCategoryIcon category={p.category} size={14} strokeWidth={2} />
                      </span>
                      {CATEGORY_LABEL[p.category]}
                      {p.blended && (
                        <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
                          live
                        </span>
                      )}
                    </p>
                    <p className="tnum text-sm font-semibold">{fmtMoney(p.projected)}</p>
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-fg/5">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-accent-soft"
                      style={{ width: `${(p.projected / maxTrack) * 100}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                      style={{
                        width: `${(Math.min(p.actual, maxTrack) / maxTrack) * 100}%`,
                        background: "var(--accent-gradient)",
                      }}
                    />
                    <div
                      className="absolute inset-y-0 w-0.5 bg-fg-faint"
                      style={{ left: `${(Math.min(p.estimate, maxTrack) / maxTrack) * 100}%` }}
                    />
                  </div>
                  <p className="tnum mt-1 text-[11px] text-fg-faint">
                    {fmtMoney(p.actual)} spent · est {fmtMoney(p.estimate)}
                  </p>
                </div>
              ))}
              <p className="hairline-t pt-3 text-[10px] leading-4 text-fg-faint">
                Solid bar = spent · light track = projected · tick = seed estimate.
                Forecasts switch to your real averages after 3 logged expenses per category.
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

            {/* 50/50 split */}
            {profiles.length > 0 && (
              <section className="card p-5">
                <p className="eyebrow mb-3">Who&apos;s paid what</p>
                <div className="space-y-2.5">
                  {profiles.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <AttributionDot userId={p.id} size={22} />
                      <span className="flex-1 text-sm font-medium">{p.username}</span>
                      <span className="tnum text-sm font-semibold">
                        {fmtMoney(split.get(p.id) ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
                {profiles.length === 2 && (
                  <SplitLine
                    a={{ name: profiles[0].username, paid: split.get(profiles[0].id) ?? 0 }}
                    b={{ name: profiles[1].username, paid: split.get(profiles[1].id) ?? 0 }}
                  />
                )}
              </section>
            )}
          </>
        ) : (
          <ExpenseLog onDelete={(id) => void deleteExpense(id)} />
        )}
      </div>

      {/* quick add */}
      <button
        onClick={() => setAddOpen(true)}
        aria-label="Log expense"
        className="btn-primary pressable fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl"
      >
        <IconPlus size={20} />
      </button>

      <ExpenseSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function SplitLine({
  a,
  b,
}: {
  a: { name: string; paid: number };
  b: { name: string; paid: number };
}) {
  const diff = (a.paid - b.paid) / 2;
  if (Math.abs(diff) < 0.01) {
    return <p className="hairline-t mt-3 pt-3 text-xs text-fg-muted">Perfectly even.</p>;
  }
  const debtor = diff > 0 ? b.name : a.name;
  const creditor = diff > 0 ? a.name : b.name;
  return (
    <p className="hairline-t mt-3 pt-3 text-xs text-fg-muted">
      Even split: <span className="font-semibold text-fg">{debtor}</span> owes{" "}
      <span className="font-semibold text-fg">{creditor}</span>{" "}
      <span className="tnum font-semibold text-accent">{fmtMoney(Math.abs(diff))}</span>
    </p>
  );
}

function ExpenseLog({ onDelete }: { onDelete: (id: string) => void }) {
  const expenses = useTrip((s) => s.expenses);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const groups = new Map<string, typeof expenses>();
    const sorted = [...expenses].sort((a, b) => (a.spent_on < b.spent_on ? 1 : -1));
    for (const e of sorted) {
      const list = groups.get(e.spent_on) ?? [];
      list.push(e);
      groups.set(e.spent_on, list);
    }
    return [...groups.entries()];
  }, [expenses]);

  if (expenses.length === 0) {
    return (
      <section className="card p-8 text-center">
        <p className="text-sm font-medium">Nothing logged yet</p>
        <p className="mt-1.5 text-xs leading-5 text-fg-muted">
          Tap + when you spend your first road-trip dollar — the forecast gets
          smarter with every entry.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-3.5">
      {byDate.map(([date, list]) => (
        <section key={date} className="card p-4">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <p className="eyebrow">{fmtDate(date)}</p>
            <p className="tnum text-xs font-semibold text-fg-muted">
              {fmtMoney(list.reduce((s, e) => s + Number(e.amount), 0))}
            </p>
          </div>
          <div>
            {list.map((e) => (
              <div key={e.id} className="flex min-h-[48px] items-center gap-3 rounded-xl px-1.5 py-1.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-hairline text-fg-muted">
                  <ExpenseCategoryIcon category={e.category} size={14} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="tnum text-sm font-semibold">
                    {fmtMoney(Number(e.amount))}
                    <span className="ml-1.5 text-xs font-normal text-fg-muted">
                      {CATEGORY_LABEL[e.category]}
                    </span>
                  </p>
                  {e.note && <p className="truncate text-xs text-fg-faint">{e.note}</p>}
                </div>
                <AttributionDot userId={e.created_by} size={16} />
                <button
                  onClick={() => {
                    if (confirmId === e.id) {
                      onDelete(e.id);
                      setConfirmId(null);
                    } else {
                      setConfirmId(e.id);
                    }
                  }}
                  aria-label="Delete expense"
                  className={`pressable rounded-lg px-2 py-2 text-xs font-semibold ${
                    confirmId === e.id ? "bg-danger text-white" : "text-fg-faint"
                  }`}
                >
                  {confirmId === e.id ? "Sure?" : <IconX size={12} />}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
