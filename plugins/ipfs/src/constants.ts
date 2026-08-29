/**
 * Endpoints, gateways, and tuning constants for the IPFS Deployer Plugin.
 */

// ---------------------------------------------------------------------------
// Pinata
// ---------------------------------------------------------------------------

/**
 * Pinata v3 Files API. Current API keys are scoped to v3 (the legacy
 * /pinning/pinFileToIPFS endpoint returns NO_SCOPES_FOUND for them —
 * verified live 2026-07). `network=public` pins to public IPFS.
 */
export const PINATA_V3_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
export const PINATA_TEST_AUTH_URL = "https://api.pinata.cloud/data/testAuthentication";
/**
 * Pinata's shared gateway serves assets but 403s text/html (dedicated
 * gateways only) — verified live. Kept for asset links / users with a
 * dedicated gateway configured; never the primary View-site URL.
 */
export const PINATA_DEFAULT_GATEWAY = "gateway.pinata.cloud";

// ---------------------------------------------------------------------------
// Local Kubo node
// ---------------------------------------------------------------------------

/** Default Kubo RPC endpoint; overridable via the node_rpc setting (e.g. a NAS/VPS node). */
export const DEFAULT_KUBO_RPC = "http://127.0.0.1:5001";
// The gateway address is NOT a constant here: it belongs to the node's own
// config and is read from it (kubo-gateway.ts). Kubo's default of 8080 is a
// port moss itself holds, so a constant would be wrong on every machine.

// ---------------------------------------------------------------------------
// Public gateways
// ---------------------------------------------------------------------------

/** DNSLink-resolving public gateway; the default for shareable View-site links. */
export const PUBLIC_GATEWAY_DWEB = "dweb.link";
/** Secondary public gateway (subdomain form; does NOT resolve DNSLink). */
export const PUBLIC_GATEWAY_W3S = "w3s.link";

// ---------------------------------------------------------------------------
// IPNS
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Timeouts (ms)
// ---------------------------------------------------------------------------

export const UPLOAD_TIMEOUT_MS = 300_000;
export const DAEMON_PROBE_TIMEOUT_MS = 2_000;
export const API_TIMEOUT_MS = 30_000;
export const REACHABILITY_TIMEOUT_MS = 15_000;
/**
 * IPNS record publishing does a DHT put — measured 10–60s+ on a real Kubo
 * node (slowest right after daemon start). 30s produced real-world timeouts.
 */
export const IPNS_PUBLISH_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Size guards (bytes)
// ---------------------------------------------------------------------------

/** Warn above this per-file size (base64 buffering gets expensive). */
export const PER_FILE_WARN_BYTES = 100 * 1024 * 1024; // 100 MB
/** Warn above this total site size. */
export const TOTAL_WARN_BYTES = 500 * 1024 * 1024; // 500 MB

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Denominator of every deploy progress report — the last step is "complete". */
export const TOTAL_STEPS = 10;
