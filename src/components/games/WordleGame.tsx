"use client";

import { motion, useAnimationControls } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { riseIn, SPRING } from "@/lib/motion";
import { useTrip } from "@/lib/store";
import { WORDLE_WORDS } from "@/lib/gameData";
import {
  keyStates,
  MAX_GUESSES,
  pickWord,
  scoreGuess,
  WORD_LENGTH,
  type LetterState,
} from "@/lib/wordle";
import { useGameEvents } from "./shared";

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;

/** State → tile/key class; unguessed keys stay neutral. */
const STATE_CLASS: Record<LetterState, string> = {
  correct: "wl-correct",
  present: "wl-present",
  absent: "wl-absent",
};

/** Words the crew has already solved, read once from the store at game start. */
function solvedNow(): Set<string> {
  const done = new Set<string>();
  for (const e of useTrip.getState().gameEvents) {
    if (e.game === "wordle" && e.kind === "claim" && e.key) done.add(e.key.toUpperCase());
  }
  return done;
}

/**
 * Coastal Wordle — a five-letter word from our route, five tries, tiles
 * coloured the classic way (green = right spot, gold = right letter wrong
 * spot, grey = not in the word). Solving a word records a shared claim so it
 * drops out of the shuffle on both phones until every word is cleared.
 */
