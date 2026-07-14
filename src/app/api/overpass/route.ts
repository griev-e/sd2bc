import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for Overpass. The public Overpass instances reject
 * requests without a descriptive User-Agent (browsers can't set one), so
 * suggestions are fetched here with proper identification and a mirror
 * fallback, then returned to the client.
 */
export const maxDuration = 60;

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const USER_AGENT = "coastline-trip-planner/1.0 (two-person road trip PWA; https://sd2bc.vercel.app)";

export async function POST(req: NextRequest) {
  let query: unknown;
  try {
    ({ query } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof query !== "string" || query.length > 20000) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  let lastStatus = 0;
  const deadline = Date.now() + 50000;
  outer: for (let round = 0; round < 2; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, 1500));
    for (const endpoint of ENDPOINTS) {
      const budget = deadline - Date.now();
      if (budget < 3000) break outer;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(Math.min(25000, budget)),
        });
        if (res.ok) {
          const json = await res.json();
          return NextResponse.json(json);
        }
        lastStatus = res.status;
        // 400 = malformed query; no mirror or retry will accept it either
        if (res.status === 400) break outer;
      } catch {
        // network/timeout — try the next mirror
      }
    }
  }
  return NextResponse.json(
    { error: `overpass unavailable (${lastStatus || "network"})` },
    { status: 502 },
  );
}
