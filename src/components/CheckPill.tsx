"use client";

import { motion } from "motion/react";

/**
 * The app's checkbox: a real <input> underneath (labels, forms, screen
 * readers all keep working) with the check mark drawn as an SVG stroke so it
 * sweeps in instead of popping, plus a small squeeze of the box on check.
 * Box chrome (border, gradient fill) stays in globals.css (`.check-pill`).
 */
export default function CheckPill({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <motion.span
      initial={false}
      animate={checked ? { scale: [1, 0.88, 1] } : { scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="relative inline-flex flex-shrink-0"
    >
      <input
        type="checkbox"
        className="check-pill"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute inset-0 h-full w-full"
        fill="none"
        aria-hidden
      >
        <motion.path
          d="M7 12.5l3.5 3.5L17 9"
          stroke="var(--accent-contrast)"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={
            checked
              ? {
                  // let the gradient fill land first, then draw the check
                  pathLength: { duration: 0.18, ease: "easeOut", delay: 0.06 },
                  opacity: { duration: 0.01, delay: 0.06 },
                }
              : { duration: 0.12 }
          }
        />
      </svg>
    </motion.span>
  );
}
