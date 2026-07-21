import type { ExpenseCategory, StopKind } from "./types";

/**
 * Marker color for day i of n — a sweep from sea-glass teal through deep
 * indigo into dusk magenta, so the loop reads as morning → evening light.
 */
export function dayColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  const hue = 174 + t * 136; // 174 (teal) → 310 (dusk magenta)
  const sat = 62 - t * 6;
  const light = 40 + t * 10;
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

/** Hue family per stop kind — icon foreground + soft tint background. */
export const KIND_COLOR: Record<StopKind, { fg: string; bg: string }> = {
  stop: { fg: "var(--accent)", bg: "var(--accent-soft)" },
  scenic: { fg: "var(--gold)", bg: "var(--gold-soft)" },
  food: { fg: "var(--coral)", bg: "var(--coral-soft)" },
  fuel: { fg: "var(--slate)", bg: "var(--slate-soft)" },
  activity: { fg: "var(--green)", bg: "var(--green-soft)" },
  beach: { fg: "var(--sky)", bg: "var(--sky-soft)" },
  lodging: { fg: "var(--indigo)", bg: "var(--indigo-soft)" },
};

/**
 * Sign-in button colors per traveler. Hardcoded hex on purpose: the login
 * screen renders before auth, so it can't read `profiles.color` — these
 * mirror the values stored there. Change both together.
 */
export const TRAVELER_BUTTON: Record<string, { bg: string; ink: string }> = {
  kevin: { bg: "#2dd4bf", ink: "#042f2a" },
  hailey: { bg: "#fda4af", ink: "#4c0519" },
};

export const EXPENSE_COLOR: Record<ExpenseCategory, { fg: string; bg: string }> = {
  gas: { fg: "var(--slate)", bg: "var(--slate-soft)" },
  lodging: { fg: "var(--indigo)", bg: "var(--indigo-soft)" },
  food: { fg: "var(--coral)", bg: "var(--coral-soft)" },
  activities: { fg: "var(--green)", bg: "var(--green-soft)" },
};
