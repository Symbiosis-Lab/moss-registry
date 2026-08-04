/**
 * Endpoints, gateways, and tuning constants for the IPFS Deployer Plugin.
 */

// ---------------------------------------------------------------------------
// Progress heartbeat
// ---------------------------------------------------------------------------

/**
 * Heartbeat interval (ms) used to keep the progress panel alive during long
 * uploads. Must be shorter than the panel's STALE_TIMEOUT_MS (15s).
 */
export const HEARTBEAT_MS = 10_000;

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
// Local Kubo node (RPC on :5001, read-only gateway on :8080)
// ---------------------------------------------------------------------------

/** Default Kubo RPC endpoint; overridable via the node_rpc setting (e.g. a NAS/VPS node). */
export const DEFAULT_KUBO_RPC = "http://127.0.0.1:5001";
/** Kubo release pinned for the zero-click node bootstrap (official dist archives). */
export const KUBO_VERSION = "v0.42.0";
export const KUBO_DIST_BASE = "https://dist.ipfs.tech/kubo";
/**
 * Local gateway host for user-facing links, in SUBDOMAIN form
 * (http://<cid>.ipfs.localhost:8080). moss sites use root-absolute asset/link
 * paths, which only resolve when the site is mounted at the origin root — the
 * path form (127.0.0.1:8080/ipfs/<cid>/) serves unstyled pages with broken
 * navigation (verified live). Kubo serves subdomain requests on localhost out
 * of the box, and browsers resolve *.localhost to loopback.
 */
export const KUBO_SUBDOMAIN_HOST = "localhost:8080";

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

/**
 * Prefix for the per-project Kubo keystore key backing the stable IPNS name.
 * The full name gets a random per-project suffix: the keystore is GLOBAL to
 * the node, so a shared fixed name would let a second project republish the
 * first project's stable URL to its own CID.
 */
export const IPNS_KEY_PREFIX = "moss-site-";

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
// Structure verification (multipart directory reconstruction)
// ---------------------------------------------------------------------------

/** Gateway attempts before calling a structure probe inconclusive. */
export const STRUCTURE_VERIFY_ATTEMPTS = 3;
/** Delay between structure-probe attempts (gateway propagation). */
export const STRUCTURE_VERIFY_DELAY_MS = 3_000;

// ---------------------------------------------------------------------------
// Size guards (bytes)
// ---------------------------------------------------------------------------

/** Warn above this per-file size (base64 buffering gets expensive). */
export const PER_FILE_WARN_BYTES = 100 * 1024 * 1024; // 100 MB
/** Warn above this total site size. */
export const TOTAL_WARN_BYTES = 500 * 1024 * 1024; // 500 MB
