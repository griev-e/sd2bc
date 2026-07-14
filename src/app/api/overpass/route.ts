import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for Overpass. The public instances reject requests
 * without a descriptive User-Agent (browsers can't set one), and any single
 * mirror can be arbitrarily slow — so requests are *hedged*: the first
 * mirror starts immediately and the others join staggered a few seconds
 * apart. First good answer wins, the rest are aborted.
 */
export const maxDuration = 60;

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const STAGGER_MS = 4000;
const PER_TRY_TIMEOUT_MS = 35000;

const USER_AGENT = "coastline-trip-planner/1.0 (two-person road trip PWA; https://sd2bc.vercel.app)";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

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

  const done = new AbortController();
  const attempt = async (endpoint: string, delayMs: number): Promise<unknown> => {
    if (delayMs > 0) await sleep(delayMs, done.signal);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: `data=${encodeURIComponent(query as string)}`,
      signal: AbortSignal.any([done.signal, AbortSignal.timeout(PER_TRY_TIMEOUT_MS)]),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    // Overpass answers an overloaded/timed-out query with HTTP 200, an empty
    // element list, and a `remark`. Treat that as a failure so Promise.any
    // falls through to a healthier mirror instead of "winning" with no data.
    if (
      data &&
      typeof data === "object" &&
      "remark" in data &&
      (!Array.isArray((data as { elements?: unknown[] }).elements) ||
        (data as { elements: unknown[] }).elements.length === 0)
    ) {
      throw new Error(`remark: ${(data as { remark: string }).remark}`);
    }
    return data;
  };

  try {
    const json = await Promise.any(
      ENDPOINTS.map((e, i) => attempt(e, i * STAGGER_MS)),
    );
    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ error: "overpass unavailable" }, { status: 502 });
  } finally {
    done.abort(); // cancel the mirrors that lost the race
  }
}
