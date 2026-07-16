"use client";

import { MotionConfig } from "motion/react";

/**
 * App-wide Motion defaults. `reducedMotion="user"` disables transform and
 * layout animations for anyone with "reduce motion" set at the OS level
 * (opacity fades still run) — no per-component checks needed.
 */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
