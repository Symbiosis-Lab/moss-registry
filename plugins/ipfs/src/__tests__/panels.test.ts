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

import {
  renderPinataSetupHtml,
  renderLocalSetupHtml,
  renderDaemonConsentHtml,
} from "../setup-panel";
import { renderResult } from "../result-panel";

describe("renderPinataSetupHtml", () => {
  it("includes the credential field and emit event", () => {
    const html = renderPinataSetupHtml();
    expect(html).toContain('id="jwt"');
    expect(html).toContain("ipfs:pinata-credentials");
  });

  it("does not claim the token is per-project, or offer an env var that cannot work", () => {
    // The cookie jar is app-wide, and the host's env allow-list refuses
    // MOSS_IPFS_PINATA_JWT outright.
    const html = renderPinataSetupHtml();
    expect(html).not.toMatch(/this project only/);
    expect(html).toMatch(/shared by every project/);
    expect(html).not.toContain("MOSS_IPFS_PINATA_JWT");
  });
});

describe("renderLocalSetupHtml", () => {
  it("links the installer (no terminal commands) when Kubo is missing", () => {
    const html = renderLocalSetupHtml({ reason: "not reachable", installed: false });
    expect(html).toContain("ipfs:local-setup");
    expect(html).toContain("docs.ipfs.tech/install/ipfs-desktop");
    expect(html).toContain("not reachable");
    // Writer-facing: no shell commands in the panel.
    expect(html).not.toContain("brew install");
    expect(html).not.toContain("ipfs daemon");
  });

  it("asks to start the app when Kubo is installed but stopped", () => {
    const html = renderLocalSetupHtml({ installed: true });
    expect(html).toMatch(/couldn't start it automatically/);
    expect(html).not.toContain("docs.ipfs.tech/install");
  });

  it("offers to move the gateway when the node's port is taken, and says it edits their config", () => {
    const html = renderLocalSetupHtml({
      reason: "port 8080 is in use",
      installed: true,
      portOffer: { taken: 8080, suggested: 8081 },
    });
    expect(html).toContain("8080");
    expect(html).toContain("Use port 8081");
    // Changing someone's node configuration is theirs to agree to.
    expect(html).toMatch(/edits your IPFS node's own configuration/);
    expect(html).toContain("changePort");
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

  it("warns about availability only for local-only deploys", () => {
    expect(renderResult({ ...base, localOnly: true })).toMatch(/only while the node is running/);
    expect(renderResult(base)).not.toMatch(/only while the node is running/);
  });

  it("branches DNSLink copy on domain stability", () => {
    const stable = renderResult({ ...base, domain: "example.com", domainStable: true });
    expect(stable).toMatch(/update automatically/);
    const pinned = renderResult({ ...base, domain: "example.com", domainStable: false });
    expect(pinned).toMatch(/re-deploy with IPNS/);
  });
});

describe("renderDaemonConsentHtml", () => {
  // The three facts a user cannot discover after the fact — moss starts a
  // long-lived background process on their computer.
  it("says the node outlives moss, does not survive a reboot, and how to stop it", () => {
    const html = renderDaemonConsentHtml();
    expect(html).toMatch(/keeps running after you quit moss/);
    expect(html).toMatch(/does not start again by itself after you restart/);
    expect(html).toMatch(/ipfs shutdown/);
    expect(html).toContain("ipfs:daemon-consent");
  });

  it("offers a way out that needs no node at all", () => {
    expect(renderDaemonConsentHtml()).toMatch(/Pinata/);
  });
});
