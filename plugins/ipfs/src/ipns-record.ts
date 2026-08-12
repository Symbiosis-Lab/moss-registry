/**
 * IPNS name derivation and record construction — pure functions, no I/O.
 *
 * With moss's keystore API (getKey/signWithKey), the plugin owns the whole
 * IPNS protocol: derive the name from the ed25519 public key moss holds, build
 * the record bytes, have moss sign them, publish anywhere. moss never needs to
 * know what IPNS is — exactly the keystore model the host intends.
 *
 * Formats implemented here (IPFS specs, verified against a live Kubo node):
 * - IPNS name: base36 "k51…" multibase of a CIDv1 (codec libp2p-key 0x72) whose
 *   multihash is the IDENTITY hash of the libp2p PublicKey protobuf
 *   (ed25519: `08 01 12 20 <32 key bytes>`).
 * - IPNS record: protobuf IpnsEntry carrying a DAG-CBOR `data` map and a V2
 *   signature over "ipns-signature:" + data (ed25519 peer IDs embed the public
 *   key, so the pubKey field is omitted).
 *
 * Everything is QuickJS-safe: no TextEncoder, no web crypto, BigInt only.
 */

import { utf8Encode } from "./relative-urls";

// ---------------------------------------------------------------------------
// Byte plumbing
// ---------------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Protobuf varint (also used for CID prefixes). */
export function varint(value: number | bigint): Uint8Array {
  let v = BigInt(value);
  const out: number[] = [];
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// IPNS name (base36 CIDv1 libp2p-key, identity multihash)
// ---------------------------------------------------------------------------

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function bytesToBase36(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE36[Number(n % 36n)] + out;
    n /= 36n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "0" + out;
  }
  return out;
}

function base36ToBytes(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const v = BigInt(BASE36.indexOf(ch));
    if (v < 0n) throw new Error(`invalid base36 char: ${ch}`);
    n = n * 36n + v;
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "0") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

/** The libp2p PublicKey protobuf for an ed25519 key: 08 01 12 20 <32 bytes>. */
export function libp2pPublicKeyProtobuf(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error(`ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }
  return concat([Uint8Array.from([0x08, 0x01, 0x12, 0x20]), publicKey]);
}

/** Derive the "k51…" IPNS name from a raw 32-byte ed25519 public key. */
export function ipnsNameFromPublicKey(publicKey: Uint8Array): string {
  const keyProto = libp2pPublicKeyProtobuf(publicKey);
  // identity multihash: code 0x00, length, digest = the protobuf itself
  const multihash = concat([Uint8Array.from([0x00, keyProto.length]), keyProto]);
  // CIDv1: version 1, codec libp2p-key (0x72)
  const cid = concat([Uint8Array.from([0x01, 0x72]), multihash]);
  return "k" + bytesToBase36(cid);
}

/** Extract the 32-byte ed25519 public key from a "k51…" name (test round-trips). */
export function publicKeyFromIpnsName(name: string): Uint8Array {
  if (!name.startsWith("k")) throw new Error("expected a base36 multibase name (k…)");
  const cid = base36ToBytes(name.slice(1));
  // 01 72 | 00 24 | 08 01 12 20 | key
  const prefix = [0x01, 0x72, 0x00, 0x24, 0x08, 0x01, 0x12, 0x20];
  for (let i = 0; i < prefix.length; i++) {
    if (cid[i] !== prefix[i]) throw new Error("not an ed25519 libp2p-key CID");
  }
  const key = cid.subarray(prefix.length);
  if (key.length !== 32) throw new Error(`unexpected key length ${key.length}`);
  return Uint8Array.from(key);
}

// ---------------------------------------------------------------------------
// DAG-CBOR (the tiny subset an IPNS record needs, canonical ordering)
// ---------------------------------------------------------------------------

function cborUint(value: bigint): Uint8Array {
  if (value < 0n) throw new Error("negative");
  if (value < 24n) return Uint8Array.from([Number(value)]);
  if (value <= 0xffn) return Uint8Array.from([0x18, Number(value)]);
  if (value <= 0xffffn) return Uint8Array.from([0x19, Number(value >> 8n), Number(value & 0xffn)]);
  if (value <= 0xffffffffn) {
    return Uint8Array.from([
      0x1a,
      Number((value >> 24n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number(value & 0xffn),
    ]);
  }
  const out = [0x1b];
  for (let shift = 56n; shift >= 0n; shift -= 8n) out.push(Number((value >> shift) & 0xffn));
  return Uint8Array.from(out);
}

function cborHeader(majorType: number, length: bigint): Uint8Array {
  const uint = cborUint(length);
  uint[0] |= majorType << 5;
  return uint;
}

function cborBytes(bytes: Uint8Array): Uint8Array {
  return concat([cborHeader(2, BigInt(bytes.length)), bytes]);
}

function cborText(s: string): Uint8Array {
  const bytes = utf8Encode(s);
  return concat([cborHeader(3, BigInt(bytes.length)), bytes]);
}

// ---------------------------------------------------------------------------
// IPNS record
// ---------------------------------------------------------------------------

export interface IpnsRecordInput {
  /** Target path, e.g. "/ipfs/bafy…". */
  value: string;
  /** Strictly-increasing sequence number. */
  sequence: bigint;
  /** Record lifetime end, RFC3339 (e.g. new Date(...).toISOString()). */
  validity: string;
  /** TTL in nanoseconds. */
  ttlNs: bigint;
}

/**
 * The DAG-CBOR `data` field. Canonical key order (length-first, then bytewise):
 * TTL, Value, Sequence, Validity, ValidityType.
 */
export function ipnsRecordData(input: IpnsRecordInput): Uint8Array {
  const value = utf8Encode(input.value);
  const validity = utf8Encode(input.validity);
  return concat([
    Uint8Array.from([0xa5]), // map(5)
    cborText("TTL"),
    cborUint(input.ttlNs),
    cborText("Value"),
    cborBytes(value),
    cborText("Sequence"),
    cborUint(input.sequence),
    cborText("Validity"),
    cborBytes(validity),
    cborText("ValidityType"),
    cborUint(0n), // EOL
  ]);
}

/** The exact bytes moss must sign: "ipns-signature:" ++ data. */
export function ipnsSignablePayload(data: Uint8Array): Uint8Array {
  return concat([utf8Encode("ipns-signature:"), data]);
}

function pbField(fieldNumber: number, wireType: number, payload: Uint8Array): Uint8Array {
  return concat([varint((fieldNumber << 3) | wireType), payload]);
}

function pbBytes(fieldNumber: number, bytes: Uint8Array): Uint8Array {
  return pbField(fieldNumber, 2, concat([varint(bytes.length), bytes]));
}

function pbVarint(fieldNumber: number, value: bigint): Uint8Array {
  return pbField(fieldNumber, 0, varint(value));
}

/**
 * Assemble the wire IpnsEntry protobuf (V2 record). The plaintext fields
 * duplicate `data` — Kubo validates that they match when present. pubKey is
 * omitted: ed25519 peer IDs embed the key.
 */
export function ipnsRecordProtobuf(
  input: IpnsRecordInput,
  data: Uint8Array,
  signatureV2: Uint8Array,
): Uint8Array {
  return concat([
    pbBytes(1, utf8Encode(input.value)), // value
    pbVarint(3, 0n), // validityType = EOL
    pbBytes(4, utf8Encode(input.validity)), // validity
    pbVarint(5, input.sequence), // sequence
    pbVarint(6, input.ttlNs), // ttl
    pbBytes(8, signatureV2), // signatureV2
    pbBytes(9, data), // data
  ]);
}
