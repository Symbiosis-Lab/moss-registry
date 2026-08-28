import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  cookies: [] as Array<{ name: string; value: string; domain?: string }>,
}));

// Mirrors the host (plugins/cookie_store.rs): an EMPTY cookie list returns
// early and writes nothing. The previous mock cleared on `[]`, which is why a
// clear that never cleared passed its unit test for months.
vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(async () => h.cookies),
  setPluginCookie: vi.fn(async (cookies: typeof h.cookies) => {
    if (cookies.length === 0) return;
    h.cookies = cookies;
  }),
  clearPluginCookies: vi.fn(async () => {
    h.cookies = [];
  }),
}));

import { getPinataJwt, storePinataJwt, clearPinataJwt } from "../credentials";

beforeEach(async () => {
  await clearPinataJwt();
  h.cookies = [];
  vi.clearAllMocks();
});

describe("getPinataJwt", () => {
  it("returns null when nothing is set", async () => {
    expect(await getPinataJwt()).toBeNull();
  });

  it("reads from the plugin cookie", async () => {
    h.cookies = [{ name: "__pinata_jwt", value: "COOKIE_JWT" }];
    expect(await getPinataJwt()).toBe("COOKIE_JWT");
  });

  it("caches within a session, and clearPinataJwt drops the cache too", async () => {
    h.cookies = [{ name: "__pinata_jwt", value: "COOKIE_JWT" }];
    expect(await getPinataJwt()).toBe("COOKIE_JWT");
    h.cookies = [];
    expect(await getPinataJwt()).toBe("COOKIE_JWT"); // cached
    await clearPinataJwt();
    expect(await getPinataJwt()).toBeNull();
  });
});

describe("storePinataJwt / clearPinataJwt", () => {
  it("persists the JWT to a cookie", async () => {
    await storePinataJwt("STORED");
    expect(h.cookies.find((c) => c.name === "__pinata_jwt")?.value).toBe("STORED");
  });

  it("clears the stored JWT for real, so a rejected token cannot come back", async () => {
    const { setPluginCookie } = await import("@symbiosis-lab/moss-api");
    await storePinataJwt("STORED");
    await clearPinataJwt();
    // Writing an empty array is what the host ignores — it must not be the
    // mechanism here.
    expect(vi.mocked(setPluginCookie)).not.toHaveBeenCalledWith([]);
    expect(h.cookies).toHaveLength(0);
    expect(await getPinataJwt()).toBeNull();
  });
});
