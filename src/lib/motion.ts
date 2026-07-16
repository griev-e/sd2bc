import type { Transition } from "motion/react";

/*
  Shared animation vocabulary — every Motion usage in the app draws from
  here so timing and easing feel like one system:

  - springs for movement and layout changes (snappy, never bouncy)
  - ease-out tweens for fades
  - a slight stagger for grouped content, capped so long lists don't crawl

  Micro feedback (button presses, color changes on hover/active) stays in
  CSS (`.pressable`, `transition-colors`) — it's cheaper and equally
  interruptible there. Structural motion — things entering, leaving, or
  changing place — goes through Motion.

  `prefers-reduced-motion` is honored globally by <MotionConfig
  reducedMotion="user"> in MotionProvider: transform/layout animations are
  skipped for those users while opacity fades remain.
*/

/** Movement & layout changes — quick, settles without overshoot. */
export const SPRING: Transition = { type: "spring", stiffness: 520, damping: 44 };

/** Bottom sheets — a touch softer so the surface feels weighty. */
export const SPRING_SHEET: Transition = { type: "spring", stiffness: 320, damping: 30 };

/** Fades — ease-out, in the 150–250ms band. */
export const FADE: Transition = { duration: 0.2, ease: "easeOut" };

/** Per-item stagger for grouped reveals (seconds). */
export const STAGGER_S = 0.035;

/**
 * Enter props for content revealing in place: a subtle fade + 8px rise.
 * Pass the item's index for a slight stagger — capped so item 20 doesn't
 * arrive noticeably later than item 1.
 */
export function riseIn(index = 0) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.25,
      ease: "easeOut",
      delay: Math.min(index, 6) * STAGGER_S,
    } satisfies Transition,
  };
}
