"use client";

import { useMemo, useState } from "react";
import { IconPlus } from "@/components/Icons";
import { displayName } from "@/lib/format";
import { FASTFOOD_CHAINS } from "@/lib/gameData";
import { useTrip } from "@/lib/store";
import { useGameEvents, usePlayers } from "./shared";
import type { Profile } from "@/lib/types";

/**
 * Chain count: each traveler picks a chain, then counts every sign,
 * billboard, and storefront they spot for it. Most sightings when you
 * pull back into San Diego wins.
 */
export default function FastFoodGame() {
  const events = useGameEvents("fastfood");
  const { me, partner } = usePlayers();
  const addGameEvent = useTrip((s) => s.addGameEvent);
  const deleteGameEvent = useTrip((s) => s.deleteGameEvent);
  const [switching, setSwitching] = useState(false);

  // latest pick per player
  const pickOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) {
      if (e.kind === "entry" && e.created_by && typeof e.value.pick === "string") {
        m.set(e.created_by, e.value.pick);
      }
    }
    return m;
  }, [events]);

  const myPick = me ? pickOf.get(me.id) : undefined;
  const theirPick = partner ? pickOf.get(partner.id) : undefined;

  const countFor = (userId: string | undefined, chain: string | undefined) =>
    userId && chain
      ? events.filter(
          (e) => e.kind === "count" && e.created_by === userId && e.key === chain,
        ).length
      : 0;

  const myCount = countFor(me?.id, myPick);
  const theirCount = countFor(partner?.id, theirPick);

  const chainName = (id: string | undefined) =>
    FASTFOOD_CHAINS.find((c) => c.id === id)?.name ?? "—";

  function spot() {
    if (!myPick) return;
    void addGameEvent({ game: "fastfood", kind: "count", key: myPick });
  }

  function undo() {
    if (!me || !myPick) return;
    const mine = events.filter(
      (e) => e.kind === "count" && e.created_by === me.id && e.key === myPick,
    );
    const last = mine[mine.length - 1];
    if (last) void deleteGameEvent(last.id);
  }

  if (!myPick || switching) {
    return (
      <div className="space-y-3.5">
        <section className="card p-5">
          <p className="eyebrow">Pick your chain</p>
          <p className="mt-1.5 text-xs leading-5 text-fg-muted">
            Count every sign, billboard, and storefront for it the whole trip.
            {theirPick && ` ${displayName(partner)} rides with ${chainName(theirPick)}.`}
          </p>
          <div className="mt-3.5 grid grid-cols-2 gap-1.5">
            {FASTFOOD_CHAINS.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  void addGameEvent({ game: "fastfood", kind: "entry", value: { pick: c.id } });
                  setSwitching(false);
                }}
                className={`pressable min-h-[46px] rounded-xl border px-3 text-xs font-semibold ${
                  c.id === myPick
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-hairline text-fg-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {switching && (
            <button
              onClick={() => setSwitching(false)}
              className="btn-ghost pressable mt-3 h-10 w-full rounded-xl text-xs font-semibold"
            >
              Never mind
            </button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <PlayerCard
          player={me}
          chain={chainName(myPick)}
          count={myCount}
          you
        />
        <PlayerCard
          player={partner}
          chain={theirPick ? chainName(theirPick) : undefined}
          count={theirCount}
        />
      </div>

      <button
        onClick={spot}
        className="btn-primary pressable flex h-20 w-full items-center justify-center gap-2.5 rounded-2xl text-lg font-bold"
      >
        <IconPlus size={20} strokeWidth={2.2} />
        Spotted {chainName(myPick)}!
      </button>

      <div className="flex gap-2">
        <button
          onClick={undo}
          disabled={myCount === 0}
          className="btn-ghost pressable h-10 flex-1 rounded-xl text-xs font-semibold disabled:opacity-40"
        >
          Undo last
        </button>
        <button
          onClick={() => setSwitching(true)}
          className="btn-ghost pressable h-10 flex-1 rounded-xl text-xs font-semibold"
        >
          Switch chain
        </button>
      </div>
    </div>
  );
}

function PlayerCard({
  player,
  chain,
  count,
  you,
}: {
  player: Profile | null;
  chain?: string;
  count: number;
  you?: boolean;
}) {
  return (
    <section className="card p-4 text-center">
      <p className="eyebrow">{you ? "you" : (displayName(player) ?? "co-pilot")}</p>
      <p className="tnum mt-1.5 text-[34px] font-bold leading-none" style={{ color: player?.color }}>
        {count}
      </p>
      <p className="mt-1.5 truncate text-xs font-medium text-fg-muted">
        {chain ?? "hasn't picked yet"}
      </p>
    </section>
  );
}
