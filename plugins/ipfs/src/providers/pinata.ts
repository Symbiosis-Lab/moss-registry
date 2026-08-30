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
 * Auth: the JWT is a declared `secret` setting moss collects and stores;
 * check_setup (setup.ts) pre-validates it via GET /data/testAuthentication and
 * rejects a stale one so moss re-asks. checkReady here is the headless gate —
 * it reports, never prompts. Transport failures don't block; the authenticated
 * upload is the final arbiter.
 */

import type { IpfsProvider } from "./types";
import type {
  IpfsSettings,
  SiteFile,
  DeployOutput,
  ReadyState,
  StructureVerdict,
  UploadProgress,
} from "../types";
import {
  PINATA_V3_UPLOAD_URL,
  PINATA_TEST_AUTH_URL,
  UPLOAD_TIMEOUT_MS,
  API_TIMEOUT_MS,
} from "../constants";
import { getPinataJwt } from "../credentials";
import {
  postMultipart,
  parseJson,
  toMultipartFiles,
  getWithHeaders,
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

  async checkReady(): Promise<ReadyState> {
    const jwt = await getPinataJwt();
    if (!jwt) {
      return { ready: false, reason: "Connect a Pinata account to publish to IPFS." };
    }
    // Pre-flight: catch a stale JWT BEFORE a long upload. Transport failures
    // (status 0 / 5xx) don't block.
    const res = await getWithHeaders(PINATA_TEST_AUTH_URL, this.authHeaders(jwt), API_TIMEOUT_MS);
    if (isAuthStatus(res.status)) {
      return { ready: false, reason: "Your Pinata token was rejected — publish again to enter a new one." };
    }
    return { ready: true };
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
    if (!jwt) throw new Error("Pinata API token not available — set it in the plugin's settings.");
    return jwt;
  }

  private throwIfAuthFailed(res: HttpResponse): void {
    if (isAuthStatus(res.status)) {
      // The next publish's check_setup re-tests the stored token, rejects it,
      // and moss re-asks — no cleanup to do mid-deploy.
      throw new Error(
        `Pinata authentication failed (HTTP ${res.status}). Publish again to enter a new token.`,
      );
    }
  }
}
