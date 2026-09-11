import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  env: undefined as string | undefined,
  cookies: [] as Array<{ name: string; value: string; domain?: string }>,
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginEnvVar: vi.fn(async () => h.env),
  getPluginCookie: vi.fn(async () => h.cookies),
  setPluginCookie: vi.fn(async (cookies: typeof h.cookies) => {
    h.cookies = cookies;
  }),
}));

import { getPinataJwt, storePinataJwt, clearJwtCache, clearPinataJwt } from "../credentials";

beforeEach(() => {
  h.env = undefined;
  h.cookies = [];
  clearJwtCache();
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

  it("prefers the env override over the cookie", async () => {
    h.env = "ENV_JWT";
    h.cookies = [{ name: "__pinata_jwt", value: "COOKIE_JWT" }];
    expect(await getPinataJwt()).toBe("ENV_JWT");
  });
});

describe("storePinataJwt / clearPinataJwt", () => {
  it("persists to a cookie and reads back", async () => {
    await storePinataJwt("STORED");
    expect(h.cookies.find((c) => c.name === "__pinata_jwt")?.value).toBe("STORED");
    clearJwtCache();
    expect(await getPinataJwt()).toBe("STORED");
  });

  it("clears the stored JWT", async () => {
    await storePinataJwt("STORED");
    await clearPinataJwt();
    expect(h.cookies).toHaveLength(0);
    expect(await getPinataJwt()).toBeNull();
  });
});
