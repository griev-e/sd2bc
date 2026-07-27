import type { GameEvent } from "./types";

/*
  Beli-style plate ranking. Each traveler keeps a personal *ordered* list of
  spotted plates — no absolute numbers are ever entered. Rating a plate is:

    1. pick a sentiment bucket (loved / fine / nope), then
    2. a short run of head-to-head duels against plates already in that
       bucket (binary search), which pins down the insertion point.

  The 0–10 score is *derived from position*: each bucket owns a fixed score
  band and its members split the band evenly by rank. That means scores are
  relative and self-healing — inserting a new favorite gently shifts
  everything below it, exactly like Beli. Nothing stores a score; the order
  is the truth.

  Persistence: the whole ranking is one JSON document — the latest
  `game_events` row with kind "score" and key `ranking:<ownerId>`. The
  owner lives in the *key*, not `created_by`, because either traveler can
  enter the other's take (the passenger taps while the driver dictates).
  Re-ranks append a fresh document and delete the owner's older ones (the
  writer owns cleanup), so last-write-wins per owner. Rows written before
  proxy rating existed used the bare key "ranking" with the owner implied
  by `created_by`; parseRanking still reads those, chronological last wins
  across both forms. The claim unique index only covers kind "claim", so
  any number of ranking rows can coexist.

  Documents deliberately keep codes whose claim was released — the claim
  filter happens at read time (`filterRanking`), so an accidental
  un-claim + re-claim doesn't forget how you felt about Wyoming.
*/

export const PLATE_RANKING_KEY = "ranking";

/** Event key for one person's ranking document (owner in the key). */
export function rankingKeyFor(userId: string): string {
  return `${PLATE_RANKING_KEY}:${userId}`;
}

/** Does this event carry `userId`'s ranking document (either key form)? */
export function isRankingDocFor(e: GameEvent, userId: string): boolean {
  return (
    e.game === "plates" &&
    e.kind === "score" &&
    (e.key === rankingKeyFor(userId) ||
      (e.key === PLATE_RANKING_KEY && e.created_by === userId))
  );
}

export type PlateSentiment = "loved" | "fine" | "nope";

/** Per-person ordered buckets, best first within each. */
export interface PlateRanking {
  loved: string[];
  fine: string[];
  nope: string[];
}

export interface SentimentSpec {
  id: PlateSentiment;
  label: string;
  blurb: string;
  emoji: string;
  /** Score band this bucket owns (members split it evenly by rank). */
  lo: number;
  hi: number;
  /** Design-token colors — resolved by the theme, never raw hex. */
  color: string;
  soft: string;
}

/** Ordered best → worst; iteration order doubles as overall rank order. */
export const SENTIMENTS: SentimentSpec[] = [
  {
    id: "loved",
    label: "Loved it",
    blurb: "Instant classic",
    emoji: "🤩",
    lo: 7,
    hi: 10,
    color: "var(--green)",
    soft: "var(--green-soft)",
  },
  {
    id: "fine",
    label: "It was fine",
    blurb: "Solid, not special",
    emoji: "😐",
    lo: 4,
    hi: 7,
    color: "var(--gold)",
    soft: "var(--gold-soft)",
  },
  {
    id: "nope",
    label: "Not for me",
    blurb: "Forgettable",
    emoji: "🫤",
    lo: 1,
    hi: 4,
    color: "var(--coral)",
    soft: "var(--coral-soft)",
  },
];

export function sentimentSpec(id: PlateSentiment): SentimentSpec {
  return SENTIMENTS.find((s) => s.id === id)!;
}

export const EMPTY_RANKING: PlateRanking = { loved: [], fine: [], nope: [] };

