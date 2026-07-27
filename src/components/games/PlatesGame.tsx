"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { IconSearch } from "@/components/Icons";
import { CA_PROVINCES, US_STATES } from "@/lib/gameData";
import { SPRING } from "@/lib/motion";
import { parseRanking, rankedCodes } from "@/lib/plateRank";
import { useTrip } from "@/lib/store";
import PlateRankings from "./PlateRankings";
import PlateRater from "./PlateRater";
import { useGameEvents, usePlayers } from "./shared";

/**
 * License-plate spotting — cooperative claims, competitive taste. One shared
 * collection: whoever sees a plate taps it and it counts for the team (the
 * tile keeps the spotter's color for bragging rights). Tap any claimed tile
 * again to release it. Every claimed plate then gets a personal Beli-style
 * score from each traveler — see PlateRater/PlateRankings.
 */
export default function PlatesGame() {
  const events = useGameEvents("plates");
  const { me, partner } = usePlayers();
  const addGameEvent = useTrip((s) => s.addGameEvent);
  const deleteGameEvent = useTrip((s) => s.deleteGameEvent);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"spot" | "rank">("spot");
  const [raterQueue, setRaterQueue] = useState<string[]>([]);
  const [raterOpen, setRaterOpen] = useState(false);
  // bumped per rating session — remounts the rater so its state starts fresh
  const [raterSession, setRaterSession] = useState(0);

  const claims = useMemo(() => {
    const m = new Map<string, { id: string; by: string | null }>();
    for (const e of events) {
      if (e.kind === "claim" && e.key) m.set(e.key, { id: e.id, by: e.created_by });
    }
    return m;
  }, [events]);

  // Claimed plates I haven't placed in my ranking yet, in spotting order.
  // The *unfiltered* document counts as rated — a released-then-reclaimed
  // plate keeps its old placement instead of nagging for a re-duel.
  const toRate = useMemo(() => {
    const mine = rankedCodes(parseRanking(events, me?.id ?? null));
    return [...claims.keys()].filter((c) => !mine.has(c));
  }, [events, claims, me?.id]);

  const total = US_STATES.length + CA_PROVINCES.length;

  function openRater(codes: string[]) {
    if (codes.length === 0) return;
    setRaterQueue(codes);
    setRaterSession((n) => n + 1);
    setRaterOpen(true);
  }

  function tap(code: string) {
    const claim = claims.get(code);
    if (!claim) {
      void addGameEvent({ game: "plates", kind: "claim", key: code });
      openRater([code]); // fresh spot → straight into the rater
    } else {
      void deleteGameEvent(claim.id); // cooperative — either of us can undo
    }
  }

  function colorFor(by: string | null): string | undefined {
    if (by === me?.id) return me?.color;
    if (by === partner?.id) return partner?.color;
    return "var(--fg-faint)";
  }

  // search matches "CA", "cal", or "california"
  const q = query.trim().toLowerCase();
  const match = (item: { code: string; name: string }) =>
    q === "" ||
    item.code.toLowerCase().startsWith(q) ||
    item.name.toLowerCase().includes(q);
  const usFiltered = US_STATES.filter(match);
  const caFiltered = CA_PROVINCES.filter(match);

  return (
    <div className="space-y-3.5">
      {/* spot ↔ rankings switch */}
      <div className="card flex rounded-full p-1">
        {(
          [
            { id: "spot", label: "Spot" },
            { id: "rank", label: "Rankings" },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`pressable relative flex-1 rounded-full py-2 text-xs font-semibold transition-colors duration-200 ${
              view === v.id ? "text-accent-contrast" : "text-fg-muted"
            }`}
          >
            {view === v.id && (
              <motion.span
                layoutId="plates-view-pill"
                transition={SPRING}
                className="btn-primary absolute inset-0 rounded-full"
              />
            )}
            <span className="relative">{v.label}</span>
          </button>
        ))}
      </div>

      {/* the judging never waits: new spots from either phone queue up here */}
      {toRate.length > 0 && (
        <button
          onClick={() => openRater(toRate)}
          className="card pressable flex w-full items-center gap-3 p-4 text-left"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-base">
            ⚖️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {toRate.length === 1
                ? "1 plate needs your score"
                : `${toRate.length} plates need your score`}
            </span>
            <span className="block text-[11px] text-fg-faint">
              Quick duels, Beli-style — your take, out of 10
            </span>
          </span>
          <span className="btn-primary rounded-full px-3.5 py-1.5 text-xs font-semibold">
            Rate
          </span>
        </button>
      )}

      {view === "rank" ? (
        <PlateRankings onRate={openRater} />
      ) : (
        <>
          {/* team progress */}
          <section className="card p-4">
            <div className="flex items-baseline justify-between">
              <p className="tnum text-2xl font-bold leading-none">
                {claims.size}
                <span className="text-sm font-semibold text-fg-faint"> / {total}</span>
              </p>
              <p className="eyebrow">spotted together</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-fg/5">
              {/* scaleX instead of width — transform-only, springs smoothly */}
              <motion.div
                initial={false}
                animate={{ scaleX: claims.size / total }}
                transition={SPRING}
                className="h-full w-full origin-left rounded-full"
                style={{ background: "var(--accent-gradient)" }}
              />
            </div>
          </section>

          {/* find a state fast at 70 mph */}
          <div className="relative">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-faint"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — California or CA"
              autoCapitalize="none"
              autoCorrect="off"
              className="field pl-10"
              aria-label="Search states and provinces"
            />
          </div>

          {usFiltered.length > 0 && (
            <section className="card p-4">
              <p className="eyebrow mb-2.5 px-1">United States</p>
              <PlateGrid items={usFiltered} claims={claims} onTap={tap} colorFor={colorFor} />
            </section>
          )}
          {caFiltered.length > 0 && (
            <section className="card p-4">
              <p className="eyebrow mb-2.5 px-1">Canada</p>
              <PlateGrid items={caFiltered} claims={claims} onTap={tap} colorFor={colorFor} />
            </section>
          )}
          {usFiltered.length === 0 && caFiltered.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-muted">
              Nothing matches &ldquo;{query}&rdquo;.
            </p>
          )}
        </>
      )}

      <PlateRater
        key={raterSession}
        open={raterOpen}
        queue={raterQueue}
        onClose={() => setRaterOpen(false)}
      />
    </div>
  );
}

function PlateGrid({
  items,
  claims,
  onTap,
  colorFor,
}: {
  items: { code: string; name: string }[];
  claims: Map<string, { id: string; by: string | null }>;
  onTap: (code: string) => void;
  colorFor: (by: string | null) => string | undefined;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {items.map(({ code, name }) => {
        const claim = claims.get(code);
        return (
          <button
            key={code}
            onClick={() => onTap(code)}
            title={name}
            className="mono pressable flex h-11 items-center justify-center rounded-xl border text-xs font-semibold transition-colors"
            style={
              claim
                ? {
                    background: colorFor(claim.by),
                    borderColor: "transparent",
                    color: "var(--on-strong)",
                  }
                : { borderColor: "var(--hairline)", color: "var(--fg-muted)" }
            }
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
