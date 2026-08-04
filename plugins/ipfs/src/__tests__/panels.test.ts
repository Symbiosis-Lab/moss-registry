import { describe, it, expect, vi } from "vitest";

vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  dismissToast: vi.fn(),
  closeBrowser: vi.fn(),
  openBrowserWithHtml: vi.fn(),
  onEvent: vi.fn(),
}));

import { renderPinataSetupHtml, renderLocalSetupHtml } from "../setup-panel";
import { renderResult } from "../result-panel";

describe("renderPinataSetupHtml", () => {
  it("includes the credential field, emit event, and env-var hint", () => {
    const html = renderPinataSetupHtml();
    expect(html).toContain('id="jwt"');
    expect(html).toContain("ipfs:pinata-credentials");
    expect(html).toContain("MOSS_IPFS_PINATA_JWT");
  });
});

describe("renderLocalSetupHtml", () => {
  it("includes the retry event and daemon guidance", () => {
    const html = renderLocalSetupHtml({ reason: "not reachable" });
    expect(html).toContain("ipfs:local-setup");
    expect(html).toContain("ipfs daemon");
    expect(html).toContain("not reachable");
  });

  it("escapes an injected reason", () => {
    const html = renderLocalSetupHtml({ reason: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("renderResult", () => {
  const base = {
    cid: "bafyCID",
    providerLabel: "Pinata",
    primaryUrl: "https://bafyCID.ipfs.dweb.link",
    links: [
      { label: "dweb.link", url: "https://bafyCID.ipfs.dweb.link" },
      { label: "Pinata gateway", url: "https://gateway.pinata.cloud/ipfs/bafyCID" },
    ],
  };

  it("shows the CID and each gateway link", () => {
    const html = renderResult(base);
    expect(html).toContain("bafyCID");
    expect(html).toContain("https://gateway.pinata.cloud/ipfs/bafyCID");
  });

  it("shows the IPNS row only when an IPNS name is present", () => {
    expect(renderResult(base)).not.toContain(">IPNS<");
    const withIpns = renderResult({ ...base, ipnsName: "k51x" });
    expect(withIpns).toContain("k51x");
  });

  it("branches DNSLink copy on domain stability", () => {
    const stable = renderResult({ ...base, domain: "example.com", domainStable: true });
    expect(stable).toMatch(/update automatically/);
    const pinned = renderResult({ ...base, domain: "example.com", domainStable: false });
    expect(pinned).toMatch(/re-deploy with IPNS/);
  });
});
