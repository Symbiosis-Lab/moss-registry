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
 * Auth: checkReady() pre-validates the JWT via GET /data/testAuthentication
 * (works for v3-scoped keys). A rejected token is cleared so setup re-prompts;
 * transport failures don't block — the authenticated upload is the final
 * arbiter.
 */

import type { IpfsProvider } from "./types";
import type {
  IpfsPluginConfig,
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
import { getPinataJwt, storePinataJwt, clearPinataJwt } from "../credentials";
import { promptPinataJwt } from "../setup-panel";
import { providerGatewayUrl } from "../gateways";
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

  constructor(private config: IpfsPluginConfig) {}

  private authHeaders(jwt: string): Record<string, string> {
    return { Authorization: `Bearer ${jwt}` };
  }

  async checkReady(): Promise<ReadyState> {
    const jwt = await getPinataJwt();
    if (!jwt) {
      return { ready: false, reason: "Connect a Pinata account to publish to IPFS." };
    }
    // Pre-flight: validate the token so a stale JWT re-prompts BEFORE a long
    // upload. Transport failures (status 0 / 5xx) don't block.
    const res = await getWithHeaders(PINATA_TEST_AUTH_URL, this.authHeaders(jwt), API_TIMEOUT_MS);
    if (isAuthStatus(res.status)) {
      await clearPinataJwt();
      return { ready: false, reason: "Your Pinata token was rejected — reconnect Pinata." };
    }
    return { ready: true };
  }

  async runSetup(): Promise<boolean> {
    const jwt = await promptPinataJwt();
    if (!jwt) return false;
    await storePinataJwt(jwt);
    return true;
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
  // The deploy flow surfaces this and points at the local provider / DNSLink.

  gatewayUrl(cid: string): string {
    return providerGatewayUrl("pinata", cid, this.config.gateway);
  }

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
      // A rejected JWT is useless — clear it so the next deploy re-prompts.
      void clearPinataJwt();
      throw new Error(`Pinata authentication failed (HTTP ${res.status}).`);
    }
  }
}
