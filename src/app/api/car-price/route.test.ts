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
  AuthenticationError: new (msg?: string) => Error;
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

const CAR = { year: 2019, make: "Toyota", model: "RAV4", trim: "LE" };

describe("POST /api/car-price", () => {
  beforeEach(() => {
    createMessage.mockReset();
    verifyTraveler.mockReset();
    verifyTraveler.mockResolvedValue({ userId: "user-1" });
    process.env.ANTHROPIC_API_KEY = "key-123";
  });

  it("rejects requests that aren't from a signed-in traveler", async () => {
    verifyTraveler.mockResolvedValue({ error: "Sign in to use this.", status: 401 });
    const res = await POST(makeReq(CAR));
    expect(res.status).toBe(401);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("returns 503 when the API key isn't configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await POST(makeReq(CAR))).status).toBe(503);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for a payload that isn't a car", async () => {
    expect((await POST(makeReq(null))).status).toBe(400);
    expect((await POST(makeReq({ make: "Toyota" }))).status).toBe(400); // no model
    expect((await POST(makeReq({ ...CAR, make: "" }))).status).toBe(400);
    expect((await POST(makeReq({ ...CAR, year: 1700 }))).status).toBe(400);
    expect((await POST(makeReq({ ...CAR, year: 2600 }))).status).toBe(400);
    expect((await POST(makeReq({ ...CAR, year: 2019.5 }))).status).toBe(400);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("returns the MSRP the model reports", async () => {
    createMessage.mockResolvedValue(
      modelResponse({
        msrp: 25_500,
        confidence: "high",
        resolved: "2019 Toyota RAV4 LE",
        note: "",
      }),
    );
    const res = await POST(makeReq(CAR));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      msrp: 25_500,
      confidence: "high",
      resolved: "2019 Toyota RAV4 LE",
    });
  });

  it("stays cheap: Haiku, a small token cap, and a strict schema", async () => {
    createMessage.mockResolvedValue(
      modelResponse({ msrp: 25_500, confidence: "high", resolved: "", note: "" }),
    );
    await POST(makeReq(CAR));
    const args = createMessage.mock.calls[0][0];
    expect(args.model).toContain("haiku");
    expect(args.max_tokens).toBeLessThanOrEqual(512);
    expect(args.output_config.format.type).toBe("json_schema");
  });

  it("returns 404 when the model doesn't recognize the car", async () => {
    createMessage.mockResolvedValue(
      modelResponse({ msrp: null, confidence: "low", resolved: "", note: "unknown" }),
    );
    expect((await POST(makeReq(CAR))).status).toBe(404);
  });

  it("treats an implausible price as 'don't know' rather than caching it", async () => {
    for (const msrp of [12, 900_000_000]) {
      createMessage.mockResolvedValue(
        modelResponse({ msrp, confidence: "high", resolved: "", note: "" }),
      );
      expect((await POST(makeReq(CAR))).status).toBe(404);
    }
  });

  it("downgrades an unrecognized confidence to low", async () => {
    createMessage.mockResolvedValue(
      modelResponse({ msrp: 25_500, confidence: "certain", resolved: "", note: "" }),
    );
    await expect((await POST(makeReq(CAR))).json()).resolves.toMatchObject({
      confidence: "low",
    });
  });

  it("returns 502 on a refusal, a truncation, or malformed output", async () => {
    createMessage.mockResolvedValue({ stop_reason: "refusal", content: [] });
    expect((await POST(makeReq(CAR))).status).toBe(502);

    createMessage.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
    expect((await POST(makeReq(CAR))).status).toBe(502);

    createMessage.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "not json" }],
    });
    expect((await POST(makeReq(CAR))).status).toBe(502);
  });

  it("maps typed SDK errors to the right status", async () => {
    createMessage.mockRejectedValue(new MockedErrors.RateLimitError("slow down"));
    expect((await POST(makeReq(CAR))).status).toBe(429);

    createMessage.mockRejectedValue(new MockedErrors.AuthenticationError("bad key"));
    expect((await POST(makeReq(CAR))).status).toBe(503);

    createMessage.mockRejectedValue(new MockedErrors.APIConnectionError("no route"));
    expect((await POST(makeReq(CAR))).status).toBe(502);
  });
});
