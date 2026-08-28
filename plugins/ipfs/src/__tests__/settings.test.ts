import { describe, it, expect } from "vitest";

import { readSettings } from "../settings";

describe("readSettings", () => {
  it("reads the host-merged snake_case config", () => {
    const s = readSettings({
      provider: "local",
      pin_name: "my site",
      use_ipns: false,
      gateway: "g.example",
      node_rpc: "http://my-pi:5001",
      co_pin: true,
      relative_urls: false,
    });
    expect(s).toEqual({
      provider: "local",
      pinName: "my site",
      useIpns: false,
      gateway: "g.example",
      nodeRpc: "http://my-pi:5001",
      coPin: true,
      relativeUrls: false,
    });
  });

  it("falls back to the manifest defaults for absent keys", () => {
    expect(readSettings(undefined)).toEqual({
      provider: "pinata",
      gateway: undefined,
      pinName: undefined,
      useIpns: true,
      relativeUrls: true,
      nodeRpc: undefined,
      coPin: false,
    });
  });

  it("ignores an invalid provider rather than guessing", () => {
    expect(readSettings({ provider: "nonsense" }).provider).toBe("pinata");
  });

  it("carries no state keys — settings and state never mix", () => {
    const s = readSettings({ provider: "local", ipnsSeq: 7, lastCid: "bafy" }) as Record<string, unknown>;
    expect(s.ipnsSeq).toBeUndefined();
    expect(s.lastCid).toBeUndefined();
  });
});
