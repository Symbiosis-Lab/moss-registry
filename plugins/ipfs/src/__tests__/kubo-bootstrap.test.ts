import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  binaryOk: true,
  os: "darwin" as string,
  calls: [] as Array<{ binaryPath: string; args: string[] }>,
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  dismissToast: vi.fn(),
  closeBrowser: vi.fn(),
  executeBinary: vi.fn(async (cfg: { binaryPath: string; args: string[] }) => {
    h.calls.push(cfg);
    if (cfg.binaryPath === "ipfs" && cfg.args[0] === "version") {
      return { success: h.binaryOk, stdout: "0.42.0", stderr: "" };
    }
    return { success: true, stdout: "", stderr: "" };
  }),
  getPlatformInfo: vi.fn(async () => ({ os: h.os, arch: "arm64", platformKey: `${h.os}-arm64` })),
}));

import { kuboInstalled, bootstrapLocalNode } from "../kubo-bootstrap";

beforeEach(() => {
  h.binaryOk = true;
  h.os = "darwin";
  h.calls = [];
  vi.clearAllMocks();
});

describe("kuboInstalled", () => {
  it("reflects the executeBinary probe", async () => {
    expect(await kuboInstalled()).toBe(true);
    h.binaryOk = false;
    expect(await kuboInstalled()).toBe(false);
  });
});

describe("bootstrapLocalNode", () => {
  it("NEVER downloads: missing binary → install guidance, no further calls", async () => {
    h.binaryOk = false;
    const result = await bootstrapLocalNode(() => {});
    expect(result.ok).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.reason).toMatch(/isn't installed/);
    // Only the detection probe ran — nothing resembling a fetch or install.
    expect(h.calls).toHaveLength(1);
  });

  it("starts an installed node: init then a detached daemon spawn", async () => {
    const statuses: string[] = [];
    const result = await bootstrapLocalNode((m) => statuses.push(m));
    expect(result.ok).toBe(true);
    expect(h.calls.some((c) => c.binaryPath === "ipfs" && c.args[0] === "init")).toBe(true);
    const spawn = h.calls.find((c) => c.binaryPath === "/bin/sh");
    expect(spawn?.args[1]).toContain("ipfs daemon");
    expect(statuses.length).toBeGreaterThan(0);
  });

  it("is guidance-only on Windows", async () => {
    h.os = "windows";
    const result = await bootstrapLocalNode(() => {});
    expect(result.ok).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.reason).toMatch(/Windows/);
  });
});
