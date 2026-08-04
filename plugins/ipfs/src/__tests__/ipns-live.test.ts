/**
 * Live proof of the IPNS record stack: build a record with OUR encoders, sign
 * it with a throwaway ed25519 key (node:crypto standing in for moss's
 * signWithKey — same raw-64-byte signatures), publish it to a REAL local Kubo
 * daemon via /api/v0/routing/put, and resolve the name back to our CID.
 *
 * Kubo validates the signature and record format on put, so a successful
 * round-trip proves name derivation, DAG-CBOR, the ipns-signature: payload,
 * and the protobuf assembly are all byte-correct.
 *
 * Skips (does not fail) when no daemon is reachable — e.g. monorepo CI.
 */
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  ipnsNameFromPublicKey,
  ipnsRecordData,
  ipnsSignablePayload,
  ipnsRecordProtobuf,
} from "../ipns-record";

const RPC = "http://127.0.0.1:5001/api/v0";

async function daemonUp(): Promise<boolean> {
  try {
    const res = await fetch(`${RPC}/version`, { method: "POST", signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const up = await daemonUp();

/** DHT puts need peers; a cold daemon has none for the first seconds. */
async function waitForPeers(maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${RPC}/swarm/peers`, { method: "POST", signal: AbortSignal.timeout(3000) });
      const body = (await res.json()) as { Peers?: unknown[] };
      if ((body.Peers?.length ?? 0) > 0) return true;
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

describe.skipIf(!up)("identity IPNS against a real Kubo daemon", () => {
  it("publishes a plugin-built record and resolves it", async () => {
    // Cold daemons block on DHT puts until connected — wait for peers first.
    expect(await waitForPeers(60_000), "daemon never connected to any peers").toBe(true);

    // Throwaway ed25519 identity (raw public key from the JWK x field).
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" }) as { x: string };
    const rawPub = Uint8Array.from(Buffer.from(jwk.x, "base64url"));
    expect(rawPub.length).toBe(32);

    const name = ipnsNameFromPublicKey(rawPub);
    expect(name).toMatch(/^k51/);

    // Point at a CID this daemon already has (pinned by earlier plugin deploys);
    // any locally-known CID works — resolution just returns the path.
    const target = "/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    const input = {
      value: target,
      sequence: 1n,
      validity: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      ttlNs: 3_600_000_000_000n,
    };
    const data = ipnsRecordData(input);
    const signature = edSign(null, ipnsSignablePayload(data), privateKey);
    const record = ipnsRecordProtobuf(input, data, Uint8Array.from(signature));

    // Publish through the same RPC route the plugin uses.
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(record)]), "record");
    const put = await fetch(
      `${RPC}/routing/put?arg=${encodeURIComponent(`/ipns/${name}`)}`,
      { method: "POST", body: form },
    );
    const putBody = await put.text();
    expect(put.ok, `routing/put rejected our record: ${putBody.slice(0, 300)}`).toBe(true);

    // Resolve the name — Kubo only returns a path if the record validated.
    const resolve = await fetch(
      `${RPC}/name/resolve?arg=${encodeURIComponent(name)}&nocache=true`,
      { method: "POST" },
    );
    const resolved = (await resolve.json()) as { Path?: string };
    expect(resolved.Path).toBe(target);
  }, 180_000); // peer wait + cold-daemon DHT put (measured 30-60s+)
});

describe.runIf(!up)("identity IPNS live test", () => {
  it.skip("skipped: no local Kubo daemon reachable", () => {});
});
