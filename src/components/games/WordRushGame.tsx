"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconTimer } from "@/components/Icons";
import { WORD_CARDS } from "@/lib/gameData";
import { useTrip } from "@/lib/store";
import { ScoreStrip, useGameEvents, usePlayers } from "./shared";

const ROUND_SECONDS = 60;

/**
 * Word rush (taboo): describe the word without the forbidden ones while
 * your co-pilot guesses. 60 seconds, +1 per card, skips are free but the
 * clock isn't. Scores sync so the trip-long rivalry is on record.
 * (Driver describes only if the passenger holds the phone. Eyes on the road.)
 */
export default function WordRushGame() {
  const events = useGameEvents("words");
  const { me, partner } = usePlayers();
  const addGameEvent = useTrip((s) => s.addGameEvent);

  const best = (id: string | undefined) =>
    events
      .filter((e) => e.kind === "score" && e.created_by === id)
      .reduce((m, e) => Math.max(m, Number(e.value.score ?? 0)), 0);

  const [phase, setPhase] = useState<"idle" | "play" | "done">("idle");
  const [round, setRound] = useState(0);
  const [cardIdx, setCardIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const savedRef = useRef(false);

  // fresh shuffle per round
  const deck = useMemo(() => {
    const a = [...WORD_CARDS];
    let seed = round * 2654435761 + 97;
    for (let i = a.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }, [round]);

  useEffect(() => {
    if (phase !== "play") return;
    const endsAt = Date.now() + ROUND_SECONDS * 1000;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        clearInterval(t);
        setPhase("done");
      }
    }, 250);
    return () => clearInterval(t);
  }, [phase, round]);

  // persist the finished round exactly once
  useEffect(() => {
    if (phase === "done" && !savedRef.current) {
      savedRef.current = true;
      if (score > 0) void addGameEvent({ game: "words", kind: "score", value: { score } });
    }
  }, [phase, score, addGameEvent]);

  function start() {
    setRound((r) => r + 1);
    setCardIdx(0);
    setScore(0);
    setSecondsLeft(ROUND_SECONDS);
    savedRef.current = false;
    setPhase("play");
  }

  const card = deck[cardIdx % deck.length];

  return (
    <div className="space-y-3.5">
      <ScoreStrip me={me} partner={partner} mine={best(me?.id)} theirs={best(partner?.id)} unit="best round" />

      {phase === "play" ? (
        <>
          {/* clock */}
          <div className="card flex items-center gap-3 p-4">
            <IconTimer size={16} className="text-accent" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-fg/5">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${(secondsLeft / ROUND_SECONDS) * 100}%`,
                  background:
                    secondsLeft <= 10 ? "var(--danger)" : "var(--accent-gradient)",
                }}
              />
            </div>
            <span className="mono w-8 text-right text-sm font-bold">{secondsLeft}</span>
          </div>

          {/* the card */}
          <section className="card p-6 text-center">
            <p className="eyebrow">Describe, don&apos;t say</p>
            <p className="display mt-2 text-[30px] leading-tight">{card.word}</p>
            <div className="mx-auto mt-4 flex max-w-[260px] flex-wrap justify-center gap-1.5">
              {card.taboo.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-coral-soft px-2.5 py-1 text-[11px] font-semibold text-coral"
                >
                  {t}
                </span>
              ))}
            </div>
          </section>

          <div className="flex gap-2">
            <button
              onClick={() => setCardIdx((i) => i + 1)}
              className="btn-ghost pressable h-14 flex-1 rounded-xl text-sm font-semibold"
            >
              Skip
            </button>
            <button
              onClick={() => {
                setScore((v) => v + 1);
                setCardIdx((i) => i + 1);
              }}
              className="btn-primary pressable h-14 flex-[2] rounded-xl text-base font-semibold"
            >
              Got it · {score}
            </button>
          </div>
        </>
      ) : (
        <section className="card p-6 text-center">
          {phase === "done" ? (
            <>
              <p className="eyebrow">Time!</p>
              <p className="display tnum mt-1 text-[44px] leading-none">{score}</p>
              <p className="mt-2 text-xs text-fg-muted">
                {score > best(me?.id) - 1 && score > 0
                  ? "New personal best — it's on the record."
                  : "Logged. Rematch?"}
              </p>
            </>
          ) : (
            <>
              <p className="display text-[24px]">One minute. Go.</p>
              <p className="mx-auto mt-2 max-w-[280px] text-xs leading-5 text-fg-muted">
                Whoever holds the phone describes the word without saying the
                red ones — the other guesses. +1 per card, skips are free.
              </p>
            </>
          )}
          <button
            onClick={start}
            className="btn-primary pressable mt-5 h-12 w-full rounded-xl font-semibold"
          >
            {phase === "done" ? "Play again" : "Start round"}
          </button>
        </section>
      )}
    </div>
  );
}
