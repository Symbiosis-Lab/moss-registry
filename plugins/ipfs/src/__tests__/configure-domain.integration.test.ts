import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({ configFile: "{}" }));

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
  getPluginCookie: vi.fn(),
  setPluginCookie: vi.fn(),
  getPluginEnvVar: vi.fn(),
  listSiteFilesWithSizes: vi.fn(),
  readSiteFile: vi.fn(),
  pluginFileExists: vi.fn(async () => api.configFile !== "{}"),
  readPluginFile: vi.fn(async () => api.configFile),
  writePluginFile: vi.fn(),
}));

import { configure_domain } from "../main";

beforeEach(() => {
  api.configFile = "{}";
  vi.clearAllMocks();
});

describe("configure_domain", () => {
  it("uses IPNS from deployment metadata and reports auto-update", async () => {
    const ctx = {
      domain: "example.com",
      deployment: { metadata: { cid: "bafyCID", ipns_name: "k51x" } },
    } as never;
    const result = await configure_domain(ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("/ipns/k51x");
    expect(result.message).toMatch(/update automatically/);
  });

  it("falls back to the CID (and hints at IPNS) when no IPNS name is present", async () => {
    const ctx = {
      domain: "example.com",
      deployment: { metadata: { cid: "bafyCID", ipns_name: "" } },
    } as never;
    const result = await configure_domain(ctx);
    expect(result.message).toContain("/ipfs/bafyCID");
    expect(result.message).toMatch(/re-run deploy with IPNS/);
  });

  it("reads persisted config when metadata is missing (IPNS-backed last deploy)", async () => {
    api.configFile = JSON.stringify({
      lastCid: "bafyPERSISTED",
      ipnsName: "k51persisted",
      lastUsedIpns: true,
    });
    const result = await configure_domain({ domain: "example.com" } as never);
    expect(result.success).toBe(true);
    expect(result.message).toContain("/ipns/k51persisted");
  });

  it("does NOT report a stale IPNS name when the deploy had IPNS off", async () => {
    // Persisted state still carries a stable name from an earlier IPNS deploy…
    api.configFile = JSON.stringify({ lastCid: "bafyOLD", ipnsName: "k51stale", lastUsedIpns: true });
    // …but this deployment's metadata says IPNS was off (empty ipns_name).
    const ctx = {
      domain: "example.com",
      deployment: { metadata: { cid: "bafyNEW", ipns_name: "" } },
    } as never;
    const result = await configure_domain(ctx);
    expect(result.message).toContain("/ipfs/bafyNEW");
    expect(result.message).not.toContain("k51stale");
    expect(result.message).toMatch(/re-run deploy with IPNS/);
  });

  it("ignores a stale persisted IPNS name when the last deploy did not use IPNS", async () => {
    api.configFile = JSON.stringify({ lastCid: "bafyCID", ipnsName: "k51stale", lastUsedIpns: false });
    const result = await configure_domain({ domain: "example.com" } as never);
    expect(result.message).toContain("/ipfs/bafyCID");
    expect(result.message).not.toContain("k51stale");
  });

  it("fails when there is no deployment at all", async () => {
    const result = await configure_domain({ domain: "example.com" } as never);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Deploy first/);
  });
});
