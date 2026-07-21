import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const createMessage = vi.fn();

// The route type-checks errors with `instanceof Anthropic.XxxError`, so the
// mock must expose real classes as statics on the default export.
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class APIConnectionError extends APIError {}
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => createMessage(...args) };
  }
  Object.assign(MockAnthropic, {
    APIError,
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
  });
  return { default: MockAnthropic };
});

const verifyTraveler = vi.fn();
vi.mock("@/lib/server/auth", () => ({
  verifyTraveler: (...args: unknown[]) => verifyTraveler(...args),
}));

import Anthropic from "@anthropic-ai/sdk";
import { POST } from "./route";

const MockedErrors = Anthropic as unknown as {
  RateLimitError: new (msg?: string) => Error;
  APIConnectionError: new (msg?: string) => Error;
};

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** A minimal successful model response wrapping the given output object. */
function modelResponse(output: unknown) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(output) }],
  };
}

describe("POST /api/analyze", () => {
  beforeEach(() => {
    createMessage.mockReset();
    verifyTraveler.mockReset();
    verifyTraveler.mockResolvedValue({ userId: "user-1" });
    process.env.ANTHROPIC_API_KEY = "key-123";
  });

  it("rejects requests that aren't from a signed-in traveler", async () => {
    verifyTraveler.mockResolvedValue({ error: "Sign in to use this.", status: 401 });
    const res = await POST(makeReq({ days: [] }));
    expect(res.status).toBe(401);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("returns 503 when the API key isn't configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(makeReq({ days: [] }));
    expect(res.status).toBe(503);
  });

  it("returns 400 for a payload without a days array", async () => {
    expect((await POST(makeReq(null))).status).toBe(400);
    expect((await POST(makeReq({ nope: true }))).status).toBe(400);
    expect((await POST(makeReq({ days: "x" }))).status).toBe(400);
  });

  it("returns 400 for an oversized payload", async () => {
    const res = await POST(makeReq({ days: ["x".repeat(200_001)] }));
    expect(res.status).toBe(400);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("returns 502 on a refusal or truncation", async () => {
    createMessage.mockResolvedValue({ stop_reason: "refusal", content: [] });
    expect((await POST(makeReq({ days: [] }))).status).toBe(502);
    createMessage.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
    expect((await POST(makeReq({ days: [] }))).status).toBe(502);
  });

  it("returns 502 when the output isn't parseable insights", async () => {
    createMessage.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "not json" }],
    });
    expect((await POST(makeReq({ days: [] }))).status).toBe(502);
    createMessage.mockResolvedValue(modelResponse({ insights: "wrong shape" }));
    expect((await POST(makeReq({ days: [] }))).status).toBe(502);
  });

  it("normalizes valid insights: stable ids, clamped severity, order kept", async () => {
    createMessage.mockResolvedValue(
      modelResponse({
        insights: [
          {
            category: "route",
            severity: "warn",
            title: "Reorder day 2",
            detail: "Backtracks badly.",
            day_seq: 2,
            suggested_order: ["B", "A", "C"],
          },
          {
            category: "weather",
            severity: "silly", // → clamped to info
            title: "Rain on the beach day",
            detail: "80% showers.",
            day_seq: 3,
            suggested_order: null,
          },
          { category: "bogus", severity: "warn", title: "x", detail: "y", day_seq: null },
        ],
      }),
    );
    const res = await POST(makeReq({ days: [] }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.insights).toHaveLength(2); // the bogus category is dropped
    expect(json.insights[0]).toMatchObject({
      id: "i-0",
      category: "route",
      severity: "warn",
      suggested_order: ["B", "A", "C"],
    });
    expect(json.insights[1]).toMatchObject({
      id: "i-1",
      category: "weather",
      severity: "info",
      suggested_order: null,
    });
  });

  it("maps a rate-limited SDK error to 429", async () => {
    createMessage.mockRejectedValue(new MockedErrors.RateLimitError("slow down"));
    const res = await POST(makeReq({ days: [] }));
    expect(res.status).toBe(429);
  });

  it("maps a connection failure to 502", async () => {
    createMessage.mockRejectedValue(new MockedErrors.APIConnectionError("offline"));
    const res = await POST(makeReq({ days: [] }));
    expect(res.status).toBe(502);
  });
});
