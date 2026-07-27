"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import AttributionDot from "@/components/Attribution";
import { IconChevronDown, IconCrown, IconSearch, IconX } from "@/components/Icons";
import { fmtMoney } from "@/lib/format";
import { riseIn, SPRING } from "@/lib/motion";
import { useTrip } from "@/lib/store";
import { CATALOG_YEAR, MIN_YEAR } from "@/lib/carData";
import {
  carLabel,
  carPriceKey,
  catalogMsrp,
  filterNames,
  makeNames,
  modelsForMake,
  parseSighting,
  pointsFor,
  scoreFor,
  sightingLabel,
  tierOf,
  trimsForModel,
  yearOptions,
  type CarSighting,
  type PriceTier,
} from "@/lib/carPrice";
import { resolveCarPrice, UnknownCarError, type PriceResult } from "@/lib/carPriceLookup";
import { ScoreStrip, useGameEvents, usePlayers } from "./shared";

/**
 * Tier → design tokens. Written out rather than derived from the tier id,
 * because Tailwind builds its stylesheet by scanning source for literal class
 * names — a template like `bg-${color}-soft` produces no CSS at all.
 */
const TIER_CLASS: Record<PriceTier, string> = {
  hyper: "bg-gold-soft text-gold",
  exotic: "bg-violet-soft text-violet",
  luxury: "bg-indigo-soft text-indigo",
  premium: "bg-sky-soft text-sky",
  mainstream: "bg-green-soft text-green",
  economy: "bg-slate-soft text-slate",
};

interface LoggedCar extends CarSighting {
  id: string;
  by: string | null;
  at: string;
}

/**
 * "$$$ Cars" — log what rolled past by year / make / model / trim and the game
 * prices it. The 2026 catalog answers instantly and for free; anything it
 * doesn't cover (an older car, something exotic) goes to the cached Haiku
 * lookup behind a deliberate tap. Each sighting lands in a price tier worth
 * points, so the scoreboard rewards rare metal over sheer volume.
 */
