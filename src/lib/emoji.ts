import { hashKey } from "./geo";

/** Curated single-glyph nature emojis for day badges. */
export const NATURE_EMOJI = [
  "🌲",
  "🏔️",
  "🌊",
  "🏕️",
  "🌅",
  "🌉",
  "🦌",
  "🐻",
  "🌾",
  "🌵",
  "🍃",
  "🦅",
  "🐟",
  "⛰️",
  "🏞️",
  "🌴",
  "🌻",
  "🍁",
  "🦉",
  "🌙",
  "☀️",
  "🐚",
  "🦋",
  "🌿",
];

/** Deterministic "random" nature emoji for a day when none is customized. */
export function defaultDayEmoji(dayId: string): string {
  const n = parseInt(hashKey(dayId).slice(0, 8), 16);
  return NATURE_EMOJI[n % NATURE_EMOJI.length];
}

/** Emoji to show on a day badge: the custom one, else a stable default. */
export function dayEmoji(dayId: string, custom: string | null): string {
  return custom && custom.trim() ? custom.trim() : defaultDayEmoji(dayId);
}
