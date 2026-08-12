import { describe, it, expect, vi } from "vitest";

// local.ts (via utils.ts) touches moss-api at import time, so provide a broad stub.
vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  dismissToast: vi.fn(),
  closeBrowser: vi.fn(),
  openBrowserWithHtml: vi.fn(),
  onEvent: vi.fn(),
  httpPost: vi.fn(),
  httpPostMultipart: vi.fn(),
  fetchUrl: vi.fn(),
  executeBinary: vi.fn(),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn(),
  pluginFileExists: vi.fn(),
  getPluginCookie: vi.fn(),
  setPluginCookie: vi.fn(),
  getPluginEnvVar: vi.fn(),
  listSiteFilesWithSizes: vi.fn(),
  readSiteFile: vi.fn(),
}));

const cfg = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }));

vi.mock("../config", () => ({
  updateConfig: vi.fn(async (patch: Record<string, unknown>) => {
    cfg.updates.push(patch);
    return patch;
  }),
}));

const rpc = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../http", () => ({
  postRaw: vi.fn(async (url: string) => {
    rpc.calls.push(url);
    if (url.includes("/key/list")) {
      return { ok: true, status: 200, text: () => JSON.stringify({ Keys: [] }) };
    }
    if (url.includes("/key/gen")) {
      return { ok: true, status: 200, text: () => JSON.stringify({ Name: "x", Id: "k51generated" }) };
    }
    if (url.includes("/name/publish")) {
      return { ok: true, status: 200, text: () => JSON.stringify({ Name: "k51generated", Value: "/ipfs/bafy" }) };
    }
    return { ok: true, status: 200, text: () => "{}" };
  }),
  postMultipart: vi.fn(),
  parseJson: vi.fn((res: { text(): string }) => JSON.parse(res.text())),
  toMultipartFiles: vi.fn(),
}));

import { rootCidFromAddOutput, kuboLsVerdict, newProjectKeyName, LocalProvider } from "../providers/local";

const ROOT = "bafybeiwrapROOTcidxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

describe("rootCidFromAddOutput", () => {
  it("returns the wrapper entry (empty Name) as the root", () => {
    const ndjson = [
      JSON.stringify({ Name: "index.html", Hash: "bafkFILE1", Size: "10" }),
      JSON.stringify({ Name: "assets/app.css", Hash: "bafkFILE2", Size: "20" }),
      JSON.stringify({ Name: "assets", Hash: "bafDIR", Size: "30" }),
      JSON.stringify({ Name: "", Hash: ROOT, Size: "60" }),
    ].join("\n");
    expect(rootCidFromAddOutput(ndjson)).toBe(ROOT);
  });

  it("falls back to the last entry when there is no empty-Name wrapper", () => {
    const ndjson = [
      JSON.stringify({ Name: "index.html", Hash: "bafkFILE1" }),
      JSON.stringify({ Name: "site", Hash: ROOT }),
    ].join("\n");
    expect(rootCidFromAddOutput(ndjson)).toBe(ROOT);
  });

  it("ignores non-JSON progress lines", () => {
    const ndjson = ["not json", JSON.stringify({ Name: "", Hash: ROOT })].join("\n");
    expect(rootCidFromAddOutput(ndjson)).toBe(ROOT);
  });

  it("returns null for empty output", () => {
    expect(rootCidFromAddOutput("")).toBeNull();
    expect(rootCidFromAddOutput("   \n  ")).toBeNull();
  });
});

describe("per-project IPNS key names", () => {
  it("newProjectKeyName produces unique, well-formed names", () => {
    const a = newProjectKeyName();
    const b = newProjectKeyName();
    expect(a).toMatch(/^moss-site-[0-9a-f]{8}$/);
    expect(b).toMatch(/^moss-site-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("publishIpns reuses a persisted project key (existing URLs stay stable)", async () => {
    rpc.calls.length = 0;
    cfg.updates.length = 0;
    const provider = new LocalProvider({ ipnsKey: "moss-site-persisted" });
    await provider.publishIpns("bafyCID");
    const publish = rpc.calls.find((u) => u.includes("/name/publish"));
    expect(publish).toContain("key=moss-site-persisted");
    // No new key name persisted.
    expect(cfg.updates.some((p) => typeof p.ipnsKey === "string" && p.ipnsKey !== "moss-site-persisted")).toBe(false);
  });

  it("publishIpns generates and persists a UNIQUE key name on first use (never a shared constant)", async () => {
    rpc.calls.length = 0;
    cfg.updates.length = 0;
    const provider = new LocalProvider({});
    await provider.publishIpns("bafyCID");
    const persisted = cfg.updates.find((p) => typeof p.ipnsKey === "string")?.ipnsKey as string;
    expect(persisted).toMatch(/^moss-site-[0-9a-f]{8}$/);
    const publish = rpc.calls.find((u) => u.includes("/name/publish"));
    expect(publish).toContain(`key=${encodeURIComponent(persisted)}`);
    // A second project (fresh config) gets a DIFFERENT key.
    rpc.calls.length = 0;
    cfg.updates.length = 0;
    await new LocalProvider({}).publishIpns("bafyOTHER");
    const persisted2 = cfg.updates.find((p) => typeof p.ipnsKey === "string")?.ipnsKey as string;
    expect(persisted2).toMatch(/^moss-site-[0-9a-f]{8}$/);
    expect(persisted2).not.toBe(persisted);
  });
});

describe("kuboLsVerdict", () => {
  it("returns ok for a successful ls", () => {
    expect(kuboLsVerdict(true, 200, '{"Objects":[]}')).toBe("ok");
  });

  it("returns broken only for the definitive missing-link error", () => {
    expect(kuboLsVerdict(false, 500, 'no link named "app.css" under bafy...')).toBe("broken");
    expect(kuboLsVerdict(false, 500, "path not found")).toBe("broken");
  });

  it("treats transport/other failures as inconclusive, never broken", () => {
    expect(kuboLsVerdict(false, 0, "")).toBe("inconclusive");
    expect(kuboLsVerdict(false, 500, "context deadline exceeded")).toBe("inconclusive");
    expect(kuboLsVerdict(false, 429, "rate limited")).toBe("inconclusive");
  });
});
