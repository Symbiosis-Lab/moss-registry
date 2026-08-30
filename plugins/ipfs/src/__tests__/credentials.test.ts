import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getPinataJwt, rejectPinataJwt } from "../credentials";

const invoke = vi.fn();
type G = { __TAURI__?: unknown };

beforeEach(() => {
  invoke.mockReset();
  (globalThis as G).__TAURI__ = { core: { invoke } };
});

afterEach(() => {
  delete (globalThis as G).__TAURI__;
});

describe("getPinataJwt", () => {
  it("asks the host for the declared secret by key", async () => {
    invoke.mockResolvedValueOnce("JWT");
    expect(await getPinataJwt()).toBe("JWT");
    expect(invoke).toHaveBeenCalledWith("get_plugin_secret", { key: "pinata_jwt" });
  });

  it("passes null through — no token and nobody to ask", async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await getPinataJwt()).toBeNull();
  });
});

describe("rejectPinataJwt", () => {
  it("sends the rejection reason and resolves with the replacement", async () => {
    invoke.mockResolvedValueOnce("FRESH");
    expect(await rejectPinataJwt("Pinata says no.")).toBe("FRESH");
    expect(invoke).toHaveBeenCalledWith("reject_plugin_secret", {
      key: "pinata_jwt",
      detail: "Pinata says no.",
    });
  });
});

describe("outside the moss host", () => {
  it("fails loudly rather than pretending there is no token", async () => {
    delete (globalThis as G).__TAURI__;
    await expect(getPinataJwt()).rejects.toThrow(/moss host/);
  });
});