export default function WordleGame() {
  const events = useGameEvents("wordle");
  const addGameEvent = useTrip((s) => s.addGameEvent);

  // Solved-word set — shared across both phones via game_events claims.
  const solved = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) {
      if (e.kind === "claim" && e.key) s.add(e.key.toUpperCase());
    }
    return s;
  }, [events]);

  const [answer, setAnswer] = useState(() => pickWord(WORDLE_WORDS, solvedNow()));
  const [guesses, setGuesses] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [message, setMessage] = useState<string | null>(null);
  // guard so a won game records its claim exactly once
  const recorded = useRef(false);
  const shake = useAnimationControls();

  const scored = useMemo(
    () => guesses.map((g) => ({ guess: g, states: scoreGuess(g, answer) })),
    [guesses, answer],
  );
  const keys = useMemo(() => keyStates(scored), [scored]);

  // persist the solved word once — excludes it from every future shuffle.
  // Skip if it's already claimed (only reachable when replaying a fully-cleared
  // bank) so we never trip the unique index and flash a save error.
  useEffect(() => {
    if (status === "won" && !recorded.current) {
      recorded.current = true;
      if (!solved.has(answer.toUpperCase())) {
        void addGameEvent({
          game: "wordle",
          kind: "claim",
          key: answer,
          value: { guesses: guesses.length },
        });
      }
    }
  }, [status, answer, guesses.length, solved, addGameEvent]);

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage((m) => (m === text ? null : m)), 1400);
  }

  function press(letter: string) {
    if (status !== "playing") return;
    setCurrent((c) => (c.length < WORD_LENGTH ? c + letter : c));
  }
  function backspace() {
    if (status !== "playing") return;
    setCurrent((c) => c.slice(0, -1));
  }
  function submit() {
    if (status !== "playing") return;
    if (current.length !== WORD_LENGTH) {
      void shake.start({ x: [0, -8, 8, -6, 6, 0], transition: { duration: 0.4 } });
      flash(`${WORD_LENGTH} letters, please`);
      return;
    }
    const g = current.toUpperCase();
    const next = [...guesses, g];
    setGuesses(next);
    setCurrent("");
    if (g === answer) setStatus("won");
    else if (next.length >= MAX_GUESSES) setStatus("lost");
  }

  function newGame() {
    // read the freshest solved set (the partner may have cleared one since)
    setAnswer(pickWord(WORDLE_WORDS, solvedNow()));
    setGuesses([]);
    setCurrent("");
    setStatus("playing");
    setMessage(null);
    recorded.current = false;
  }

  // physical keyboard for desktop — the on-screen keys are the phone path.
  // handlers held in a ref so the listener attaches once yet always runs the
  // latest closure (fresh `current` / `guesses` / `answer`).
  const handlers = useRef({ press, backspace, submit });
  useEffect(() => {
    // refreshed every render so the once-attached listener runs latest closures
    handlers.current = { press, backspace, submit };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") handlers.current.submit();
      else if (e.key === "Backspace") handlers.current.backspace();
      else if (/^[a-zA-Z]$/.test(e.key)) handlers.current.press(e.key.toUpperCase());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = WORDLE_WORDS.length;
  const over = status !== "playing";

  return (
    <div className="space-y-3.5">
      {/* team progress — words the two of us have cleared */}
      <section className="card p-4">
        <div className="flex items-baseline justify-between">
          <p className="tnum text-2xl font-bold leading-none">
            {solved.size}
            <span className="text-sm font-semibold text-fg-faint"> / {total}</span>
          </p>
          <p className="eyebrow">coastal words cleared</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-fg/5">
          <motion.div
            initial={false}
            animate={{ scaleX: solved.size / total }}
            transition={SPRING}
            className="h-full w-full origin-left rounded-full"
            style={{ background: "var(--accent-gradient)" }}
          />
        </div>
      </section>

      {/* the board */}
      <section className="card px-4 py-5">
        <div className="mx-auto grid w-full max-w-[300px] gap-1.5">
          {Array.from({ length: MAX_GUESSES }, (_, r) => {
            const submitted = r < guesses.length;
            const isCurrentRow = r === guesses.length && !over;
            const letters = submitted ? guesses[r] : isCurrentRow ? current : "";
            const rowStates = submitted ? scored[r].states : null;
            const row = (
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: WORD_LENGTH }, (_, c) => {
                  const ch = letters[c] ?? "";
                  const st = rowStates?.[c];
                  const cls = st ? `revealed ${STATE_CLASS[st]}` : ch ? "filled" : "";
                  return (
                    <div
                      key={c}
                      className={`wordle-tile ${cls}`}
                      style={st ? { animationDelay: `${c * 0.13}s` } : undefined}
                    >
                      {ch}
                    </div>
                  );
                })}
              </div>
            );
            // only the active row shakes on an invalid submit
            return isCurrentRow ? (
              <motion.div key={r} animate={shake}>
                {row}
              </motion.div>
            ) : (
              <div key={r}>{row}</div>
            );
          })}
        </div>

        {/* status line under the board */}
        <div className="mt-3 flex h-6 items-center justify-center" aria-live="polite">
          {message && !over && (
            <span className="glass rounded-full px-3 py-1 text-[11px] font-semibold text-fg-muted">
              {message}
            </span>
          )}
          {status === "won" && (
            <motion.span {...riseIn()} className="text-xs font-semibold text-accent">
              {guesses.length === 1 ? "Hole in one! 🎯" : `Nailed it in ${guesses.length}.`}
            </motion.span>
          )}
          {status === "lost" && (
            <motion.span {...riseIn()} className="text-xs font-semibold text-fg-muted">
              The word was{" "}
              <span className="font-bold tracking-wide text-coral">{answer}</span>.
            </motion.span>
          )}
        </div>
      </section>

      {/* keyboard, or the play-again prompt once the round ends */}
      {over ? (
        <button
          onClick={newGame}
          className="btn-primary pressable h-14 w-full rounded-2xl text-base font-semibold"
        >
          {solved.size >= total ? "Replay — all cleared!" : "New word"}
        </button>
      ) : (
        <div className="space-y-1.5">
          {KEY_ROWS.map((r, ri) => (
            <div key={ri} className="flex justify-center gap-1.5">
              {ri === 2 && (
                <Key wide onClick={submit} aria-label="Enter">
                  <span className="text-[11px] font-bold">ENTER</span>
                </Key>
              )}
              {r.split("").map((ch) => (
                <Key key={ch} state={keys[ch]} onClick={() => press(ch)}>
                  {ch}
                </Key>
              ))}
              {ri === 2 && (
                <Key wide onClick={backspace} aria-label="Backspace">
                  <BackspaceIcon />
                </Key>
              )}
            </div>
          ))}
          {/* reshuffle without finishing — grab a different word */}
          <button
            onClick={newGame}
            className="mx-auto mt-1 block px-3 py-1 text-[11px] font-semibold text-fg-faint"
          >
            Skip this word
          </button>
        </div>
      )}
    </div>
  );
}

function Key({
  children,
  onClick,
  state,
  wide,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  state?: LetterState;
  wide?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      onClick={onClick}
      {...rest}
      className={`wordle-key pressable ${wide ? "wordle-key-wide" : ""} ${
        state ? STATE_CLASS[state] : ""
      }`}
    >
      {children}
    </button>
  );
}

function BackspaceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m12 10 4 4m0-4-4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
