/**
 * Pinata provider — pins the site through Pinata's v3 Files API (JWT auth).
 *
 * Everything here was verified against the live API (2026-07):
 * - Current API keys are v3-scoped; the legacy /pinning/pinFileToIPFS endpoint
 *   answers NO_SCOPES_FOUND for them, so v3 is the only target.
 * - A multi-part upload whose filenames share a "site/" prefix returns ONE
 *   directory CID (prefix stripped: files resolve at <cid>/<path>), and the
 *   response carries number_of_files + mime_type "directory" — which proves the
 *   tree reconstructed, so no separate gateway probe is needed.
 * - CAR archives are stored as opaque blobs (NOT imported as DAGs) — one of
 *   the reasons the plugin has no CAR path; a structure failure fails the
 *   deploy loudly instead of silently shipping a broken site.
 * - Pinata has no IPNS API (all v3 IPNS routes 404) — publishIpns is absent and
 *   the deploy surfaces that honestly. Stable names need the local node or the
 *   planned identity-derived IPNS keys.
 *
 * Auth: moss holds the JWT (ADR-072) and this provider only reads it. A token
 * Pinata refuses is reported back with rejectSecret, so moss asks the user for
 * a new one instead of handing over the dead one again.
 */

import type { SetupVerdict } from "@symbiosis-lab/moss-api";
import type { IpfsProvider } from "./types";
import type {
  IpfsSettings,
  SiteFile,
  DeployOutput,
  ReadyState,
  StructureVerdict,
  UploadProgress,
} from "../types";
import { API_TIMEOUT_MS, PINATA_TEST_AUTH_URL, PINATA_V3_UPLOAD_URL, UPLOAD_TIMEOUT_MS } from "../constants";
import { getPinataJwt, rejectPinataJwt } from "../credentials";
import {
  getWithHeaders,
  postMultipart,
  parseJson,
  toMultipartFiles,
  type HttpResponse,
} from "../http";

interface PinataV3UploadResponse {
  data?: {
    id?: string;
    cid?: string;
    size?: number;
    number_of_files?: number;
    mime_type?: string;
  };
}

/** True for HTTP auth-failure statuses. */
function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export class PinataProvider implements IpfsProvider {
  readonly id = "pinata" as const;
  readonly label = "Pinata";

  /** Structure evidence from the last upload response (per verifyDirectory). */
  private lastUploadVerified: boolean | undefined;

  constructor(private config: IpfsSettings) {}

  private authHeaders(jwt: string): Record<string, string> {
    return { Authorization: `Bearer ${jwt}` };
  }

  /**
   * Does moss hold a token for us? Whether Pinata still ACCEPTS it is
   * `check_setup`'s question (setup.ts), asked on the Publish click; asking it
   * again here would spend a round trip on every deploy to learn the same
   * thing.
   */
  async checkReady(): Promise<ReadyState> {
    return (await getPinataJwt())
      ? { ready: true }
      : { ready: false, reason: "Connect a Pinata account to publish to IPFS." };
  }

  /**
   * Is the token moss holds one Pinata still accepts?
   *
   * A rejection is reported to moss (`rejectSecret`) before the need goes
   * back, so the store is empty by the time the user clicks Publish again —
   * otherwise moss would offer the dead token forever. A transport failure is
   * NOT a rejection: an auth status is the only arbiter.
   *
   * No action accompanies either need. moss collects the credential it
   * declared (`contributes.deploy_target.setup.credentials`) in its own modal
   * on the next Publish click; a button here could only re-probe, and would
   * hand back this same need every time.
   */
  async checkSetup(_action?: string): Promise<SetupVerdict> {
    const jwt = await getPinataJwt();
    if (!jwt) {
      return {
        ready: false,
        needs: [
          {
            id: "pinata_token",
            message:
              "moss has no Pinata token for this site yet. Pinata is what keeps your site " +
              "online after your own computer sleeps. Publish again and moss will ask for one.",
          },
        ],
      };
    }

    const res = await getWithHeaders(
      PINATA_TEST_AUTH_URL,
      this.authHeaders(jwt),
      API_TIMEOUT_MS,
    );
    if (!isAuthStatus(res.status)) return { ready: true };

    await rejectPinataJwt();
    return {
      ready: false,
      needs: [
        {
          id: "pinata_token",
          message:
            "Pinata refused the token moss had — it was probably revoked or has expired. " +
            "Create a new one at https://app.pinata.cloud, then publish again: moss will " +
            "ask for it and keep the new one instead.",
        },
      ],
    };
  }

  async uploadDir(files: SiteFile[], onProgress: UploadProgress): Promise<DeployOutput> {
    const jwt = await this.requireJwt();
    onProgress(10, "Uploading to Pinata...");

    const body = {
      textFields: [
        { name: "network", value: "public" },
        { name: "name", value: this.pinName() },
      ],
      // Shared "site/" prefix → ONE directory CID; Pinata strips the prefix so
      // files resolve at <cid>/<relativePath> (verified live).
      files: toMultipartFiles(files, "file", "site"),
    };

    const res = await postMultipart(PINATA_V3_UPLOAD_URL, body, {
      headers: this.authHeaders(jwt),
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    this.throwIfAuthFailed(res);

    const data = parseJson<PinataV3UploadResponse>(res).data ?? {};
    if (!data.cid) {
      throw new Error("Pinata upload returned no CID.");
    }

    // The response itself proves (or disproves) directory reconstruction.
    this.lastUploadVerified =
      files.length === 1
        ? true // single-file sites have no structure to lose
        : data.mime_type === "directory" && data.number_of_files === files.length;

    onProgress(100, "Pinned");
    return {
      cid: data.cid,
      sizeBytes: data.size ?? 0,
      verified: this.lastUploadVerified,
    };
  }

  /**
   * Structure verification from the upload response (authoritative and
   * instant — no gateway involved; the shared Pinata gateway 403s HTML, so
   * gateway probing is unreliable here anyway).
   */
  async verifyDirectory(_cid: string, _nestedPath: string): Promise<StructureVerdict> {
    if (this.lastUploadVerified === true) return "ok";
    if (this.lastUploadVerified === false) return "broken";
    return "inconclusive";
  }

  // No publishIpns: Pinata has no IPNS API (verified live — all routes 404).
  // IPNS has one owner anyway (ipns-identity.ts), which publishes through a
  // Kubo RPC regardless of which backend holds the bytes.

  // --- helpers ---

  private pinName(): string {
    return this.config.pinName && this.config.pinName.trim().length > 0
      ? this.config.pinName.trim()
      : "moss-site";
  }

  private async requireJwt(): Promise<string> {
    const jwt = await getPinataJwt();
    if (!jwt) throw new Error("Pinata JWT not available. Please connect Pinata.");
    return jwt;
  }

  private throwIfAuthFailed(res: HttpResponse): void {
    if (isAuthStatus(res.status)) {
      // Tell moss the token is dead, or it offers the same one forever.
      void rejectPinataJwt();
      throw new Error(`Pinata authentication failed (HTTP ${res.status}).`);
    }
  }
}
