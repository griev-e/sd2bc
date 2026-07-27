"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import { IconCrown } from "@/components/Icons";
import { displayName } from "@/lib/format";
import { riseIn } from "@/lib/motion";
import {
  combinedBoard,
  filterRanking,
  fmtScore,
  parseRanking,
  sentimentSpec,
  type BoardRow,
  type PlateScore,
} from "@/lib/plateRank";
import type { Profile } from "@/lib/types";
import { PlateFace, plateInfo } from "./PlateRater";
import { useGameEvents, usePlayers } from "./shared";

/**
 * The shared plate leaderboard: every claimed plate ranked by the average of
 * our two personal Beli scores, with each traveler's own number alongside.
 * Scores are positional, so this list quietly reshuffles as duels happen on
 * either phone.
 */
export default function PlateRankings({ onRate }: { onRate: (codes: string[]) => void }) {
  const events = useGameEvents("plates");
  const { me, partner } = usePlayers();

  const claimedCodes = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) if (e.kind === "claim" && e.key) seen.add(e.key);
    return [...seen];
  }, [events]);

  const board = useMemo(() => {
    const claimed = new Set(claimedCodes);
    // row.scores aligns with [me, partner] everywhere below
    const rankings = [me?.id ?? null, partner?.id ?? null].map((id) =>
      filterRanking(parseRanking(events, id), (c) => claimed.has(c)),
    );
    return combinedBoard(claimedCodes, rankings);
  }, [events, me?.id, partner?.id, claimedCodes]);

  const rated = board.filter((row) => row.avg !== null);
  const unrated = board.filter((row) => row.avg === null);
  const favorite = rated[0];

  if (claimedCodes.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-fg-muted">
        No plates spotted yet — claim one and the duels begin.
      </p>
    );
  }

  return (
    <div className="space-y-3.5">
      {favorite && (
        <motion.section {...riseIn()} className="card p-4 text-center">
          <p className="eyebrow">current favorite</p>
          <div className="mt-3">
            <PlateFace code={favorite.code} size="md" />
          </div>
          <p className="tnum mt-3 text-4xl font-bold leading-none">{fmtScore(favorite.avg!)}</p>
          <div className="mt-2.5 flex items-center justify-center gap-2">
            <PersonScore profile={me} score={favorite.scores[0]} />
            <PersonScore profile={partner} score={favorite.scores[1]} />
          </div>
        </motion.section>
      )}

      {rated.length > 0 && (
        <section className="card p-4">
          <div className="mb-2 flex items-end justify-between px-1">
            <p className="eyebrow">the board</p>
            <div className="flex gap-1.5">
              <NameCap profile={me} />
              <NameCap profile={partner} />
            </div>
          </div>
          <div className="space-y-0.5">
            {rated.map((row, i) => (
              <BoardLine key={row.code} row={row} rank={i + 1} me={me} partner={partner} onRate={onRate} />
            ))}
          </div>
        </section>
      )}

      {rated.length === 0 && (
        <p className="py-4 text-center text-sm text-fg-muted">
          {claimedCodes.length} spotted, none scored yet — rate them to crown a favorite.
        </p>
      )}

      {unrated.length > 0 && (
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="eyebrow">not scored yet</p>
            <button
              onClick={() => onRate(unrated.map((r) => r.code))}
              className="text-[11px] font-semibold text-accent"
            >
              Rate all {unrated.length}
            </button>
          </div>
          <div className="space-y-0.5">
            {unrated.map((row) => (
              <BoardLine key={row.code} row={row} rank={null} me={me} partner={partner} onRate={onRate} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Fixed-width column caps so the two score columns read as columns. */
function NameCap({ profile }: { profile: Profile | null }) {
  return (
    <p
      className="w-12 truncate text-center text-[10px] font-semibold"
      style={{ color: profile?.color ?? "var(--fg-faint)" }}
    >
      {displayName(profile) ?? "—"}
    </p>
  );
}

function PersonScore({ profile, score }: { profile: Profile | null; score: PlateScore | null }) {
  return (
    <span
      className="tnum inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={
        score
          ? { background: profile?.color, color: "var(--on-strong)" }
          : { background: "var(--glass-border)", color: "var(--fg-faint)" }
      }
    >
      {displayName(profile) ?? "?"} · {score ? fmtScore(score.score) : "—"}
    </span>
  );
}

function BoardLine({
  row,
  rank,
  me,
  partner,
  onRate,
}: {
  row: BoardRow;
  /** null = the "not scored yet" section (no standing to show). */
  rank: number | null;
  me: Profile | null;
  partner: Profile | null;
  onRate: (codes: string[]) => void;
}) {
  const [mine, theirs] = row.scores;
  const { name } = plateInfo(row.code);
  return (
    <div
      className={`flex min-h-[52px] items-center gap-2.5 rounded-xl px-1.5 py-1.5 ${
        rank === 1 ? "bg-gold-soft" : ""
      }`}
    >
      {rank !== null &&
        (rank === 1 ? (
          <IconCrown size={15} className="w-5 flex-shrink-0 text-gold" />
        ) : (
          <span className="mono w-5 flex-shrink-0 text-center text-[11px] text-fg-faint">
            {rank}
          </span>
        ))}
      <span className="mono flex h-8 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-hairline text-xs font-bold tracking-widest">
        {row.code}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {row.avg !== null && (
          <p className="tnum text-[11px] text-fg-faint">
            avg {fmtScore(row.avg)}
            {mine ? ` · ${sentimentSpec(mine.sentiment).emoji}` : ""}
          </p>
        )}
      </div>
      <ScoreCell profile={me} score={mine} onRate={() => onRate([row.code])} />
      <ScoreCell profile={partner} score={theirs} />
    </div>
  );
}

/**
 * One person's number for one plate. My cell is tappable: rated re-opens the
 * rater to re-duel it, unrated starts fresh. The partner's cell is display
 * only — their score comes from their own phone.
 */
function ScoreCell({
  profile,
  score,
  onRate,
}: {
  profile: Profile | null;
  score: PlateScore | null;
  onRate?: () => void;
}) {
  if (score) {
    const pill = (
      <span
        className="tnum inline-flex w-12 items-center justify-center rounded-full py-1 text-xs font-bold"
        style={{ background: profile?.color, color: "var(--on-strong)" }}
      >
        {fmtScore(score.score)}
      </span>
    );
    return onRate ? (
      <button onClick={onRate} aria-label={`Re-rate ${score.code}`} className="pressable flex-shrink-0">
        {pill}
      </button>
    ) : (
      <span className="flex-shrink-0">{pill}</span>
    );
  }
  if (onRate) {
    return (
      <button
        onClick={onRate}
        className="pressable w-12 flex-shrink-0 rounded-full border border-accent py-1 text-center text-[11px] font-semibold text-accent"
      >
        Rate
      </button>
    );
  }
  return <span className="w-12 flex-shrink-0 text-center text-xs text-fg-faint">—</span>;
}
