import { describe, it, expect, vi } from "vitest";

vi.mock("@symbiosis-lab/moss-api", () => ({
  openBrowserWithHtml: vi.fn(),
}));

import { renderResult, escapeHtml } from "../result-panel";

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

  it("warns about availability only for local-only deploys", () => {
    expect(renderResult({ ...base, localOnly: true })).toMatch(/only while the node is running/);
    expect(renderResult(base)).not.toMatch(/only while the node is running/);
  });

  it("says a configured domain points at this publish, and what that costs", () => {
    const html = renderResult({ ...base, domain: "example.com" });
    expect(html).toContain("example.com");
    expect(html).toMatch(/new record to paste/);
    // Never the old promise: an IPNS-targeted domain expires after 48h.
    expect(html).not.toMatch(/update automatically/);
  });
});

describe("escapeHtml", () => {
  it("neutralizes injected markup", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });
});
