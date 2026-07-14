"use client";

import { displayName } from "@/lib/format";
import { useTrip } from "@/lib/store";
import type { GameEvent, GameId, Profile } from "@/lib/types";

/** Events for one game, oldest first. */
export function useGameEvents(game: GameId): GameEvent[] {
  return useTrip((s) => s.gameEvents).filter((e) => e.game === game);
}

export function usePlayers(): { me: Profile | null; partner: Profile | null } {
  const profiles = useTrip((s) => s.profiles);
  const userId = useTrip((s) => s.userId);
  return {
    me: profiles.find((p) => p.id === userId) ?? null,
    partner: profiles.find((p) => p.id !== userId) ?? null,
  };
}

/** Head-to-head score strip: two names, two counts, their colors. */
export function ScoreStrip({
  me,
  partner,
  mine,
  theirs,
  unit,
}: {
  me: Profile | null;
  partner: Profile | null;
  mine: number;
  theirs: number;
  unit?: string;
}) {
  return (
    <div className="card flex items-center p-4">
      <div className="flex-1">
        <p className="tnum text-2xl font-bold leading-none" style={{ color: me?.color }}>
          {mine}
        </p>
        <p className="eyebrow mt-1">{displayName(me) ?? "you"}</p>
      </div>
      <div className="px-3 text-center">
        <p className="eyebrow">{unit ?? "vs"}</p>
      </div>
      <div className="flex-1 text-right">
        <p className="tnum text-2xl font-bold leading-none" style={{ color: partner?.color }}>
          {theirs}
        </p>
        <p className="eyebrow mt-1">{displayName(partner) ?? "them"}</p>
      </div>
    </div>
  );
}
