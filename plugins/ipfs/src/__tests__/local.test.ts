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

const rpc = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../http", () => ({
  postRaw: vi.fn(async (url: string) => {
    rpc.calls.push(url);
    return { ok: true, status: 200, text: () => "{}" };
  }),
  postMultipart: vi.fn(),
  toMultipartFiles: vi.fn(),
}));

import { rootCidFromAddOutput, kuboLsVerdict, LocalProvider } from "../providers/local";

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

describe("IPNS ownership", () => {
  it("never publishes IPNS itself — the node keystore holds a different key", async () => {
    // A keystore publish would put the site at a permanently different address
    // than the identity name every other deploy uses, so the capability must
    // not exist at all: main.ts's `useIpns` path has exactly one owner.
    const provider = new LocalProvider({ provider: "local", useIpns: true, relativeUrls: true });
    expect((provider as unknown as { publishIpns?: unknown }).publishIpns).toBeUndefined();

    rpc.calls.length = 0;
    await provider.checkReady();
    await provider.verifyDirectory("bafyCID", "assets/app.css");
    expect(rpc.calls.some((u) => u.includes("/key/") || u.includes("/name/publish"))).toBe(false);
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
