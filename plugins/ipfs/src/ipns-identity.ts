/**
 * Identity-backed IPNS: the stable name derives from a key MOSS holds, not
 * from any provider's keystore. This is the site's ONLY IPNS owner.
 *
 * The plugin derives the name from getKey("ipns").publicKey, builds the record
 * (ipns-record.ts), has moss sign it (signWithKey), and publishes the signed
 * bytes through the configured Kubo RPC (/api/v0/routing/put). Switching
 * Pinata ↔ local keeps the SAME name, because the key belongs to the user's
 * moss, not to a backend.
 *
 * Failures are reported, never worked around: publishing under some other key
 * would change the site's permanent address. The keystore commands this needs
 * ship in moss v0.7.23, which is the manifest's `min_moss_version`, so their
 * absence is a broken host rather than a supported configuration.
 */

import { getKey, signWithKey } from "@symbiosis-lab/moss-api";
import type { IpfsSettings } from "./types";
import { getState, updateState } from "./state";
import { kuboRpcBase } from "./gateways";
import { postMultipart } from "./http";
import { bytesToBase64Js } from "./relative-urls";
import {
  ipnsNameFromPublicKey,
  ipnsRecordData,
  ipnsSignablePayload,
  ipnsRecordProtobuf,
} from "./ipns-record";
import { IPNS_PUBLISH_TIMEOUT_MS } from "./constants";

/** The plugin-scoped key name backing every project's identity IPNS name. */
const KEY_NAME = "ipns";

/** Record lifetime and TTL (republished on every deploy). */
const RECORD_LIFETIME_MS = 48 * 60 * 60 * 1000;
const RECORD_TTL_NS = 3_600_000_000_000n; // 1h

export interface IdentityPublishResult {
  name: string;
  sequence: bigint;
}

/** Why a publish attempt did not happen. Callers surface this verbatim. */
export interface IdentityPublishFailure {
  reason: string;
}

export type IdentityPublishOutcome = IdentityPublishResult | IdentityPublishFailure;

export function isPublished(o: IdentityPublishOutcome): o is IdentityPublishResult {
  return "name" in o;
}

/**
 * Build, sign, and publish the site's IPNS record pointing at `cid` through
 * the configured Kubo RPC. Never throws: returns either the published name and
 * sequence, or the reason it failed.
 */
export async function publishIdentityIpns(
  cid: string,
  settings: IpfsSettings,
): Promise<IdentityPublishOutcome> {
  let name: string;
  try {
    const key = await getKey(KEY_NAME, "ed25519");
    name = ipnsNameFromPublicKey(key.publicKey);
  } catch (e) {
    return {
      reason: `moss could not provide the IPNS signing key: ${errText(e)}`,
    };
  }

  try {
    // Strictly increasing, and never restarted from zero: a record whose
    // sequence does not exceed the last published one is ignored by every
    // node, which would freeze the site at its previous CID.
    const state = await getState();
    const sequence = BigInt(state.ipnsSeq ?? 0) + 1n;

    const input = {
      value: `/ipfs/${cid}`,
      sequence,
      validity: new Date(Date.now() + RECORD_LIFETIME_MS).toISOString(),
      ttlNs: RECORD_TTL_NS,
    };
    const data = ipnsRecordData(input);
    const signatureV2 = await signWithKey(KEY_NAME, ipnsSignablePayload(data));
    const record = ipnsRecordProtobuf(input, data, signatureV2);

    const res = await postMultipart(
      `${kuboRpcBase(settings)}/api/v0/routing/put?arg=${encodeURIComponent(`/ipns/${name}`)}`,
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
      return {
        reason: `the IPFS node rejected the IPNS record (HTTP ${res.status}): ${res.text().slice(0, 200)}`,
      };
    }

    await updateState({ ipnsSeq: Number(sequence), ipnsName: name });
    return { name, sequence };
  } catch (e) {
    return { reason: `publishing the IPNS record failed: ${errText(e)}` };
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
