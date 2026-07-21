import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { verifyTraveler } from "@/lib/server/auth";
import type { AnalysisInsight, InsightCategory } from "@/lib/types";

/**
 * AI trip analyzer. The client sends the compact trip snapshot built by
 * buildAnalysisPayload() and gets back structured insights; the client then
 * writes them to the trip_analyses cache table (keyed by a hash of the trip
 * state) so the second phone and every re-open read the cache instead of
 * calling here again — this route never runs unprompted.
 *
 * Required Vercel env var:
 *   ANTHROPIC_API_KEY — server-only; never NEXT_PUBLIC_, never in the bundle.
 */

export const maxDuration = 60;

const MODEL = "claude-sonnet-5";

/** Strict shape the model must return — enforced via structured outputs. */
const INSIGHTS_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["pacing", "budget", "route", "weather"] },
          severity: { type: "string", enum: ["info", "warn"] },
          title: { type: "string" },
          detail: { type: "string" },
          day_seq: { type: ["integer", "null"] },
          suggested_order: { type: ["array", "null"], items: { type: "string" } },
        },
        required: ["category", "severity", "title", "detail", "day_seq", "suggested_order"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the trip analyst for Coastline, a two-person road-trip planner for a San Diego → Vancouver → San Diego summer loop. You receive one JSON snapshot of the whole plan: trip settings, the live budget forecast, and each day's stops, drive distance/time, estimated arrivals, and stop-to-stop legs.

Return concrete, actionable findings a couple planning on their phones can act on. Look specifically for:
- pacing: days that are over-packed (too many stops for the hours available) or too drive-heavy (roughly 6+ hours behind the wheel), and days that are nearly empty next to overloaded neighbors
- route: stop orderings within a day that backtrack or interleave badly (suggest the better order by name), and long legs (roughly 2.5+ hours) with no food or fuel stop between them
- budget: nights whose estimated or entered cost stands out against the rest of the forecast, and any day sitting far above the trip's per-day average
- pacing: days that end without an overnight stop marked — the budget can't count that night and the day has no anchor
- weather: days whose forecast (the day's "weather" field, when present) clashes with the plan — rain or storms on a beach/scenic-heavy day, extreme heat on a long outdoor day. Only use the forecast given; days without one get no weather findings.

Rules: cite day numbers and stop names from the snapshot only — never invent places. Each finding stands alone with a short imperative title and one or two sentences of detail that mention the relevant numbers (miles, hours, dollars, degrees). Set day_seq to the day a finding points at, or null for trip-wide findings. When (and only when) a route finding recommends reordering one day's stops, set suggested_order to that day's complete stop list — every stop name exactly as given, each exactly once — in the recommended order; otherwise set it to null. Use severity "warn" only when the finding likely breaks the day (unworkable driving, missing overnight, big budget surprise). Return at most 8 findings, best first. If the plan genuinely looks solid in an area, say nothing about it — an empty list is a valid answer.`;

/** Runtime guard for the model's output — structured outputs should make
 *  this always pass, but a refusal or truncation must not crash the route. */
function normalizeInsights(raw: unknown): AnalysisInsight[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { insights?: unknown }).insights;
  if (!Array.isArray(list)) return null;
  const cats: InsightCategory[] = ["pacing", "budget", "route", "weather"];
  const out: AnalysisInsight[] = [];
  for (const item of list.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    if (!cats.includes(i.category as InsightCategory)) continue;
    if (typeof i.title !== "string" || typeof i.detail !== "string") continue;
    // a usable reorder is a modest list of plain strings — anything else → null
    const order =
      Array.isArray(i.suggested_order) &&
      i.suggested_order.length > 0 &&
      i.suggested_order.length <= 20 &&
      i.suggested_order.every((n) => typeof n === "string" && n.length <= 120)
        ? (i.suggested_order as string[])
        : null;
    out.push({
      id: `i-${out.length}`,
      category: i.category as InsightCategory,
      severity: i.severity === "warn" ? "warn" : "info",
      title: i.title.slice(0, 120),
      detail: i.detail.slice(0, 500),
      day_seq: typeof i.day_seq === "number" ? i.day_seq : null,
      suggested_order: order,
    });
  }
  return out;
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
      { error: "The analyzer isn't configured yet — set ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  // loose shape + size guard — the model prompt is the real consumer
  const body = JSON.stringify(payload);
  if (
    !payload ||
    typeof payload !== "object" ||
    !("days" in payload) ||
    !Array.isArray((payload as { days: unknown }).days) ||
    body.length > 200_000
  ) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        format: {
          type: "json_schema",
          schema: INSIGHTS_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: `Analyze this trip plan and respond in strict JSON only:\n${body}`,
        },
      ],
    });

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return NextResponse.json(
        { error: "The analysis came back incomplete — try again." },
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
    const insights = normalizeInsights(parsed);
    if (!insights) {
      return NextResponse.json(
        { error: "The analysis came back malformed — try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ model: MODEL, insights });
  } catch (err) {
    // typed SDK errors, most specific first — retryable vs. not matters to the UI
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "The analyzer is rate-limited right now — try again in a minute." },
        { status: 429 },
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The analyzer's API key was rejected — check ANTHROPIC_API_KEY." },
        { status: 503 },
      );
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return NextResponse.json(
        { error: "Couldn't reach the analysis service — try again." },
        { status: 502 },
      );
    }
    if (err instanceof Anthropic.APIError) {
      // 529 overloaded and other 5xx land here — all worth a retry later
      return NextResponse.json(
        { error: "The analysis service had a hiccup — try again shortly." },
        { status: 502 },
      );
    }
    throw err;
  }
}
