"use client";

import { useMemo } from "react";
import { ROADSIDE_ITEMS } from "@/lib/gameData";
import { useTrip } from "@/lib/store";
import { ScoreStrip, useGameEvents, usePlayers } from "./shared";

/**
 * Roadside I-spy: a shared scavenger list — call it out, tap it, it's
 * yours. Tap your own claim to give it back.
 */
export default function RoadsideGame() {
  const events = useGameEvents("roadside");
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

  function tap(item: string) {
    const claim = claims.get(item);
    if (!claim) {
      void addGameEvent({ game: "roadside", kind: "claim", key: item });
    } else if (claim.by === me?.id) {
      void deleteGameEvent(claim.id);
    }
  }

  return (
    <div className="space-y-3.5">
      <ScoreStrip me={me} partner={partner} mine={mine} theirs={theirs} />
      <p className="px-1 text-center text-[11px] text-fg-faint">
        See it first, tap it first — {claims.size}/{ROADSIDE_ITEMS.length} spotted
      </p>
      <section className="card p-4">
        <div className="grid grid-cols-2 gap-1.5">
          {ROADSIDE_ITEMS.map((item) => {
            const claim = claims.get(item);
            const color =
              claim?.by === me?.id
                ? me?.color
                : claim?.by === partner?.id
                  ? partner?.color
                  : undefined;
            return (
              <button
                key={item}
                onClick={() => tap(item)}
                className="pressable flex min-h-[46px] items-center gap-2 rounded-xl border px-3 text-left text-xs font-medium leading-4"
                style={
                  claim
                    ? {
                        borderColor: "transparent",
                        background: color ?? "var(--fg-faint)",
                        color: "var(--on-strong)",
                      }
                    : { borderColor: "var(--hairline)", color: "var(--fg-muted)" }
                }
              >
                {item}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
