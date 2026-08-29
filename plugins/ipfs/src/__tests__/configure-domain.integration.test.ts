import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({ state: "" }));

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
  getPluginEnvVar: vi.fn(),
  listSiteFilesWithSizes: vi.fn(),
  readSiteFile: vi.fn(),
  pluginFileExists: vi.fn(async (name: string) => name === "state.json" && api.state !== ""),
  readPluginFile: vi.fn(async () => api.state),
  writePluginFile: vi.fn(),
}));

import { configure_domain } from "../main";

beforeEach(() => {
  api.state = "";
  vi.clearAllMocks();
});

describe("configure_domain", () => {
  it("reports the CID target from this deployment's metadata", async () => {
    const result = await configure_domain({
      domain: "example.com",
      deployment: { metadata: { cid: "bafyCID", ipns_name: "k51x" } },
    } as never);
    expect(result.success).toBe(true);
    expect(result.message).toContain("/ipfs/bafyCID");
    expect(result.message).not.toContain("/ipns/k51x");
  });

  it("explains why the stable IPNS name is not the domain's target", async () => {
    const result = await configure_domain({
      domain: "example.com",
      deployment: { metadata: { cid: "bafyCID", ipns_name: "k51x" } },
    } as never);
    expect(result.message).toContain("k51x");
    expect(result.message).toMatch(/expires\s+48 hours/);
  });

  it("says nothing about IPNS when the deploy published none", async () => {
    const result = await configure_domain({
      domain: "example.com",
      deployment: { metadata: { cid: "bafyCID", ipns_name: "" } },
    } as never);
    expect(result.message).toContain("/ipfs/bafyCID");
    expect(result.message).not.toMatch(/IPNS/);
  });

  it("falls back to persisted state when there is no deployment metadata", async () => {
    api.state = JSON.stringify({ lastCid: "bafyPERSISTED", ipnsName: "k51persisted" });
    const result = await configure_domain({ domain: "example.com" } as never);
    expect(result.success).toBe(true);
    expect(result.message).toContain("/ipfs/bafyPERSISTED");
  });

  it("fails when there is no deployment at all", async () => {
    const result = await configure_domain({ domain: "example.com" } as never);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Deploy first/);
  });
});
