/**
 * Identity-backed IPNS: the stable name derives from a key MOSS holds, not
 * from any provider's keystore.
 *
 * Provider-independent by construction: the plugin derives the name from
 * getKey("ipns").publicKey, builds the record (ipns-record.ts), has moss sign
 * it (signWithKey), and publishes the signed bytes through any reachable Kubo
 * RPC (/api/v0/routing/put). Switching Pinata ↔ local — or laptops — keeps the
 * SAME name, because the key travels with the user's moss, not the backend.
 *
 * Availability degrades cleanly: older moss builds without the keystore
 * commands (v0.7.21 ships without them) simply report unavailable and callers
 * fall back to the per-provider IPNS path.
 */

import { getTauriCore } from "@symbiosis-lab/moss-api";
import type { IpfsPluginConfig } from "./types";
import { updateConfig } from "./config";
import { kuboRpcBase } from "./gateways";
import { postMultipart } from "./http";
import { bytesToBase64Js, base64ToBytesJs } from "./relative-urls";
import {
  ipnsNameFromPublicKey,
  ipnsRecordData,
  ipnsSignablePayload,
  ipnsRecordProtobuf,
} from "./ipns-record";
import { IPNS_PUBLISH_TIMEOUT_MS } from "./constants";

/** The plugin-scoped key name backing every project's identity IPNS name. */
const KEY_NAME = "ipns";

// ---------------------------------------------------------------------------
// Keystore wire calls.
//
// These mirror moss-api's keystore.ts (getKey/signWithKey) at the invoke
// level. The published npm SDK (0.10.0) does not export the wrappers yet, so
// — as with resolve_binary_command — the plugin invokes the host commands
// directly and degrades when a build doesn't register them. Switch to the
// official imports once moss-api ships them.
// ---------------------------------------------------------------------------

async function mossKeyPublicKey(name: string, algorithm: "ed25519"): Promise<Uint8Array> {
  const w = await getTauriCore().invoke<{ publicKeyBase64: string }>("key_get_or_create", {
    name,
    algorithm,
  });
  return base64ToBytesJs(w.publicKeyBase64);
}

async function mossSignWithKey(name: string, payload: Uint8Array): Promise<Uint8Array> {
  const res = await getTauriCore().invoke<{ signatureBase64: string }>("key_sign", {
    name,
    payloadBase64: bytesToBase64Js(payload),
  });
  return base64ToBytesJs(res.signatureBase64);
}

/** Record lifetime and TTL (republished on every deploy). */
const RECORD_LIFETIME_MS = 48 * 60 * 60 * 1000;
const RECORD_TTL_NS = 3_600_000_000_000n; // 1h

export interface IdentityPublishResult {
  name: string;
  sequence: bigint;
}

/**
 * The identity IPNS name, or undefined when this moss build has no keystore
 * API. First call creates the key (moss-side, never exported).
 */
export async function identityIpnsName(): Promise<string | undefined> {
  try {
    const publicKey = await mossKeyPublicKey(KEY_NAME, "ed25519");
    return ipnsNameFromPublicKey(publicKey);
  } catch (e) {
    console.log(`   Identity IPNS unavailable (keystore API missing?): ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/**
 * Build, sign, and publish an identity IPNS record pointing at `cid` through
 * the configured Kubo RPC. Returns undefined (never throws) when the keystore
 * API or the node is unavailable — callers fall back to provider IPNS.
 */
export async function publishIdentityIpns(
  cid: string,
  config: IpfsPluginConfig,
): Promise<IdentityPublishResult | undefined> {
  const name = await identityIpnsName();
  if (!name) return undefined;

  try {
    // Strictly-increasing sequence, persisted per project.
    const sequence = BigInt(config.ipnsSeq ?? 0) + 1n;

    const input = {
      value: `/ipfs/${cid}`,
      sequence,
      validity: new Date(Date.now() + RECORD_LIFETIME_MS).toISOString(),
      ttlNs: RECORD_TTL_NS,
    };
    const data = ipnsRecordData(input);
    const signatureV2 = await mossSignWithKey(KEY_NAME, ipnsSignablePayload(data));
    const record = ipnsRecordProtobuf(input, data, signatureV2);

    const res = await postMultipart(
      `${kuboRpcBase(config)}/api/v0/routing/put?arg=${encodeURIComponent(`/ipns/${name}`)}`,
      {
        files: [
          {
            field: "file",
            filename: "record",
            contentType: "application/octet-stream",
            contentBase64: bytesToBase64Js(record),
          },
        ],
      },
      // DHT puts on a cold daemon take 30-60s+ (measured, same as name/publish).
      { timeoutMs: IPNS_PUBLISH_TIMEOUT_MS },
    );
    if (!res.ok) {
      console.warn(`   Identity IPNS publish failed (HTTP ${res.status}): ${res.text().slice(0, 200)}`);
      return undefined;
    }

    await updateConfig({ ipnsSeq: Number(sequence), identityIpnsName: name });
    config.ipnsSeq = Number(sequence);
    config.identityIpnsName = name;
    return { name, sequence };
  } catch (e) {
    console.warn(`   Identity IPNS publish failed: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}
