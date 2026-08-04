import { describe, it, expect } from "vitest";
import { dnslinkValue, generateDnsTarget } from "../dnslink";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const IPNS = "k51qzi5uqu5dgja8f9x0h1e0y9pjzqf2m8xg2k4c7bq2d5e6f7g8h9i0j1k2l3";

describe("dnslinkValue", () => {
  it("prefers IPNS when available", () => {
    expect(dnslinkValue({ ipnsName: IPNS, cid: CID })).toBe(`dnslink=/ipns/${IPNS}`);
  });
  it("falls back to the CID when IPNS is absent", () => {
    expect(dnslinkValue({ cid: CID })).toBe(`dnslink=/ipfs/${CID}`);
  });
});

describe("generateDnsTarget", () => {
  it("emits a _dnslink TXT (IPNS) plus a DNSLink-gateway CNAME", () => {
    const target = generateDnsTarget({ ipnsName: IPNS, cid: CID });
    const txt = target.records.find((r) => r.record_type === "TXT");
    const cname = target.records.find((r) => r.record_type === "CNAME");
    expect(txt).toEqual({ record_type: "TXT", name: "_dnslink", value: `dnslink=/ipns/${IPNS}` });
    expect(cname).toEqual({ record_type: "CNAME", name: "@", value: "dweb.link" });
  });

  it("uses the CID in the TXT record when IPNS is off", () => {
    const target = generateDnsTarget({ cid: CID });
    const txt = target.records.find((r) => r.record_type === "TXT");
    expect(txt?.value).toBe(`dnslink=/ipfs/${CID}`);
  });
});
