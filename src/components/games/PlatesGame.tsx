"use client";

import { useMemo } from "react";
import { CA_PROVINCES, US_STATES } from "@/lib/gameData";
import { useTrip } from "@/lib/store";
import { ScoreStrip, useGameEvents, usePlayers } from "./shared";

/**
 * License-plate spotting: first phone to tap a state claims it in their
 * color. Tap one of your own claims again to release it (mis-taps happen
 * at 70 mph). The unique index in Postgres referees simultaneous grabs.
 */
export default function PlatesGame() {
  const events = useGameEvents("plates");
  const { me, partner } = usePlayers();
  const addGameEvent = useTrip((s) => s.addGameEvent);
  const deleteGameEvent = useTrip((s) => s.deleteGameEvent);

  const claims = useMemo(() => {
    const m = new Map<string, { id: string; by: string | null }>();
    for (const e of events) {
      if (e.kind === "claim" && e.key) m.set(e.key, { id: e.id, by: e.created_by });
    }
    return m;
  }, [events]);

  const mine = [...claims.values()].filter((c) => c.by === me?.id).length;
  const theirs = [...claims.values()].filter((c) => partner && c.by === partner.id).length;
  const total = US_STATES.length + CA_PROVINCES.length;

  function tap(code: string) {
    const claim = claims.get(code);
    if (!claim) {
      void addGameEvent({ game: "plates", kind: "claim", key: code });
    } else if (claim.by === me?.id) {
      void deleteGameEvent(claim.id);
    }
    // theirs — hands off
  }

  function colorFor(by: string | null): string | undefined {
    if (by === me?.id) return me?.color;
    if (by === partner?.id) return partner?.color;
    return "var(--fg-faint)";
  }

  return (
    <div className="space-y-3.5">
      <ScoreStrip me={me} partner={partner} mine={mine} theirs={theirs} />
      <p className="px-1 text-center text-[11px] text-fg-faint">
        {claims.size}/{total} spotted · tap a plate when you see it — first phone wins it
      </p>
      <section className="card p-4">
        <p className="eyebrow mb-2.5 px-1">United States</p>
        <PlateGrid items={US_STATES} claims={claims} onTap={tap} colorFor={colorFor} />
      </section>
      <section className="card p-4">
        <p className="eyebrow mb-2.5 px-1">Canada</p>
        <PlateGrid items={CA_PROVINCES} claims={claims} onTap={tap} colorFor={colorFor} />
      </section>
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
