import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ file: null as string | null }));

vi.mock("@symbiosis-lab/moss-api", () => ({
  pluginFileExists: vi.fn(async () => h.file !== null),
  readPluginFile: vi.fn(async () => h.file ?? ""),
  writePluginFile: vi.fn(async (_name: string, content: string) => {
    h.file = content;
  }),
}));

import { getConfig, saveConfig, updateConfig, applyUserSettings, recordError } from "../config";

beforeEach(() => {
  h.file = null;
  vi.clearAllMocks();
});

describe("getConfig", () => {
  it("returns defaults when no file exists", async () => {
    expect(await getConfig()).toEqual({ provider: "pinata", useIpns: true, relativeUrls: true });
  });

  it("merges stored values over defaults", async () => {
    h.file = JSON.stringify({ useIpns: false, ipnsName: "k51x", lastCid: "bafy" });
    const cfg = await getConfig();
    expect(cfg.provider).toBe("pinata");
    expect(cfg.useIpns).toBe(false);
    expect(cfg.ipnsName).toBe("k51x");
  });

  it("coerces an invalid provider to pinata", async () => {
    h.file = JSON.stringify({ provider: "weird" });
    expect((await getConfig()).provider).toBe("pinata");
  });

  it("returns defaults on invalid JSON", async () => {
    h.file = "{not json";
    expect(await getConfig()).toEqual({ provider: "pinata", useIpns: true, relativeUrls: true });
  });
});

describe("saveConfig / updateConfig / recordError round-trip", () => {
  it("persists and reloads", async () => {
    await saveConfig({ provider: "local", useIpns: true, ipnsKey: "moss-site" });
    expect((await getConfig()).provider).toBe("local");
  });

  it("updateConfig merges a patch", async () => {
    await saveConfig({ provider: "pinata", lastCid: "old" });
    const next = await updateConfig({ lastCid: "new", ipnsName: "k51x" });
    expect(next.lastCid).toBe("new");
    expect((await getConfig()).ipnsName).toBe("k51x");
  });

  it("recordError persists a failure reason", async () => {
    await recordError("boom");
    expect((await getConfig()).lastDeployError).toBe("boom");
  });
});

describe("applyUserSettings", () => {
  it("overlays snake_case user settings, preserving derived state", () => {
    const base = {
      provider: "pinata" as const,
      useIpns: true,
      ipnsName: "keep",
      uploadModes: { pinata: "car" as const },
    };
    const merged = applyUserSettings(base, {
      provider: "local",
      pin_name: "my site",
      use_ipns: false,
      gateway: "g.example",
    });
    expect(merged.provider).toBe("local");
    expect(merged.pinName).toBe("my site");
    expect(merged.useIpns).toBe(false);
    expect(merged.gateway).toBe("g.example");
    expect(merged.ipnsName).toBe("keep");
    expect(merged.uploadModes).toEqual({ pinata: "car" });
  });

  it("ignores an invalid provider and falls back to the base", () => {
    const merged = applyUserSettings({ provider: "local" }, { provider: "nonsense" });
    expect(merged.provider).toBe("local");
  });

  it("maps node_rpc and co_pin settings", () => {
    const merged = applyUserSettings({}, { node_rpc: "http://my-pi:5001", co_pin: true });
    expect(merged.nodeRpc).toBe("http://my-pi:5001");
    expect(merged.coPin).toBe(true);
  });

  it("tolerates undefined user config", () => {
    expect(applyUserSettings({ provider: "pinata" }, undefined).provider).toBe("pinata");
  });
});
