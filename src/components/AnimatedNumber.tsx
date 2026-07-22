"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect } from "react";
import { fmtMoney } from "@/lib/format";
import { SPRING_VALUE } from "@/lib/motion";

/**
 * Money that glides to its new value instead of snapping. The budget is a
 * live forecast — a ticking figure reads as "recomputing", a jump reads as a
 * glitch. The value flows through a MotionValue, so the per-frame digit churn
 * never re-renders React.
 */
export function AnimatedMoney({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, SPRING_VALUE);
  useEffect(() => {
    // MotionValue springs bypass MotionConfig, so honor reduced motion here
    if (reduced) spring.jump(value);
    else spring.set(value);
  }, [value, reduced, spring]);
  const text = useTransform(spring, (v) => fmtMoney(v));
  return <motion.span>{text}</motion.span>;
}

/**
 * Odometer-style readout for formatted strings ("1,842 mi", "31h 5m"): when
 * the value changes, only the characters that differ roll over — the old one
 * slides up and out, the new one in from below. Characters are keyed by
 * position, so unchanged digits hold still. Meant for `tnum`/`mono` text,
 * where digit widths are stable.
 */
export function RollingText({ value }: { value: string }) {
  return (
    <span className="inline-flex" aria-label={value}>
      {value.split("").map((ch, i) => (
        <span key={i} aria-hidden className="relative inline-block overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ch}
              initial={{ y: "0.85em", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-0.85em", opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="inline-block"
            >
              {/* real spaces would collapse inside the inline-flex row */}
              {ch === " " ? "\u00A0" : ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
