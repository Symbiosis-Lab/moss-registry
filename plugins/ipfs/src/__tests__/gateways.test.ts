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
  IPNS_RECORD_NOTE,
} from "../gateways";

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
  it("prefers a configured custom gateway (path form) for the CID", () => {
    expect(siteDisplayUrl(CIDV1, { gateway: "g.example" })).toBe(
      `https://g.example/ipfs/${CIDV1}`,
    );
  });
  it("uses the public dweb.link gateway when nothing else is set", () => {
    expect(siteDisplayUrl(CIDV1, {})).toBe(`https://${CIDV1}.ipfs.dweb.link`);
  });
  it("never returns a local/private url for a local-node deploy — that door is a row, not the standing address", () => {
    // Regression: this used to be `http://<cid>.ipfs.localhost:<port>` for a
    // local node whose gateway was known.
    expect(siteDisplayUrl(CIDV1, {})).not.toMatch(/localhost|127\.0\.0\.1/);
  });
  it("prefers the IPNS name, through the public door, once one is published", () => {
    expect(siteDisplayUrl(CIDV1, {}, { ipnsName: "k51x" })).toBe(
      "https://k51x.ipns.dweb.link",
    );
  });
  it("prefers a DNSLink domain over the IPNS name and the CID", () => {
    expect(siteDisplayUrl(CIDV1, {}, { ipnsName: "k51x", domain: "example.com" })).toBe(
      "https://example.com",
    );
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
  const local = {
    cid: CIDV1,
    ipnsName: "k51x",
    provider: "local" as const,
    config: {},
    localHost: "localhost:8081",
    localOnly: true,
  };

  it("emits exactly four rows for a local node, in order: IPNS name, CID, Local gateway", () => {
    const rows = deployAddresses(local);
    expect(rows.map((a) => a.label)).toEqual(["IPNS name", "CID", "Local gateway"]);
    expect(rows.map((a) => a.kind)).toEqual(["ipns", "cid", "gateway"]);
  });

  it("emits exactly three rows for Pinata: no local gateway", () => {
    const rows = deployAddresses({ ...local, provider: "pinata" as const });
    expect(rows.map((a) => a.label)).toEqual(["IPNS name", "CID", "Pinata gateway"]);
  });

  it("gives the IPNS name both a copy value and an open url through the public door", () => {
    const ipns = deployAddresses(local).find((a) => a.kind === "ipns");
    expect(ipns?.value).toBe("k51x");
    expect(ipns?.url).toBe("https://k51x.ipns.dweb.link");
    expect(ipns?.note).toBe(IPNS_RECORD_NOTE);
  });

  it("gives the CID both a copy value and an open url through the public door", () => {
    const cid = deployAddresses(local).find((a) => a.kind === "cid");
    expect(cid?.value).toBe(CIDV1);
    expect(cid?.url).toBe(`https://${CIDV1}.ipfs.dweb.link`);
    expect(cid?.note).toBe("Names exactly this version");
  });

  it("omits the IPNS row entirely when the publish had no name", () => {
    const rows = deployAddresses({ ...local, ipnsName: undefined });
    expect(rows.map((a) => a.label)).not.toContain("IPNS name");
    expect(rows.map((a) => a.label)).toEqual(["CID", "Local gateway"]);
  });

  it("offers no gateway row at all when the local node's gateway port is unknown", () => {
    // Never a guess: Kubo's default 8080 is moss's own preview-server port, so
    // a hardcoded local link lands on moss's refusal page (observed live).
    const rows = deployAddresses({ ...local, localHost: undefined });
    expect(rows.map((a) => a.kind)).toEqual(["ipns", "cid"]);
  });

  it("offers no gateway row for a remote local-provider node (its gateway is unknowable)", () => {
    const rows = deployAddresses({ ...local, config: { nodeRpc: "http://my-pi:5001" } });
    expect(rows.map((a) => a.kind)).toEqual(["ipns", "cid"]);
  });

  it("notes the node dependency on the Local gateway row, and only there", () => {
    const rows = deployAddresses(local);
    expect(rows.find((a) => a.label === "Local gateway")?.note).toMatch(/only while it runs/);
    const otherNotes = rows.filter((a) => a.label !== "Local gateway").map((a) => a.note);
    expect(otherNotes.some((n) => n && /only while it runs/.test(n))).toBe(false);
  });

  it("drops the Local-gateway note when a co-pin keeps the site up without this machine", () => {
    const rows = deployAddresses({ ...local, localOnly: false });
    expect(rows.find((a) => a.label === "Local gateway")?.note).toBeUndefined();
  });

  it("leads with a custom domain when one is configured", () => {
    const rows = deployAddresses({ ...local, domain: "example.com" });
    expect(rows[0]).toEqual({ kind: "domain", label: "Custom domain", url: "https://example.com" });
  });

  it("gives every gateway-kind row a url and no copy value", () => {
    for (const row of deployAddresses(local).filter((a) => a.kind === "gateway")) {
      expect(row.url).toMatch(/^https?:\/\//);
      expect(row.value).toBeUndefined();
    }
  });
});
