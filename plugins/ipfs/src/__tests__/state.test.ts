import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ files: {} as Record<string, string> }));

vi.mock("@symbiosis-lab/moss-api", () => ({
  pluginFileExists: vi.fn(async (name: string) => h.files[name] !== undefined),
  readPluginFile: vi.fn(async (name: string) => h.files[name] ?? ""),
  writePluginFile: vi.fn(async (name: string, content: string) => {
    h.files[name] = content;
  }),
}));

import { getState, updateState, recordSuccess, recordError } from "../state";

beforeEach(() => {
  h.files = {};
  vi.clearAllMocks();
});

describe("state persistence", () => {
  it("round-trips through state.json", async () => {
    await updateState({ ipnsSeq: 3, ipnsName: "k51x" });
    const state = await getState();
    expect(state.ipnsSeq).toBe(3);
    expect(state.ipnsName).toBe("k51x");
  });

  it("NEVER writes the user's settings file", async () => {
    await recordSuccess("bafyNEW", { lastUsedIpns: true });
    await recordError("boom");
    expect(Object.keys(h.files)).toEqual(["state.json"]);
    expect(h.files["config.json"]).toBeUndefined();
  });

  it("recordSuccess clears the previous failure breadcrumb", async () => {
    await recordError("boom");
    await recordSuccess("bafyNEW");
    expect((await getState()).lastDeployError).toBeUndefined();
  });
});

describe("migration from the pre-split config.json", () => {
  it("carries the IPNS sequence over, so the name does not freeze", async () => {
    // A record whose sequence does not exceed the last published one is
    // ignored by every node: restarting at 1 would strand the site's stable
    // address at the CID of the deploy before the upgrade.
    h.files["config.json"] = JSON.stringify({
      provider: "local",
      use_ipns: true,
      ipnsSeq: 4,
      identityIpnsName: "k51legacy",
      lastCid: "bafyOLD",
      structureVerified: { local: true },
    });
    const state = await getState();
    expect(state.ipnsSeq).toBe(4);
    expect(state.ipnsName).toBe("k51legacy");
    expect(state.structureVerified).toEqual({ local: true });
  });

  it("takes no settings across, and leaves config.json untouched", async () => {
    h.files["config.json"] = JSON.stringify({ provider: "local", gateway: "g.example", ipnsSeq: 2 });
    const before = h.files["config.json"];
    await updateState({ lastCid: "bafyNEW" });
    const written = JSON.parse(h.files["state.json"]) as Record<string, unknown>;
    expect(written.provider).toBeUndefined();
    expect(written.gateway).toBeUndefined();
    expect(written.ipnsSeq).toBe(2);
    expect(h.files["config.json"]).toBe(before);
  });

  it("prefers its own state.json once written", async () => {
    h.files["config.json"] = JSON.stringify({ ipnsSeq: 4 });
    h.files["state.json"] = JSON.stringify({ ipnsSeq: 9 });
    expect((await getState()).ipnsSeq).toBe(9);
  });
});
