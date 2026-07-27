import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The geolocation store talks to three browser APIs, so each test builds a
 * fake `navigator` + `localStorage` and re-imports the module fresh (its watch
 * id lives at module scope). Nothing here touches a real GPS.
 */

type WatchArgs = {
  ok: PositionCallback;
  fail: PositionErrorCallback;
};

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function install({
  permission,
  hasPermissionsApi = true,
}: {
  permission?: PermissionState;
  hasPermissionsApi?: boolean;
} = {}) {
  const watches: WatchArgs[] = [];
  const cleared: number[] = [];
  const geolocation = {
    watchPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
      watches.push({ ok, fail });
      return watches.length; // ids start at 1
    },
    clearWatch: (id: number) => void cleared.push(id),
    getCurrentPosition: () => {},
  };
  const nav: Record<string, unknown> = { geolocation };
  if (hasPermissionsApi) {
    nav.permissions = {
      query: () => Promise.resolve({ state: permission ?? "prompt", onchange: null }),
    };
  }
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: makeStorage(),
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: globalThis.localStorage },
    configurable: true,
  });
  return { watches, cleared };
}

async function freshStore() {
  vi.resetModules();
  return await import("./location");
}

const position = (lng: number, lat: number, accuracy = 20) =>
  ({
    coords: { longitude: lng, latitude: lat, accuracy, heading: null, speed: null },
    timestamp: 1_800_000_000_000,
  }) as unknown as GeolocationPosition;

const denial = { code: 1, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError;

beforeEach(() => {
  install();
});

afterEach(() => {
  vi.resetModules();
});

describe("start / stop", () => {
  it("does not touch geolocation until asked", async () => {
    const { watches } = install();
    const { useLocation } = await freshStore();
    expect(useLocation.getState().status).toBe("idle");
    expect(watches).toHaveLength(0);
  });

  it("watches on start and reports the first fix", async () => {
    const { watches } = install();
    const { useLocation } = await freshStore();
    useLocation.getState().start();
    expect(useLocation.getState().status).toBe("locating");
    expect(watches).toHaveLength(1);

    watches[0].ok(position(-121.9, 36.6, 35));
    const s = useLocation.getState();
    expect(s.status).toBe("live");
    expect(s.permission).toBe("granted");
    expect(s.fix).toMatchObject({ lngLat: [-121.9, 36.6], accuracyM: 35 });
  });

  it("remembers the choice per device", async () => {
    install();
    const { useLocation, locationEnabled } = await freshStore();
    expect(locationEnabled()).toBe(false);
    useLocation.getState().start();
    expect(locationEnabled()).toBe(true);
    useLocation.getState().stop();
    expect(locationEnabled()).toBe(false);
  });

  it("clears the watch and drops the fix on stop", async () => {
    const { watches, cleared } = install();
    const { useLocation } = await freshStore();
    useLocation.getState().start();
    watches[0].ok(position(-117, 32));
    useLocation.getState().stop();
    expect(cleared).toEqual([1]);
    expect(useLocation.getState()).toMatchObject({ status: "idle", fix: null });
  });

  it("says so when the browser has no geolocation at all", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    const { useLocation } = await freshStore();
    useLocation.getState().start();
    expect(useLocation.getState().status).toBe("unavailable");
  });
});

describe("denial", () => {
  it("reports a refusal and stops watching", async () => {
    const { watches, cleared } = install();
    const { useLocation } = await freshStore();
    useLocation.getState().start();
    watches[0].fail(denial);
    expect(useLocation.getState()).toMatchObject({ status: "denied", permission: "denied" });
    expect(cleared).toEqual([1]);
  });

  it("keeps the device preference on, so allowing it later still works", async () => {
    const { watches } = install();
    const { useLocation, locationEnabled } = await freshStore();
    useLocation.getState().start();
    watches[0].fail(denial);
    expect(locationEnabled()).toBe(true);
  });

  it("keeps a live blip through a transient failure", async () => {
    const { watches } = install();
    const { useLocation } = await freshStore();
    useLocation.getState().start();
    watches[0].ok(position(-122, 37));
    watches[0].fail({ code: 3, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError);
    expect(useLocation.getState().status).toBe("live");
  });

  it("reports an error only when there is nothing to show", async () => {
    const { watches } = install();
    const { useLocation } = await freshStore();
    useLocation.getState().start();
    watches[0].fail({ code: 2, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError);
    expect(useLocation.getState().status).toBe("error");
  });
});

describe("resumeIfGranted", () => {
  it("stays quiet when it was never switched on here", async () => {
    const { watches } = install({ permission: "granted" });
    const { useLocation } = await freshStore();
    useLocation.getState().resumeIfGranted();
    await Promise.resolve();
    await Promise.resolve();
    expect(watches).toHaveLength(0);
    expect(useLocation.getState().status).toBe("idle");
  });

  it("stays quiet when permission is still only promptable", async () => {
    const { watches } = install({ permission: "prompt" });
    const { useLocation } = await freshStore();
    useLocation.getState().start(); // remembers the choice
    useLocation.getState().stop(); // ...then turned back off
    watches.length = 0;
    useLocation.getState().resumeIfGranted();
    await Promise.resolve();
    expect(watches).toHaveLength(0);
  });

  it("resumes silently once switched on and granted", async () => {
    install({ permission: "granted" });
    const { useLocation } = await freshStore();
    useLocation.getState().start();
    useLocation.getState().stop();

    // simulate a fresh load with the preference already stored
    const stored = globalThis.localStorage;
    const { watches } = install({ permission: "granted" });
    Object.defineProperty(globalThis, "localStorage", { value: stored, configurable: true });
    Object.defineProperty(globalThis, "window", { value: { localStorage: stored }, configurable: true });
    stored.setItem("coastline-location", "on");

    const again = await freshStore();
    again.useLocation.getState().resumeIfGranted();
    await Promise.resolve();
    await Promise.resolve();
    expect(watches.length).toBeGreaterThan(0);
  });

  it("honors the stored choice when the browser can't report permissions", async () => {
    const { watches } = install({ hasPermissionsApi: false });
    globalThis.localStorage.setItem("coastline-location", "on");
    const { useLocation } = await freshStore();
    useLocation.getState().resumeIfGranted();
    expect(watches).toHaveLength(1);
  });
});
