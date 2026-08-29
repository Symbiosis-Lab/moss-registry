import { describe, it, expect } from "vitest";
import {
  isCidV1,
  subdomainCidUrl,
  pathCidUrl,
  bestCidUrl,
  pinataGatewayUrl,
  localGatewayCidUrl,
  siteDisplayUrl,
  deployAddresses,
  kuboRpcBase,
  isDefaultNodeRpc,
} from "../gateways";
import type { IpfsSettings } from "../types";

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

describe("provider gateway URLs", () => {
  it("uses the Pinata gateway (path form) by default", () => {
    expect(pinataGatewayUrl(CIDV1)).toBe(`https://gateway.pinata.cloud/ipfs/${CIDV1}`);
  });
  it("uses a custom Pinata gateway when set", () => {
    expect(pinataGatewayUrl(CIDV1, "my.mypinata.cloud")).toBe(
      `https://my.mypinata.cloud/ipfs/${CIDV1}`,
    );
  });
  it("builds the local gateway link in SUBDOMAIN form on the node's own port", () => {
    // Path form would break moss's root-absolute asset/link paths.
    expect(localGatewayCidUrl(CIDV1, "localhost:8081")).toBe(`http://${CIDV1}.ipfs.localhost:8081`);
  });
});

describe("siteDisplayUrl", () => {
  it("prefers a configured custom gateway (path form)", () => {
    expect(siteDisplayUrl(CIDV1, "pinata", { gateway: "g.example" })).toBe(
      `https://g.example/ipfs/${CIDV1}`,
    );
  });
  it("uses the local gateway the node reported for the default same-machine node", () => {
    expect(siteDisplayUrl(CIDV1, "local", {}, "localhost:8081")).toBe(
      `http://${CIDV1}.ipfs.localhost:8081`,
    );
  });
  it("falls back to the public gateway when the node's gateway port is unknown", () => {
    // Never a guess: Kubo's default 8080 is moss's own preview-server port, so
    // a hardcoded local link lands on moss's refusal page (observed live).
    expect(siteDisplayUrl(CIDV1, "local", {}, undefined)).toBe(
      `https://${CIDV1}.ipfs.dweb.link`,
    );
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

describe("deployAddresses", () => {
  const kinds = (list: ReturnType<typeof deployAddresses>) => list.map((a) => a.kind);
  const labels = (list: ReturnType<typeof deployAddresses>) => list.map((a) => a.label);

  it("gives the CID as a value to copy, never a link", () => {
    const [first] = deployAddresses({ cid: CIDV1, provider: "pinata", config: {} as IpfsSettings });
    expect(first.kind).toBe("cid");
    expect(first.value).toBe(CIDV1);
    expect(first.url).toBeUndefined();
  });

  it("lists public + provider gateways, and IPNS only when there is a name", () => {
    const list = deployAddresses({ cid: CIDV1, provider: "pinata", config: {} as IpfsSettings });
    expect(labels(list)).toContain("dweb.link");
    expect(labels(list)).toContain("w3s.link");
    expect(labels(list)).toContain("Pinata gateway");
    expect(kinds(list)).not.toContain("ipns");
  });

  it("gives the IPNS name as a copyable ipns address beside its gateway link", () => {
    const ipns = "k51qzi5uqu5dgja8f9x0h1e0y9pjzqf2m8xg2k4c7bq2d5e6f7g8h9i0j1k2l3";
    const list = deployAddresses({
      cid: CIDV1,
      ipnsName: ipns,
      provider: "local",
      config: {} as IpfsSettings,
      localHost: "localhost:8081",
    });
    const name = list.find((a) => a.kind === "ipns");
    expect(name?.value).toBe(ipns);
    expect(name?.url).toBeUndefined();
    expect(list.find((a) => a.label === "IPNS (stable)")?.url).toBe(
      `http://${ipns}.ipns.localhost:8081`,
    );
    expect(labels(list)).toContain("Local gateway");
  });

  it("offers no local gateway at all when the node's gateway port is unknown", () => {
    const list = deployAddresses({
      cid: CIDV1,
      ipnsName: "k51x",
      provider: "local",
      config: {} as IpfsSettings,
    });
    expect(labels(list)).not.toContain("Local gateway");
    expect(list.find((a) => a.label === "IPNS (stable)")?.url).toBe("https://k51x.ipns.dweb.link");
  });

  it("omits the Local-gateway link and localizes nothing for a remote node", () => {
    const list = deployAddresses({
      cid: CIDV1,
      ipnsName: "k51x",
      provider: "local",
      config: { nodeRpc: "http://my-pi:5001" } as IpfsSettings,
    });
    expect(labels(list)).not.toContain("Local gateway");
    expect(list.find((a) => a.label === "IPNS (stable)")?.url).toBe("https://k51x.ipns.dweb.link");
  });

  it("emits a configured custom domain as its own domain address", () => {
    const list = deployAddresses({
      cid: CIDV1,
      provider: "pinata",
      config: {} as IpfsSettings,
      domain: "example.com",
    });
    const domain = list.find((a) => a.kind === "domain");
    expect(domain?.url).toBe("https://example.com");
  });
});
