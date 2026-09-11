import { describe, it, expect } from "vitest";
import {
  isCidV1,
  subdomainCidUrl,
  pathCidUrl,
  bestCidUrl,
  primaryGatewayUrl,
  providerGatewayUrl,
  siteDisplayUrl,
  gatewayLinks,
  kuboRpcBase,
  isDefaultNodeRpc,
} from "../gateways";
import type { IpfsPluginConfig } from "../types";

const CIDV1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const CIDV0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

describe("isCidV1", () => {
  it("accepts lowercase base32 CIDv1", () => {
    expect(isCidV1(CIDV1)).toBe(true);
  });
  it("rejects CIDv0 (Qm…) and empty strings", () => {
    expect(isCidV1(CIDV0)).toBe(false);
    expect(isCidV1("")).toBe(false);
  });
});

describe("URL builders", () => {
  it("builds subdomain and path CID URLs", () => {
    expect(subdomainCidUrl(CIDV1, "dweb.link")).toBe(`https://${CIDV1}.ipfs.dweb.link`);
    expect(pathCidUrl("dweb.link", CIDV1)).toBe(`https://dweb.link/ipfs/${CIDV1}`);
  });

  it("bestCidUrl uses subdomain for CIDv1 and path for CIDv0", () => {
    expect(bestCidUrl(CIDV1, "dweb.link")).toBe(`https://${CIDV1}.ipfs.dweb.link`);
    expect(bestCidUrl(CIDV0, "dweb.link")).toBe(`https://dweb.link/ipfs/${CIDV0}`);
  });
});

describe("primaryGatewayUrl", () => {
  it("defaults to dweb.link subdomain for CIDv1", () => {
    expect(primaryGatewayUrl(CIDV1, {})).toBe(`https://${CIDV1}.ipfs.dweb.link`);
  });
  it("uses the PATH form for a custom gateway host (most are path-style only)", () => {
    const config: IpfsPluginConfig = { gateway: "gateway.pinata.cloud" };
    expect(primaryGatewayUrl(CIDV1, config)).toBe(`https://gateway.pinata.cloud/ipfs/${CIDV1}`);
  });
  it("falls back to path form for CIDv0", () => {
    expect(primaryGatewayUrl(CIDV0, {})).toBe(`https://dweb.link/ipfs/${CIDV0}`);
  });
});

describe("providerGatewayUrl", () => {
  it("uses the Pinata gateway (path form) by default", () => {
    expect(providerGatewayUrl("pinata", CIDV1)).toBe(`https://gateway.pinata.cloud/ipfs/${CIDV1}`);
  });
  it("uses a custom Pinata gateway when set", () => {
    expect(providerGatewayUrl("pinata", CIDV1, "my.mypinata.cloud")).toBe(
      `https://my.mypinata.cloud/ipfs/${CIDV1}`,
    );
  });
  it("uses the SUBDOMAIN localhost gateway for the local provider (origin-rooted)", () => {
    // Path form would break moss's root-absolute asset/link paths.
    expect(providerGatewayUrl("local", CIDV1)).toBe(`http://${CIDV1}.ipfs.localhost:8080`);
  });
});

describe("siteDisplayUrl", () => {
  it("prefers a configured custom gateway (path form)", () => {
    expect(siteDisplayUrl(CIDV1, "pinata", { gateway: "g.example" })).toBe(
      `https://g.example/ipfs/${CIDV1}`,
    );
  });
  it("uses the local subdomain gateway for the default same-machine node", () => {
    expect(siteDisplayUrl(CIDV1, "local", {})).toBe(`http://${CIDV1}.ipfs.localhost:8080`);
  });
  it("uses the public gateway for a REMOTE node endpoint (its gateway is unknowable)", () => {
    expect(siteDisplayUrl(CIDV1, "local", { nodeRpc: "http://my-pi:5001" })).toBe(
      `https://${CIDV1}.ipfs.dweb.link`,
    );
  });
  it("uses the public dweb.link gateway otherwise", () => {
    expect(siteDisplayUrl(CIDV1, "pinata", {})).toBe(`https://${CIDV1}.ipfs.dweb.link`);
  });
});

describe("node endpoint helpers", () => {
  it("kuboRpcBase defaults and strips trailing slashes", () => {
    expect(kuboRpcBase({})).toBe("http://127.0.0.1:5001");
    expect(kuboRpcBase({ nodeRpc: "  " })).toBe("http://127.0.0.1:5001");
    expect(kuboRpcBase({ nodeRpc: "http://my-pi:5001/" })).toBe("http://my-pi:5001");
  });
  it("isDefaultNodeRpc accepts 127.0.0.1 and localhost, rejects remote", () => {
    expect(isDefaultNodeRpc({})).toBe(true);
    expect(isDefaultNodeRpc({ nodeRpc: "http://localhost:5001" })).toBe(true);
    expect(isDefaultNodeRpc({ nodeRpc: "http://my-pi:5001" })).toBe(false);
  });
});

describe("gatewayLinks", () => {
  it("lists public + provider links, and IPNS only when present", () => {
    const links = gatewayLinks(CIDV1, undefined, "pinata", {});
    const labels = links.map((l) => l.label);
    expect(labels).toContain("dweb.link");
    expect(labels).toContain("w3s.link");
    expect(labels).toContain("Pinata gateway");
    expect(labels).not.toContain("IPNS (stable)");
  });

  it("uses the LOCAL IPNS subdomain link for the local provider", () => {
    const ipns = "k51qzi5uqu5dgja8f9x0h1e0y9pjzqf2m8xg2k4c7bq2d5e6f7g8h9i0j1k2l3";
    const links = gatewayLinks(CIDV1, ipns, "local", {});
    const ipnsLink = links.find((l) => l.label === "IPNS (stable)");
    expect(ipnsLink?.url).toBe(`http://${ipns}.ipns.localhost:8080`);
    expect(links.map((l) => l.label)).toContain("Local gateway");
  });

  it("omits the Local-gateway link and localizes nothing for a remote node", () => {
    const links = gatewayLinks(CIDV1, "k51x", "local", { nodeRpc: "http://my-pi:5001" });
    expect(links.map((l) => l.label)).not.toContain("Local gateway");
    expect(links.find((l) => l.label === "IPNS (stable)")?.url).toBe("https://k51x.ipns.dweb.link");
  });

  it("uses the public IPNS subdomain link for non-local providers", () => {
    const ipns = "k51qzi5uqu5dgja8f9x0h1e0y9pjzqf2m8xg2k4c7bq2d5e6f7g8h9i0j1k2l3";
    const links = gatewayLinks(CIDV1, ipns, "pinata", {});
    expect(links.find((l) => l.label === "IPNS (stable)")?.url).toBe(
      `https://${ipns}.ipns.dweb.link`,
    );
  });
});
