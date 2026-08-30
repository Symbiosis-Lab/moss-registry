/**
 * Type definitions for the IPFS Deployer Plugin.
 *
 * Common runtime types (DeployContext, HookResult, DnsTarget, …) come from
 * @symbiosis-lab/moss-api. Everything IPFS-specific is defined here.
 */

// Re-export SDK types for convenience (mirrors github/src/types.ts).
export type {
  DeployContext,
  ConfigureDomainContext,
  HookResult,
  DeploymentInfo,
  ProjectInfo,
  DnsTarget,
  DnsRecord,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// Provider identity
// ============================================================================

export type ProviderId = "pinata" | "local";

// ============================================================================
// Settings (user-owned; read-only for the plugin — see settings.ts)
//
// The Pinata JWT is a declared `secret` setting: moss collects it and holds
// it in the OS keystore; the plugin reads it back via credentials.ts. It
// never appears in the config record hooks receive.
// ============================================================================

export interface IpfsSettings {
  /** Which backend to pin through. */
  provider: ProviderId;
  /** Optional gateway host for View-site links (e.g. "gateway.pinata.cloud"). */
  gateway?: string;
  /** Pin label in the provider dashboard. Defaults to the project's site/folder name, else "moss-site". */
  pinName?: string;
  /** Publish a stable IPNS name pointing at each new CID. */
  useIpns: boolean;
  /**
   * Rewrite root-absolute href/src URLs in HTML to depth-relative ones before
   * upload, so the site renders on path-form gateways too (host/ipfs/<cid>/…).
   */
  relativeUrls: boolean;
  /**
   * Kubo RPC endpoint for the local provider. Empty/absent = the default
   * daemon on this machine (127.0.0.1:5001); set it to publish through an
   * always-on node instead (NAS, Raspberry Pi, VPS).
   */
  nodeRpc?: string;
  /**
   * After a successful deploy, also pin the same CID to the OTHER configured
   * backend (best-effort, never fails the deploy). Both backends produce
   * byte-identical CIDs, so this is pure redundancy under one address.
   */
  coPin?: boolean;
}

// ============================================================================
// Runtime state (plugin-owned, persisted in .moss/plugins/ipfs/state.json)
// ============================================================================

export interface IpfsState {
  /**
   * Whether multipart directory structure has been positively verified against
   * a provider (per provider — the property belongs to the encoder × backend
   * pair). Once true, the per-deploy probe is skipped.
   */
  structureVerified?: Partial<Record<ProviderId, boolean>>;
  /**
   * The site's stable IPNS name, derived from the moss-held plugin key
   * (provider-independent; the same name across providers).
   */
  ipnsName?: string;
  /** Strictly-increasing sequence for IPNS records. Never allowed to go backwards. */
  ipnsSeq?: number;
  /**
   * Whether the LAST deploy actually published an IPNS name (i.e. its DNSLink
   * target was /ipns/…). Distinct from `ipnsName`, which is the stable identity
   * we keep even across a deploy with IPNS toggled off. Lets configure_domain
   * report the right target when it runs without fresh deployment metadata.
   */
  lastUsedIpns?: boolean;
  /** CID of the last successful deploy. */
  lastCid?: string;
  /** Reason the last deploy failed (cleared on the next success). */
  lastDeployError?: string;
}

// ============================================================================
// check_setup wire types
//
// Declared locally because the published moss-api (0.12.0) predates the setup
// contract; structurally identical to the SDK's SetupContext/SetupVerdict, so
// this block becomes a re-export when a release that has them ships.
// ============================================================================

export interface SetupContext {
  /** The plugin's resolved plain settings (declared defaults ∪ saved values). */
  settings?: Record<string, unknown>;
  /** The blocker id the user answered, on a re-invocation. */
  action?: string;
  /** The submitted form values riding with `action`; empty for a button. */
  values?: Record<string, unknown>;
}

export interface SetupForm {
  fields: never[];
  submit: string;
}

export interface SetupBlocker {
  id: string;
  message?: string;
  /** A zero-field form is a button. This plugin never asks for typed input here. */
  form?: SetupForm;
}

export type SetupVerdict =
  | { status: "ready" }
  | { status: "blocked"; blockers: SetupBlocker[] };

// ============================================================================
// Provider I/O
// ============================================================================

/** A single built-site file, ready to upload. `base64` is the raw file bytes. */
export interface SiteFile {
  /** Path relative to the site root, e.g. "assets/app.css". Uses "/" separators. */
  path: string;
  /** File bytes, base64-encoded (straight from readSiteFile). */
  base64: string;
  /** Size in bytes (derived from the base64 payload). */
  size: number;
}

/** Result of pinning a directory to IPFS. */
export interface DeployOutput {
  /** Root directory CID (CIDv1). */
  cid: string;
  /** Stable IPNS name, if IPNS publishing succeeded. */
  ipnsName?: string;
  /** Total bytes pinned. */
  sizeBytes: number;
  /**
   * True when the backend's own upload response already proved the directory
   * reconstructed (e.g. Pinata v3 returns number_of_files + a "directory"
   * mime type). Lets the caller skip the separate structure probe.
   */
  verified?: boolean;
}

/** Whether a provider is ready to deploy, or why not. */
export type ReadyState = { ready: true } | { ready: false; reason: string };

/**
 * Result of verifying that a pinned directory actually reconstructed:
 * - "ok"           — a nested path resolves; the tree is intact.
 * - "broken"       — the content resolves but a nested path is definitively
 *                    missing (multipart filename slashes were not preserved).
 * - "inconclusive" — transport error / rate limit / not yet propagated; says
 *                    nothing about structure. Never treat as "broken".
 */
export type StructureVerdict = "ok" | "broken" | "inconclusive";

/** Progress callback surfaced from a provider upload (0–100). */
export type UploadProgress = (percent: number, message: string) => void;