export default function CarsGame() {
  const events = useGameEvents("cars");
  const { me, partner } = usePlayers();
  const addGameEvent = useTrip((s) => s.addGameEvent);
  const deleteGameEvent = useTrip((s) => s.deleteGameEvent);

  const [year, setYear] = useState(CATALOG_YEAR);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * The looked-up price and any error carry the selection they belong to.
   * Nothing has to reset them when the pickers change: a result for a car
   * you've moved on from simply stops matching, which also makes a slow AI
   * answer landing after the next selection a non-event.
   */
  const [aiPrice, setAiPrice] = useState<{ key: string; result: PriceResult } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const cars = useMemo<LoggedCar[]>(
    () =>
      events
        .filter((e) => e.kind === "entry")
        .flatMap((e) => {
          const car = parseSighting(e.value);
          return car ? [{ ...car, id: e.id, by: e.created_by, at: e.created_at }] : [];
        })
        .sort((a, b) => b.msrp - a.msrp),
    [events],
  );

  const models = useMemo(() => modelsForMake(make).map((m) => m.name), [make]);
  const trims = useMemo(() => trimsForModel(make, model).map((t) => t.name), [make, model]);

  // The catalog is a pure lookup over the current selection — free, instant,
  // and the answer for the overwhelming majority of sightings.
  const selectionKey = carPriceKey(year, make, model, trim);
  const catalog = useMemo(
    () => (make && model ? catalogMsrp(year, make, model, trim) : null),
    [year, make, model, trim],
  );
  const price: PriceResult | null =
    catalog !== null
      ? { msrp: catalog, source: "catalog", confidence: "high", resolved: "", note: "" }
      : aiPrice?.key === selectionKey
        ? aiPrice.result
        : null;
  const shownError = error?.key === selectionKey ? error.message : null;

  /**
   * The AI half, behind a deliberate tap — a catalog miss never bills a model
   * on a keystroke. The lookup still checks memory and the shared Supabase
   * cache first, so a car either phone has already priced comes back free.
   */
  async function lookUpPrice() {
    if (!make || !model || busy) return;
    const key = selectionKey;
    setBusy(true);
    setError(null);
    try {
      setAiPrice({ key, result: await resolveCarPrice(year, make, model, trim) });
    } catch (err) {
      setError({
        key,
        message:
          err instanceof UnknownCarError
            ? "Couldn't place that one — enter the price yourself."
            : err instanceof Error
              ? err.message
              : "The price lookup failed — try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const manualMsrp = Math.round(Number(manual.replace(/[^0-9.]/g, "")) || 0);
  const finalMsrp = manualMsrp || price?.msrp || 0;
  const canLog = Boolean(make && model && finalMsrp > 0);

  function submit() {
    if (!canLog) return;
    void addGameEvent({
      game: "cars",
      kind: "entry",
      value: {
        year,
        make,
        model,
        trim,
        msrp: finalMsrp,
        source: manualMsrp ? "manual" : (price?.source ?? "manual"),
        // a plain label alongside the structured fields, so the row still
        // reads sensibly to anything that only knows the original shape
        name: carLabel({ year, make, model, trim }),
      },
    });
    // clearing the make empties the cascade; the tagged price and error stop
    // matching the new (empty) selection on their own
    setMake("");
    setModel("");
    setTrim("");
    setManual("");
  }

  const myScore = scoreFor(cars.filter((c) => c.by === me?.id));
  const theirScore = scoreFor(cars.filter((c) => c.by === partner?.id));
  const best = cars[0] ?? null;

  return (
    <div className="space-y-3.5">
      <ScoreStrip
        me={me}
        partner={partner}
        mine={myScore}
        theirs={theirScore}
        unit="points"
      />

      {/* best find so far — the thing worth bragging about */}
      {best && (
        <motion.section {...riseIn()} className="card flex items-center gap-3 p-4">
          <span className="text-2xl leading-none">{tierOf(best.msrp).emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Best find</p>
            <p className="truncate text-sm font-semibold">{sightingLabel(best)}</p>
          </div>
          <p className="tnum text-lg font-bold">{fmtMoney(best.msrp)}</p>
        </motion.section>
      )}

      {/* log a sighting */}
      <section className="card space-y-2.5 p-4">
        <p className="eyebrow px-1">Spotted something fancy?</p>

        {/* year — a scroller, since it's almost always the newest few */}
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {yearOptions(MIN_YEAR).map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`pressable tnum h-9 flex-shrink-0 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                y === year
                  ? "bg-accent text-accent-contrast"
                  : "bg-fg/5 text-fg-muted"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <Picker
          label="Make"
          value={make}
          options={makeNames()}
          onChange={(v) => {
            setMake(v);
            setModel("");
            setTrim("");
          }}
        />
        <Picker
          label="Model"
          value={model}
          options={models}
          disabled={!make}
          onChange={(v) => {
            setModel(v);
            setTrim("");
          }}
        />
        <Picker
          label="Trim"
          value={trim}
          options={trims}
          disabled={!model}
          optional
          onChange={setTrim}
        />

        {/* resolved price, or the way to get one */}
        <div className="rounded-xl bg-fg/[0.03] p-3">
          {price ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">
                  MSRP · {price.source === "catalog" ? "2026 catalog" : "AI estimate"}
                  {price.source === "ai" && price.confidence !== "high"
                    ? ` · ${price.confidence} confidence`
                    : ""}
                </p>
                <p className="tnum text-xl font-bold leading-tight">
                  {fmtMoney(price.msrp)}
                </p>
                {price.resolved && (
                  <p className="truncate text-[11px] text-fg-faint">{price.resolved}</p>
                )}
              </div>
              <TierBadge msrp={price.msrp} />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[13px] text-fg-muted">
                {!make || !model
                  ? "Pick a make and model."
                  : `Not in the ${CATALOG_YEAR} catalog — look it up or type a price.`}
              </p>
              <button
                onClick={lookUpPrice}
                disabled={!make || !model || busy}
                className="btn-ghost pressable h-9 flex-shrink-0 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-40"
              >
                {busy ? "Checking…" : "Look up price"}
              </button>
            </div>
          )}
          {shownError && (
            <p className="mt-2 text-[11px] font-semibold text-coral">{shownError}</p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder={price ? "override $" : "MSRP $"}
            inputMode="numeric"
            className="field flex-1"
          />
          <button
            onClick={submit}
            disabled={!canLog}
            className="btn-primary pressable rounded-xl px-5 text-sm font-semibold disabled:opacity-40"
          >
            Log it
          </button>
        </div>
      </section>

      {/* leaderboard */}
      {cars.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">
          No sightings yet — keep your eyes on the fast lane.
        </p>
      ) : (
        <section className="card p-4">
          <div className="space-y-1">
            {cars.map((car, i) => (
              <div
                key={car.id}
                className={`flex min-h-[52px] items-center gap-3 rounded-xl px-2 py-1.5 ${
                  i === 0 ? "bg-gold-soft" : ""
                }`}
              >
                {i === 0 ? (
                  <IconCrown size={16} className="flex-shrink-0 text-gold" />
                ) : (
                  <span className="mono w-4 flex-shrink-0 text-center text-[11px] text-fg-faint">
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{sightingLabel(car)}</p>
                  <p className="tnum text-[11px] text-fg-faint">
                    {tierOf(car.msrp).label} · +{pointsFor(car.msrp)} pts ·{" "}
                    {new Date(car.at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <p className="tnum text-sm font-bold">{fmtMoney(car.msrp)}</p>
                <AttributionDot userId={car.by} size={16} />
                {car.by === me?.id && (
                  <button
                    onClick={() => void deleteGameEvent(car.id)}
                    aria-label="Remove entry"
                    className="pressable -mr-1 flex h-8 w-7 items-center justify-center text-fg-faint"
                  >
                    <IconX size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TierBadge({ msrp }: { msrp: number }) {
  const tier = tierOf(msrp);
  return (
    <span
      className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TIER_CLASS[tier.id]}`}
    >
      {tier.emoji} {tier.label}
    </span>
  );
}

/**
 * One step of the year → make → model → trim cascade: a tap-to-open list with
 * a search box, plus a "use what I typed" escape hatch so a car the catalog
 * has never heard of can still be logged (the AI lookup prices those).
 */
function Picker({
  label,
  value,
  options,
  onChange,
  disabled,
  optional,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  optional?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => filterNames(options, query), [options, query]);
  const typed = query.trim();
  // offer the free-text option only when it isn't already in the list
  const showCustom =
    typed.length > 0 && !options.some((o) => o.toLowerCase() === typed.toLowerCase());

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="field flex items-center gap-2 text-left disabled:opacity-40"
      >
        <span className="eyebrow flex-shrink-0">{label}</span>
        <span
          className={`flex-1 truncate text-[15px] ${value ? "font-semibold" : "text-fg-faint"}`}
        >
          {value || (optional ? "any" : `Choose ${label.toLowerCase()}`)}
        </span>
        {value && !disabled && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={(e) => {
              e.stopPropagation();
              choose("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                choose("");
              }
            }}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-fg-faint"
          >
            <IconX size={11} />
          </span>
        )}
        <IconChevronDown
          size={16}
          className={`flex-shrink-0 text-fg-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <div className="mt-1.5 rounded-xl border border-hairline bg-bg-elevated p-1.5">
              <div className="relative">
                <IconSearch
                  size={15}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint"
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="h-10 w-full rounded-lg bg-fg/5 pl-8 pr-3 text-[15px] outline-none"
                />
              </div>
              <div className="mt-1 max-h-56 overflow-y-auto">
                {matches.map((name) => (
                  <button
                    key={name}
                    onClick={() => choose(name)}
                    className="flex min-h-[40px] w-full items-center rounded-lg px-2.5 text-left text-[15px] hover:bg-fg/5"
                  >
                    {name}
                  </button>
                ))}
                {showCustom && (
                  <button
                    onClick={() => choose(typed)}
                    className="flex min-h-[40px] w-full items-center rounded-lg px-2.5 text-left text-[15px] font-semibold text-accent hover:bg-accent-soft"
                  >
                    Use “{typed}”
                  </button>
                )}
                {matches.length === 0 && !showCustom && (
                  <p className="px-2.5 py-3 text-[13px] text-fg-faint">
                    {options.length === 0 ? "Nothing listed — type a name." : "No matches."}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
