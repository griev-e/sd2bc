export type LngLat = [number, number];

const R = 6371000; // meters

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Distance (meters) from point p to segment [a, b] using a local planar
 * approximation — plenty accurate at the scales we care about (< ~200 km).
 */
export function distToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  const cos = Math.cos((p[1] * Math.PI) / 180);
  const px = p[0] * cos;
  const py = p[1];
  const ax = a[0] * cos;
  const ay = a[1];
  const bx = b[0] * cos;
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const degDist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return (degDist * Math.PI * R) / 180;
}

/** Downsample a polyline so consecutive points are >= stepM apart. */
export function samplePolyline(line: LngLat[], stepM: number, maxPoints = 90): LngLat[] {
  if (line.length === 0) return [];
  const out: LngLat[] = [line[0]];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += haversineM(line[i - 1], line[i]);
    if (acc >= stepM) {
      out.push(line[i]);
      acc = 0;
    }
  }
  const last = line[line.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  if (out.length > maxPoints) {
    const stride = Math.ceil(out.length / maxPoints);
    return out.filter((_, i) => i % stride === 0 || i === out.length - 1);
  }
  return out;
}

export type Region = "CA" | "OR" | "WA" | "BC";

/** Rough west-coast region classifier by latitude — good enough for gas math. */
export function regionOf(lat: number): Region {
  if (lat >= 49.0) return "BC";
  if (lat >= 46.15) return "WA";
  if (lat >= 41.99) return "OR";
  return "CA";
}

export function bboxOf(coords: LngLat[]): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Stable short hash for cache keys. */
export function hashKey(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")
  );
}
