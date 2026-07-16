"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { IconSearch } from "@/components/Icons";
import { CA_PROVINCES, US_STATES } from "@/lib/gameData";
import { SPRING } from "@/lib/motion";
import { useTrip } from "@/lib/store";
import { useGameEvents, usePlayers } from "./shared";

/**
 * License-plate spotting — cooperative. One shared collection: whoever sees
 * a plate taps it and it counts for the team (the tile keeps the spotter's
 * color for bragging rights). Tap any claimed tile again to release it.
 */
export default function PlatesGame() {
  const events = useGameEvents("plates");
  const { me, partner } = usePlayers();
  const addGameEvent = useTrip((s) => s.addGameEvent);
  const deleteGameEvent = useTrip((s) => s.deleteGameEvent);
  const [query, setQuery] = useState("");

  const claims = useMemo(() => {
    const m = new Map<string, { id: string; by: string | null }>();
    for (const e of events) {
      if (e.kind === "claim" && e.key) m.set(e.key, { id: e.id, by: e.created_by });
    }
    return m;
  }, [events]);

  const total = US_STATES.length + CA_PROVINCES.length;

  function tap(code: string) {
    const claim = claims.get(code);
    if (!claim) void addGameEvent({ game: "plates", kind: "claim", key: code });
    else void deleteGameEvent(claim.id); // cooperative — either of us can undo
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
                    color: "#fff",
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
