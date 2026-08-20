/**
 * Plugin-specific type definitions for the OnionPress Deployer Plugin.
 *
 * Common types (DeployContext, HookResult, DeploymentInfo, etc.) are imported
 * from @symbiosis-lab/moss-api. The receiver wire shapes below mirror
 * `docs/static-publish-protocol.md` (in the OnionPress fork).
 */

// Re-export SDK types for convenience
export type {
  DeployContext,
  HookResult,
  DeploymentInfo,
  ProjectInfo,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// OnionPress receiver wire shapes (docs/static-publish-protocol.md in the fork)
// ============================================================================

/**
 * Body of `GET /status` (200).
 *
 * `onion_address` is read by the receiver from `/var/lib/onionpress/onion_address`.
 * `current_generation` is `basename(readlink(site/current))` or null.
 * `receiver_version` presence is the signal that this port is an OnionPress
 * receiver (used for port discovery).
 */
export interface ReceiverStatus {
  onion_address: string;
  current_generation: string | null;
  receiver_version: string;
  /**
   * Whether the site is reachable through the live Tor network right now
   * (moss#917), from the receiver's own dual-probe health check — distinct
   * from a successful `/commit`, which only confirms local container
   * health. `null` while unknown: a receiver older than 1.1 omits the field
   * entirely, or the health check hasn't completed a cycle since the last
   * commit yet. `null` must never be read as "confirmed unreachable" — only
   * `false` means that.
   */
  onion_reachable: boolean | null;
  /** The code behind `onion_reachable` (HTTP status, `"takeover"`, or a
   * curl-failure sentinel like `"000:rc=28"`), for diagnostics/logging. */
  onion_http_code: string | null;
}

/**
 * A discovered, live receiver: the port it answered on, its API base URL, and
 * the `/status` payload it returned.
 */
export interface ReceiverEndpoint {
  /** Port the receiver answered `/status` on. */
  port: number;
  /** `http://127.0.0.1:<port>/wp-json/onionpress/v1` */
  baseUrl: string;
  /** Parsed `/status` body. */
  status: ReceiverStatus;
}

/** Body of `POST /generation?id=<genid>`. */
export interface GenerationUploadResponse {
  ok: boolean;
  generation?: string;
  error?: string;
}

/** Body of `POST /commit`. */
export interface CommitResponse {
  ok: boolean;
  /** `http://<onion_address>/` on success. */
  url?: string;
  error?: string;
}
