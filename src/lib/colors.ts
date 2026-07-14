/**
 * Marker color for day i of n — a restrained sweep from sea-glass teal into
 * deep indigo so the loop reads as a gradient of days, not a rainbow.
 */
export function dayColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  const hue = 174 + t * 88; // 174 (teal) → 262 (indigo)
  const sat = 62 - t * 10;
  const light = 40 + t * 12;
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}
