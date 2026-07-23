/**
 * Wordle domain logic — pure, so it unit-tests without a DOM. The UI in
 * `components/games/WordleGame` renders these results; the shared list of
 * answers lives in `gameData.ts` (WORDLE_WORDS).
 */

export const WORD_LENGTH = 5;
/** Five tries, as requested — a notch tighter than classic Wordle's six. */
export const MAX_GUESSES = 5;

/** Per-letter verdict, mirroring the original game's three tile colors. */
export type LetterState = "correct" | "present" | "absent";

export interface ScoredGuess {
  guess: string;
  states: LetterState[];
}

/**
 * Colour one guess against the answer with the *exact* Wordle rule for
 * repeated letters: greens are assigned first and consume their answer slot,
 * then each remaining tile is yellow only while unused copies of that letter
 * are still available — otherwise grey. Without the two passes a guess of
 * "SEALS" against "SANDY" would wrongly light both S's.
 *
 * Both inputs are upper-cased; lengths are assumed equal (WORD_LENGTH).
 */
export function scoreGuess(guess: string, answer: string): LetterState[] {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  const states: LetterState[] = new Array(g.length).fill("absent");

  // Remaining answer letters after greens are claimed — the yellow budget.
  const remaining: Record<string, number> = {};

  // Pass 1: exact-position hits.
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      states[i] = "correct";
    } else {
      remaining[a[i]] = (remaining[a[i]] ?? 0) + 1;
    }
  }

  // Pass 2: present-but-misplaced, only while the budget lasts (left to right).
  for (let i = 0; i < g.length; i++) {
    if (states[i] === "correct") continue;
    const ch = g[i];
    if ((remaining[ch] ?? 0) > 0) {
      states[i] = "present";
      remaining[ch] -= 1;
    }
  }

  return states;
}

/** True when every tile is green — the win condition. */
export function isWin(states: LetterState[]): boolean {
  return states.every((s) => s === "correct");
}

// Green beats yellow beats grey — a letter's keyboard hint only ever improves
// as more guesses land, never downgrades (a later grey can't un-green a key).
const RANK: Record<LetterState, number> = { correct: 3, present: 2, absent: 1 };

/**
 * Best-known state per letter across every guess so far — drives the on-screen
 * keyboard's colour hints.
 */
export function keyStates(scored: ScoredGuess[]): Record<string, LetterState> {
  const out: Record<string, LetterState> = {};
  for (const { guess, states } of scored) {
    for (let i = 0; i < guess.length; i++) {
      const ch = guess[i].toUpperCase();
      const next = states[i];
      if (!out[ch] || RANK[next] > RANK[out[ch]]) out[ch] = next;
    }
  }
  return out;
}

/**
 * Pick a random answer the crew hasn't solved yet. Solved words are excluded
 * so the shuffle never repeats a cleared word — until every word is cleared,
 * at which point the full bank is fair game again (so the game never dead-ends).
 * `rand` is injectable for deterministic tests.
 */
export function pickWord(
  words: string[],
  completed: Iterable<string> = [],
  rand: () => number = Math.random,
): string {
  const done = new Set<string>();
  for (const w of completed) done.add(w.toUpperCase());
  const pool = words.filter((w) => !done.has(w.toUpperCase()));
  const from = pool.length > 0 ? pool : words;
  return from[Math.floor(rand() * from.length)] ?? words[0];
}
