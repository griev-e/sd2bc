"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/Sheet";
import { CA_PROVINCES, US_STATES } from "@/lib/gameData";
import { SPRING, SPRING_VALUE } from "@/lib/motion";
import {
  expectedDuels,
  filterRanking,
  fmtScore,
  insertNear,
  PLATE_RANKING_KEY,
  parseRanking,
  plateScores,
  sentimentSpec,
  SENTIMENTS,
  type PlateRanking,
  type PlateScore,
  type PlateSentiment,
} from "@/lib/plateRank";
import { useTrip } from "@/lib/store";

/* ── plate identity ─────────────────────────────────────────────────── */

export function plateInfo(code: string): { name: string; region: "USA" | "Canada" } {
  const us = US_STATES.find((s) => s.code === code);
  if (us) return { name: us.name, region: "USA" };
  const ca = CA_PROVINCES.find((s) => s.code === code);
  return { name: ca?.name ?? code, region: ca ? "Canada" : "USA" };
}

/** A little embossed license plate — the shared visual for rating and ranking. */
export function PlateFace({ code, size = "lg" }: { code: string; size?: "lg" | "md" }) {
  const { name, region } = plateInfo(code);
  const lg = size === "lg";
  return (
    <div
      className={`relative mx-auto w-full select-none rounded-2xl border border-hairline bg-bg-elevated ${
        lg ? "max-w-[230px]" : "max-w-[180px]"
      }`}
      style={{ aspectRatio: "2.1 / 1", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}
    >
      {/* stamped inner rim */}
      <div className="pointer-events-none absolute inset-[6px] rounded-[11px] border border-fg/10" />
      {/* mounting screws */}
      <span className="absolute left-[11px] top-[11px] h-1.5 w-1.5 rounded-full bg-fg/15" />
      <span className="absolute right-[11px] top-[11px] h-1.5 w-1.5 rounded-full bg-fg/15" />
      <div className="flex h-full flex-col items-center justify-center gap-0.5 px-4">
        <p
          className={`truncate font-semibold uppercase text-fg-muted ${
            lg ? "text-[10px] tracking-[0.22em]" : "text-[9px] tracking-[0.2em]"
          }`}
        >
          {name}
        </p>
        <p className={`mono font-bold tracking-[0.18em] ${lg ? "text-4xl" : "text-3xl"}`}>
          {code}
        </p>
        <p className="text-[8px] font-semibold uppercase tracking-[0.3em] text-fg-faint">
          {region}
        </p>
      </div>
    </div>
  );
}

/* ── the rater ──────────────────────────────────────────────────────── */

/**
 * Score that springs up from 0.0 to its value — the reveal moment. A
 * MotionValue drives the digits, so the per-frame churn never re-renders.
 */
function AnimatedScore({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const spring = useSpring(0, SPRING_VALUE);
  useEffect(() => {
    if (reduced) spring.jump(value);
    else spring.set(value);
  }, [value, reduced, spring]);
  const text = useTransform(spring, (v) => fmtScore(Math.min(v, value)));
  return <motion.span>{text}</motion.span>;
}

type Step = "sentiment" | "duel" | "reveal";

interface RaterState {
  step: Step;
  sentiment: PlateSentiment | null;
  /** My claim-filtered ranking *without* the plate being rated — the duel pool. */
  base: PlateRanking;
  /** Binary-search window [lo, hi) into the visible bucket. */
  lo: number;
  hi: number;
  duelNum: number;
  duelsTotal: number;
  result: PlateScore | null;
}

// Snapshot my ranking when a plate's rating starts, so an in-flight duel
// sequence never shifts under a Realtime update. Only I edit my document,
// so the snapshot can't go stale in a way that matters.
function freshState(forCode: string): RaterState {
  const s = useTrip.getState();
  const plates = s.gameEvents.filter((e) => e.game === "plates");
  const claimed = new Set(
    plates.filter((e) => e.kind === "claim" && e.key).map((e) => e.key as string),
  );
  const base = filterRanking(
    parseRanking(plates, s.userId),
    (c) => claimed.has(c) && c !== forCode,
  );
  return {
    step: "sentiment",
    sentiment: null,
    base,
    lo: 0,
    hi: 0,
    duelNum: 0,
    duelsTotal: 0,
    result: null,
  };
}

/**
 * The Beli-style rater: a bottom sheet that walks a queue of plates through
 * sentiment → head-to-head duels → score reveal. Nothing is written until a
 * plate's duels finish; closing mid-flow abandons only the current plate.
 * The parent remounts this (via `key`) for every rating session, so all
 * state initializes lazily off the first plate in the queue.
 */
export default function PlateRater({
  open,
  queue,
  onClose,
}: {
  open: boolean;
  /** Plate codes to rate, in order. */
  queue: string[];
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [r, setR] = useState<RaterState | null>(() =>
    queue.length > 0 ? freshState(queue[0]) : null,
  );
  const [picked, setPicked] = useState<"challenger" | "rival" | null>(null);
  const pickTimer = useRef<number | null>(null);
  const code = queue[idx] as string | undefined;

  useEffect(
    () => () => {
      if (pickTimer.current !== null) window.clearTimeout(pickTimer.current);
    },
    [],
  );

  /** Persist the finished placement and move to the reveal. */
  function commit(sent: PlateSentiment, index: number) {
    if (!code || !r) return;
    const s = useTrip.getState();
    const plates = s.gameEvents.filter((e) => e.game === "plates");
    const visible = r.base[sent];
    // Anchor on visible neighbors — the stored doc may hold released claims.
    const next = insertNear(
      parseRanking(plates, s.userId),
      sent,
      code,
      visible[index] ?? null,
      visible[index - 1] ?? null,
    );
    // Insert the fresh document first, then retire my older ones — a dropped
    // connection can at worst leave a duplicate (harmless: latest wins),
    // never lose the ranking. Both queue through the outbox offline.
    const prior = plates.filter(
      (e) => e.kind === "score" && e.key === PLATE_RANKING_KEY && e.created_by === s.userId,
    );
    void s.addGameEvent({
      game: "plates",
      kind: "score",
      key: PLATE_RANKING_KEY,
      value: next as unknown as Record<string, unknown>,
    });
    for (const p of prior) void s.deleteGameEvent(p.id);

    // Reveal the score as the rankings screen will show it: claimed only.
    const claimed = new Set(
      plates.filter((e) => e.kind === "claim" && e.key).map((e) => e.key as string),
    );
    claimed.add(code);
    const score = plateScores(filterRanking(next, (c) => claimed.has(c))).get(code)!;
    setR({ ...r, step: "reveal", sentiment: sent, result: score });
  }

  function pickSentiment(sent: PlateSentiment) {
    if (!r) return;
    const pool = r.base[sent];
    if (pool.length === 0) {
      commit(sent, 0);
      return;
    }
    setR({
      ...r,
      step: "duel",
      sentiment: sent,
      lo: 0,
      hi: pool.length,
      duelNum: 1,
      duelsTotal: expectedDuels(pool.length),
    });
  }

  /** One duel decided — acknowledge the tap, then narrow the window. */
  function choose(winner: "challenger" | "rival") {
    if (!r || r.sentiment === null || picked !== null) return;
    setPicked(winner);
    const { lo, hi, sentiment } = r;
    const mid = Math.floor((lo + hi) / 2);
    pickTimer.current = window.setTimeout(() => {
      setPicked(null);
      const [nlo, nhi] = winner === "challenger" ? [lo, mid] : [mid + 1, hi];
      if (nlo >= nhi) commit(sentiment, nlo);
      else setR((cur) => (cur ? { ...cur, lo: nlo, hi: nhi, duelNum: cur.duelNum + 1 } : cur));
    }, 260);
  }

  /** Dead heat — slot in right behind the rival (ties go to the incumbent). */
  function tie() {
    if (!r || r.sentiment === null || picked !== null) return;
    commit(r.sentiment, Math.floor((r.lo + r.hi) / 2) + 1);
  }

  function advance() {
    if (idx + 1 < queue.length) {
      setIdx(idx + 1);
      setR(freshState(queue[idx + 1]));
      setPicked(null);
    } else {
      onClose();
    }
  }

  const remaining = queue.length - idx - 1;
  const rival = r && r.sentiment && r.step === "duel" ? r.base[r.sentiment][Math.floor((r.lo + r.hi) / 2)] : null;
  const spec = r?.sentiment ? sentimentSpec(r.sentiment) : null;

  return (
    <Sheet open={open} onClose={onClose} title={code ? `Rate ${plateInfo(code).name}` : "Rate"}>
      {code && r && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${idx}-${r.step}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pt-2"
          >
            {r.step === "sentiment" && (
              <div className="space-y-4">
                <PlateFace code={code} />
                <p className="text-center text-sm font-semibold">How&rsquo;s this one?</p>
                <div className="space-y-2">
                  {SENTIMENTS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => pickSentiment(s.id)}
                      className="pressable flex w-full items-center gap-3.5 rounded-2xl border border-hairline p-3.5 text-left"
                    >
                      <span
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg"
                        style={{ background: s.soft }}
                      >
                        {s.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold" style={{ color: s.color }}>
                          {s.label}
                        </span>
                        <span className="block text-[11px] text-fg-faint">{s.blurb}</span>
                      </span>
                      <span className="tnum text-[10px] font-semibold text-fg-faint">
                        {s.lo.toFixed(0)}–{s.hi.toFixed(0)}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={advance}
                  className="mx-auto block py-1 text-xs font-semibold text-fg-faint"
                >
                  Skip for now
                </button>
              </div>
            )}

            {r.step === "duel" && rival && (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between px-1">
                  <p className="text-sm font-semibold">Which plate wins?</p>
                  <p className="eyebrow">
                    duel {r.duelNum} of ~{r.duelsTotal}
                  </p>
                </div>
                <DuelCard
                  code={code}
                  tag="challenger"
                  picked={picked === "challenger"}
                  dimmed={picked === "rival"}
                  onPick={() => choose("challenger")}
                />
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-hairline" />
                  <span className="eyebrow">vs</span>
                  <span className="h-px flex-1 bg-hairline" />
                </div>
                <DuelCard
                  code={rival}
                  tag="rival"
                  picked={picked === "rival"}
                  dimmed={picked === "challenger"}
                  onPick={() => choose("rival")}
                />
                <button
                  onClick={tie}
                  className="mx-auto block py-1.5 text-xs font-semibold text-fg-muted"
                >
                  Too close to call — tie
                </button>
              </div>
            )}

            {r.step === "reveal" && r.result && spec && (
              <div className="space-y-4 text-center">
                <PlateFace code={code} size="md" />
                <div>
                  <p
                    className="tnum text-6xl font-bold leading-none tracking-tight"
                    style={{ color: spec.color }}
                  >
                    <AnimatedScore value={r.result.score} />
                  </p>
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25, duration: 0.2, ease: "easeOut" }}
                    className="mt-3 flex items-center justify-center gap-2"
                  >
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{ background: spec.soft, color: spec.color }}
                    >
                      {spec.emoji} {spec.label}
                    </span>
                    <span className="tnum text-[11px] font-semibold text-fg-muted">
                      #{r.result.rank} of {r.result.total}
                    </span>
                  </motion.div>
                </div>
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35, ...SPRING }}
                  onClick={advance}
                  className="btn-primary pressable w-full rounded-2xl py-3.5 text-sm font-semibold"
                >
                  {remaining > 0 ? `Next plate · ${remaining} to go` : "Done"}
                </motion.button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </Sheet>
  );
}

function DuelCard({
  code,
  tag,
  picked,
  dimmed,
  onPick,
}: {
  code: string;
  tag: "challenger" | "rival";
  picked: boolean;
  dimmed: boolean;
  onPick: () => void;
}) {
  return (
    <motion.button
      onClick={onPick}
      animate={{ scale: picked ? 1.03 : 1, opacity: dimmed ? 0.45 : 1 }}
      transition={SPRING}
      className="pressable relative w-full rounded-2xl border p-3"
      style={{
        borderColor: picked ? "var(--accent)" : "var(--hairline)",
        boxShadow: picked ? "0 0 0 3px var(--ring)" : undefined,
      }}
    >
      {tag === "challenger" && (
        <span className="absolute left-3 top-3 rounded-full bg-accent-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-accent">
          New
        </span>
      )}
      <PlateFace code={code} size="md" />
    </motion.button>
  );
}
