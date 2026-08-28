import { describe, it, expect } from "vitest";
import { dnslinkValue, generateDnsTarget } from "../dnslink";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

describe("dnslinkValue", () => {
  it("points at the deploy's CID", () => {
    expect(dnslinkValue({ cid: CID })).toBe(`dnslink=/ipfs/${CID}`);
  });
});

describe("generateDnsTarget", () => {
  it("emits a _dnslink TXT plus a DNSLink-gateway CNAME", () => {
    const target = generateDnsTarget({ cid: CID });
    expect(target.records.find((r) => r.record_type === "TXT")).toEqual({
      record_type: "TXT",
      name: "_dnslink",
      value: `dnslink=/ipfs/${CID}`,
    });
    expect(target.records.find((r) => r.record_type === "CNAME")).toEqual({
      record_type: "CNAME",
      name: "@",
      value: "dweb.link",
    });
  });

  it("never targets /ipns/ — those records expire 48h after the publish", () => {
    // The plugin publishes an IPNS record only during a deploy and nothing
    // republishes it, so a domain pointed at /ipns/ goes dark two days later
    // for anyone publishing less often than that.
    const value = generateDnsTarget({ cid: CID }).records[0].value;
    expect(value).not.toContain("/ipns/");
  });
});