/** Score + standing for one plate, derived from its position. */
export interface PlateScore {
  code: string;
  /** 0–10, one decimal — like Beli, the top plate approaches 10 but never quite gets there. */
  score: number;
  sentiment: PlateSentiment;
  /** 1-based rank across all buckets (loved outranks fine outranks nope). */
  rank: number;
  total: number;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function fmtScore(score: number): string {
  return score.toFixed(1);
}

/**
 * Sanitize an untrusted ranking document (jsonb from the other phone, or a
 * hand of an older client). Non-arrays become empty, non-strings drop, and a
 * code appearing twice keeps only its best placement.
 */
export function normalizeRanking(doc: unknown): PlateRanking {
  const raw = (doc ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const bucket = (key: PlateSentiment): string[] => {
    const list = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [];
    const out: string[] = [];
    for (const item of list) {
      if (typeof item !== "string" || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  };
  // bucket order matters: dedupe favors loved over fine over nope
  return { loved: bucket("loved"), fine: bucket("fine"), nope: bucket("nope") };
}

/**
 * One person's current ranking from the shared event stream. Events arrive
 * oldest-first, so the last matching document wins (last-write-wins, same
 * policy as everything else) — regardless of who wrote it or key form.
 */
export function parseRanking(events: GameEvent[], userId: string | null): PlateRanking {
  if (!userId) return EMPTY_RANKING;
  let doc: unknown = null;
  for (const e of events) {
    if (isRankingDocFor(e, userId)) doc = e.value;
  }
  return doc === null ? EMPTY_RANKING : normalizeRanking(doc);
}

/** Every code present anywhere in the document. */
export function rankedCodes(r: PlateRanking): Set<string> {
  return new Set([...r.loved, ...r.fine, ...r.nope]);
}

/** Drop codes that fail the predicate (e.g. claim was released). Order kept. */
export function filterRanking(r: PlateRanking, keep: (code: string) => boolean): PlateRanking {
  return {
    loved: r.loved.filter(keep),
    fine: r.fine.filter(keep),
    nope: r.nope.filter(keep),
  };
}

export function removeCode(r: PlateRanking, code: string): PlateRanking {
  return filterRanking(r, (c) => c !== code);
}

/**
 * Place a code at `index` within a bucket (clamped). The code is removed from
 * every bucket first, so re-rating is just another insert.
 */
export function insertCode(
  r: PlateRanking,
  sentiment: PlateSentiment,
  code: string,
  index: number,
): PlateRanking {
  const base = removeCode(r, code);
  const list = [...base[sentiment]];
  list.splice(Math.max(0, Math.min(index, list.length)), 0, code);
  return { ...base, [sentiment]: list };
}

/**
 * Place a code next to known neighbors. The duel flow computes an insertion
 * *index* against the claim-filtered view of a bucket, but the stored
 * document may hold extra codes whose claims were released — so the commit
 * anchors on the visible neighbors instead: right before `beforeCode` when
 * it still exists, else right after `afterCode`, else at the bucket's end
 * (only reachable when the visible bucket was empty). Re-rating is safe: the
 * code is pulled from every bucket before being placed.
 */
export function insertNear(
  r: PlateRanking,
  sentiment: PlateSentiment,
  code: string,
  beforeCode: string | null,
  afterCode: string | null,
): PlateRanking {
  const base = removeCode(r, code);
  const list = [...base[sentiment]];
  let at = list.length;
  if (beforeCode !== null && list.includes(beforeCode)) at = list.indexOf(beforeCode);
  else if (afterCode !== null && list.includes(afterCode)) at = list.indexOf(afterCode) + 1;
  list.splice(at, 0, code);
  return { ...base, [sentiment]: list };
}

/**
 * Positional scores for a whole ranking. Within a bucket of n plates the
 * member at position i (0 = best) sits at the midpoint of its 1/n slice of
 * the bucket's band: hi − (i + 0.5)·(hi − lo)/n. A lone "loved" plate lands
 * at 8.5 — dead-center of 7–10 — and climbs toward 10 as it beats rivals.
 */
export function plateScores(r: PlateRanking): Map<string, PlateScore> {
  const out = new Map<string, PlateScore>();
  const total = r.loved.length + r.fine.length + r.nope.length;
  let rank = 1;
  for (const s of SENTIMENTS) {
    const list = r[s.id];
    for (let i = 0; i < list.length; i++) {
      out.set(list[i], {
        code: list[i],
        score: round1(s.hi - ((i + 0.5) * (s.hi - s.lo)) / list.length),
        sentiment: s.id,
        rank: rank++,
        total,
      });
    }
  }
  return out;
}

/**
 * How many duels a binary insert into a bucket of n takes, worst case —
 * shown as "duel 1 of ~3" so the flow feels finite at 70 mph.
 */
export function expectedDuels(n: number): number {
  return n === 0 ? 0 : Math.ceil(Math.log2(n + 1));
}

/** One row of the shared leaderboard: a plate plus each traveler's take. */
export interface BoardRow {
  code: string;
  /** Aligned with the rankings array passed in; null = not rated by them. */
  scores: (PlateScore | null)[];
  /** Mean of the scores that exist; null when nobody has rated it. */
  avg: number | null;
}

/**
 * The combined board: every claimed plate, each person's positional score,
 * sorted by average (both-rated ties break toward the plate more people
 * scored, then by code for determinism). Unrated plates trail alphabetically.
 */
export function combinedBoard(codes: string[], rankings: PlateRanking[]): BoardRow[] {
  const maps = rankings.map(plateScores);
  const rows: BoardRow[] = codes.map((code) => {
    const scores = maps.map((m) => m.get(code) ?? null);
    const present = scores.filter((s): s is PlateScore => s !== null);
    const avg =
      present.length === 0
        ? null
        : round1(present.reduce((sum, s) => sum + s.score, 0) / present.length);
    return { code, scores, avg };
  });
  return rows.sort((a, b) => {
    if (a.avg === null && b.avg === null) return a.code < b.code ? -1 : 1;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    if (b.avg !== a.avg) return b.avg - a.avg;
    const aCount = a.scores.filter(Boolean).length;
    const bCount = b.scores.filter(Boolean).length;
    if (bCount !== aCount) return bCount - aCount;
    return a.code < b.code ? -1 : 1;
  });
}
