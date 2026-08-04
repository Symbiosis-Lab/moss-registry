import { describe, it, expect } from "vitest";
import {
  varint,
  libp2pPublicKeyProtobuf,
  ipnsNameFromPublicKey,
  publicKeyFromIpnsName,
  ipnsRecordData,
  ipnsSignablePayload,
  ipnsRecordProtobuf,
} from "../ipns-record";

/** A REAL IPNS name minted by Kubo during the live deploys of this plugin. */
const LIVE_NAME = "k51qzi5uqu5dkewuynblpxeul5hbuw11s4153bnr795fsunhvmfd02wyww4t7l";

describe("varint", () => {
  it.each([
    [0n, [0x00]],
    [1n, [0x01]],
    [127n, [0x7f]],
    [128n, [0x80, 0x01]],
    [300n, [0xac, 0x02]],
  ])("%s", (value, expected) => {
    expect(Array.from(varint(value))).toEqual(expected);
  });
});

describe("IPNS name derivation", () => {
  it("round-trips a REAL Kubo-minted name exactly", () => {
    const pub = publicKeyFromIpnsName(LIVE_NAME);
    expect(pub.length).toBe(32);
    expect(ipnsNameFromPublicKey(pub)).toBe(LIVE_NAME);
  });

  it("wraps the key in the libp2p protobuf framing", () => {
    const pub = publicKeyFromIpnsName(LIVE_NAME);
    const proto = libp2pPublicKeyProtobuf(pub);
    expect(Array.from(proto.subarray(0, 4))).toEqual([0x08, 0x01, 0x12, 0x20]);
    expect(proto.length).toBe(36);
  });

  it("rejects wrong key sizes and malformed names", () => {
    expect(() => ipnsNameFromPublicKey(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => publicKeyFromIpnsName("bafynotbase36k")).toThrow();
  });
});

describe("IPNS record encoding", () => {
  const input = {
    value: "/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    sequence: 7n,
    validity: "2026-07-25T00:00:00.000Z",
    ttlNs: 3_600_000_000_000n,
  };

  it("produces a canonical 5-entry CBOR map (TTL, Value, Sequence, Validity, ValidityType)", () => {
    const data = ipnsRecordData(input);
    expect(data[0]).toBe(0xa5); // map(5)
    // First key: text(3) "TTL"
    expect(data[1]).toBe(0x63);
    expect(String.fromCharCode(data[2], data[3], data[4])).toBe("TTL");
    // TTL value: uint64 (0x1b) since 1h in ns exceeds uint32
    expect(data[5]).toBe(0x1b);
  });

  it("prefixes the signable payload with ipns-signature:", () => {
    const data = ipnsRecordData(input);
    const payload = ipnsSignablePayload(data);
    expect(String.fromCharCode(...payload.subarray(0, 15))).toBe("ipns-signature:");
    expect(Array.from(payload.subarray(15))).toEqual(Array.from(data));
  });

  it("assembles the protobuf with the expected field tags", () => {
    const data = ipnsRecordData(input);
    const sig = new Uint8Array(64).fill(7);
    const record = ipnsRecordProtobuf(input, data, sig);
    expect(record[0]).toBe(0x0a); // field 1 (value), wire type 2
    // signatureV2 (field 8) and data (field 9) tags present
    const bytes = Array.from(record);
    expect(bytes).toContain(0x42); // 8<<3|2
    expect(bytes).toContain(0x4a); // 9<<3|2
  });
});
