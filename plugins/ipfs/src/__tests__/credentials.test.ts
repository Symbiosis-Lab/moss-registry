import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  rejected: [] as string[],
}));

// Mirrors the host: the store is app-global and keyed by (plugin, key), the
// plugin never writes it, and rejecting FORGETS the value — that last part is
// what makes a revoked token ask again instead of failing forever.
vi.mock("@symbiosis-lab/moss-api", () => ({
  getSecret: vi.fn(async (key: string) => h.store.get(key) ?? null),
  rejectSecret: vi.fn(async (key: string) => {
    h.rejected.push(key);
    h.store.delete(key);
  }),
}));

import { getPinataJwt, rejectPinataJwt, PINATA_JWT_KEY } from "../credentials";

beforeEach(() => {
  h.store.clear();
  h.rejected = [];
  vi.clearAllMocks();
});

describe("getPinataJwt", () => {
  it("returns null when moss holds no token", async () => {
    expect(await getPinataJwt()).toBeNull();
  });

  it("reads the secret moss holds, under the key the manifest declares", async () => {
    h.store.set(PINATA_JWT_KEY, "JWT");
    expect(await getPinataJwt()).toBe("JWT");
  });

  it("does not cache, so a token replaced in moss's modal is seen at once", async () => {
    h.store.set(PINATA_JWT_KEY, "OLD");
    expect(await getPinataJwt()).toBe("OLD");
    h.store.set(PINATA_JWT_KEY, "NEW");
    expect(await getPinataJwt()).toBe("NEW");
  });
});

describe("rejectPinataJwt", () => {
  it("tells moss the token is dead, so the next publish asks for another", async () => {
    h.store.set(PINATA_JWT_KEY, "REVOKED");
    await rejectPinataJwt();
    expect(h.rejected).toEqual([PINATA_JWT_KEY]);
    expect(await getPinataJwt()).toBeNull();
  });
});
