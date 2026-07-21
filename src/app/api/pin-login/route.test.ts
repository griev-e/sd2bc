import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const generateLink = vi.fn();
// state for the pin_attempts rate-limit ledger the route consults
let recentFailures = 0;
const insertedAttempts: { success: boolean }[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { generateLink } },
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: async () => ({ count: recentFailures }),
        }),
      }),
      insert: async (row: { success: boolean }) => {
        insertedAttempts.push(row);
        return { error: null };
      },
      delete: () => ({
        lt: async () => ({ error: null }),
      }),
    }),
  })),
}));

import { pinMatches, POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeBadJsonReq(): NextRequest {
  return {
    json: async () => {
      throw new Error("invalid json");
    },
  } as unknown as NextRequest;
}

describe("pinMatches", () => {
  it("matches an identical PIN", () => {
    expect(pinMatches("1234", "1234")).toBe(true);
  });

  it("rejects a different PIN of the same length", () => {
    expect(pinMatches("1234", "4321")).toBe(false);
  });

  it("rejects a PIN of a different length", () => {
    expect(pinMatches("123", "1234")).toBe(false);
    expect(pinMatches("12345", "1234")).toBe(false);
  });

  it("rejects an empty guess against a real PIN", () => {
    expect(pinMatches("", "1234")).toBe(false);
  });
});

describe("POST /api/pin-login", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    generateLink.mockReset();
    recentFailures = 0;
    insertedAttempts.length = 0;
    process.env.PIN_CODE = "1234";
    process.env.SUPABASE_SECRET_KEY = "secret-key";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 400 for unparseable JSON", async () => {
    const res = await POST(makeBadJsonReq());
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown traveler", async () => {
    const res = await POST(makeReq({ user: "stranger", pin: "1234" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when fields are missing or the wrong type", async () => {
    expect((await POST(makeReq({ user: "kevin" }))).status).toBe(400);
    expect((await POST(makeReq({ user: "kevin", pin: 1234 }))).status).toBe(400);
  });

  it("returns 503 when PIN sign-in isn't configured", async () => {
    delete process.env.PIN_CODE;
    const res = await POST(makeReq({ user: "kevin", pin: "1234" }));
    expect(res.status).toBe(503);
  });

  it("returns 401 for a wrong PIN without ever calling Supabase admin", async () => {
    const promise = POST(makeReq({ user: "kevin", pin: "0000" }));
    await vi.advanceTimersByTimeAsync(600);
    const res = await promise;
    expect(res.status).toBe(401);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("records the attempt outcome in the pin_attempts ledger", async () => {
    const bad = POST(makeReq({ user: "kevin", pin: "0000" }));
    await vi.advanceTimersByTimeAsync(600);
    await bad;
    expect(insertedAttempts).toEqual([{ success: false }]);

    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok" } },
      error: null,
    });
    const good = POST(makeReq({ user: "kevin", pin: "1234" }));
    await vi.advanceTimersByTimeAsync(600);
    await good;
    expect(insertedAttempts).toEqual([{ success: false }, { success: true }]);
  });

  it("returns 429 once the hourly failure budget is spent — even for the right PIN", async () => {
    recentFailures = 10;
    const res = await POST(makeReq({ user: "kevin", pin: "1234" }));
    expect(res.status).toBe(429);
    expect(generateLink).not.toHaveBeenCalled();
    expect(insertedAttempts).toEqual([]); // refused before the compare
  });

  it("mints a magic link on a correct PIN", async () => {
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok_abc" } },
      error: null,
    });
    const promise = POST(makeReq({ user: "kevin", pin: "1234" }));
    await vi.advanceTimersByTimeAsync(600);
    const res = await promise;
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.token_hash).toBe("tok_abc");
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "magiclink", email: "kevinnguyen313@coastline.app" }),
    );
  });

  it("returns 502 when Supabase can't mint a link", async () => {
    generateLink.mockResolvedValue({ data: null, error: new Error("boom") });
    const promise = POST(makeReq({ user: "kevin", pin: "1234" }));
    await vi.advanceTimersByTimeAsync(600);
    const res = await promise;
    expect(res.status).toBe(502);
  });
});
