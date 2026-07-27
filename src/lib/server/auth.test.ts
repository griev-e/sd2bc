import { beforeEach, describe, expect, it, vi } from "vitest";

// controllable results for the two Supabase calls verifyTraveler makes
let getUserResult: { data: { user: { id: string } | null }; error: unknown };
let profileResult: { data: { id: string } | null; error: unknown };

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: async () => getUserResult },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => profileResult,
        }),
      }),
    }),
  })),
}));

import { verifyTraveler } from "./auth";

function makeReq(auth?: string): Request {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === "authorization" ? (auth ?? null) : null),
    },
  } as unknown as Request;
}

describe("verifyTraveler", () => {
  beforeEach(() => {
    getUserResult = { data: { user: { id: "user-1" } }, error: null };
    profileResult = { data: { id: "user-1" }, error: null };
  });

  it("rejects a missing or malformed Authorization header with 401", async () => {
    expect(await verifyTraveler(makeReq())).toEqual({
      error: "Sign in to use this.",
      status: 401,
    });
    expect(await verifyTraveler(makeReq("Basic abc"))).toMatchObject({ status: 401 });
  });

  it("rejects an invalid token with 401", async () => {
    getUserResult = { data: { user: null }, error: { message: "invalid JWT" } };
    expect(await verifyTraveler(makeReq("Bearer bad"))).toMatchObject({ status: 401 });
  });

  it("accepts a traveler and returns their user id", async () => {
    expect(await verifyTraveler(makeReq("Bearer good"))).toEqual({ userId: "user-1" });
  });

  it("rejects a valid account with no traveler profile with 403", async () => {
    profileResult = { data: null, error: null };
    expect(await verifyTraveler(makeReq("Bearer good"))).toMatchObject({ status: 403 });
  });

  it("answers 503 (retry), not 403, when the profile lookup itself fails", async () => {
    // a Supabase blip must not tell a valid traveler their account is
    // excluded from the trip — that reads as permanent
    profileResult = { data: null, error: { message: "upstream connect error" } };
    expect(await verifyTraveler(makeReq("Bearer good"))).toEqual({
      error: "Couldn't verify your session — try again.",
      status: 503,
    });
  });
});
