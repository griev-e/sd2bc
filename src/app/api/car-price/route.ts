import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { verifyTraveler } from "@/lib/server/auth";

/**
 * MSRP lookup for the "$$$ Cars" game — the fallback for cars the offline
 * catalog in `lib/carData.ts` can't price (a year it doesn't cover, an
 * unlisted make/model/trim).
 *
 * Deliberately the cheapest thing that works: Haiku, a ~120-token system
 * prompt, a tiny structured-output schema, and `max_tokens: 200`. The client
 * only calls it on a catalog miss, and every answer is written to the shared
 * `car_price_cache` table keyed by the normalized car — so the second phone
 * and every repeat sighting read a row instead of re-billing the model. One
 * roadside sighting costs a fraction of a cent, once, ever.
 *
 * Required Vercel env var:
 *   ANTHROPIC_API_KEY — server-only; never NEXT_PUBLIC_, never in the bundle.
 */

export const maxDuration = 30;

/** Haiku: the cheapest model that reliably knows car prices. */
const MODEL = "claude-haiku-4-5";

/** Strict shape the model must return — enforced via structured outputs. */
const PRICE_SCHEMA = {
  type: "object",
  properties: {
    // null when the model doesn't recognize the car — better than a guess,
    // because the number goes straight onto a shared leaderboard.
    msrp: { type: ["integer", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    /** What the model believes the car is, echoed back for the UI to show. */
    resolved: { type: "string" },
    note: { type: "string" },
  },
  required: ["msrp", "confidence", "resolved", "note"],
  additionalProperties: false,
} as const;

const SYSTEM = `You price cars for a road-trip spotting game. Given a year, make, model and optional trim, return that vehicle's original base MSRP in US dollars for that model year — the manufacturer's suggested retail price when new, excluding destination charges, options, and taxes. Never return a used-market or current resale value.

Rules: if no trim is given, price the model's cheapest (base) trim. If you don't recognize the vehicle, or the year/make/model combination didn't exist, set msrp to null rather than guessing. Set confidence to "high" for mainstream vehicles you know well, "medium" when you're extrapolating from adjacent years or trims, "low" when it's close to a guess. Put the exact vehicle you priced in "resolved" (e.g. "2019 Toyota RAV4 LE") and keep "note" to one short clause — an empty string is fine.`;

interface CarPriceAnswer {
  msrp: number | null;
  confidence: "high" | "medium" | "low";
  resolved: string;
  note: string;
}

/** Runtime guard for the model's output — structured outputs should make this
 *  always pass, but a refusal or truncation must not crash the route. */
function normalize(raw: unknown): CarPriceAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // A price outside this range is a hallucination or a units mix-up, not a
  // car — treat it the same as "don't know" rather than poisoning the cache.
  const msrp =
    typeof r.msrp === "number" && Number.isFinite(r.msrp) && r.msrp >= 1_000 && r.msrp <= 30_000_000
      ? Math.round(r.msrp)
      : null;

  const confidence =
    r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";

  return {
    msrp,
    confidence,
    resolved: typeof r.resolved === "string" ? r.resolved.slice(0, 120) : "",
    note: typeof r.note === "string" ? r.note.slice(0, 200) : "",
  };
}

export async function POST(req: NextRequest) {
  // Travelers only — this route spends real Anthropic tokens.
  const auth = await verifyTraveler(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Price lookup isn't configured yet — set ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const year = Number(body.year);
  const make = typeof body.make === "string" ? body.make.trim().slice(0, 60) : "";
  const model = typeof body.model === "string" ? body.model.trim().slice(0, 60) : "";
  const trim = typeof body.trim === "string" ? body.trim.trim().slice(0, 60) : "";

  // Bound the inputs before they reach the prompt: a car is a year, a make and
  // a model, and nothing here should be long enough to smuggle instructions.
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || !make || !model) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Timeout under maxDuration so a stalled call surfaces as the typed
  // APIConnectionTimeoutError → the 502 below, not a platform kill at 30s.
  // maxRetries: 0 — a retry after a timeout would blow past the budget anyway.
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
  try {
    const response = await client.messages.create({
      model: MODEL,
      // The answer is four short fields; anything more is a malformed reply.
      max_tokens: 200,
      system: SYSTEM,
      output_config: {
        format: {
          type: "json_schema",
          schema: PRICE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: JSON.stringify({ year, make, model, trim: trim || null }),
        },
      ],
    });

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return NextResponse.json(
        { error: "The price lookup came back incomplete — try again." },
        { status: 502 },
      );
    }

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // fall through to the normalize guard below
    }
    const answer = normalize(parsed);
    if (!answer) {
      return NextResponse.json(
        { error: "The price lookup came back malformed — try again." },
        { status: 502 },
      );
    }
    if (answer.msrp === null) {
      // A confident "I don't know" — 404 so the client can prompt for a manual
      // entry instead of caching a null and calling it a price.
      return NextResponse.json(
        { error: `Couldn't find an MSRP for that ${year} ${make} ${model}.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ model: MODEL, ...answer });
  } catch (err) {
    // typed SDK errors, most specific first — retryable vs. not matters to the UI
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Price lookup is rate-limited right now — try again in a minute." },
        { status: 429 },
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The price lookup's API key was rejected — check ANTHROPIC_API_KEY." },
        { status: 503 },
      );
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return NextResponse.json(
        { error: "Couldn't reach the price service — try again." },
        { status: 502 },
      );
    }
    if (err instanceof Anthropic.APIError) {
      // 529 overloaded and other 5xx land here — all worth a retry later
      return NextResponse.json(
        { error: "The price service had a hiccup — try again shortly." },
        { status: 502 },
      );
    }
    throw err;
  }
}
