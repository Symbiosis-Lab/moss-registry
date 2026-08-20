/**
 * OnionPress receiver client.
 *
 * Speaks the static-receiver wire contract — `docs/static-publish-protocol.md`
 * in the OnionPress fork — over plain loopback HTTP, using the sanctioned
 * `execute_binary` escape hatch to run `curl` and `tar` — exactly as the github
 * plugin uses `execute_binary` for git. NO moss-api HTTP host-fn is used for
 * the tar upload (moss-api only offers multipart; the receiver reads a raw tar
 * from `php://input`).
 *
 * All commands run with the default working directory (the project root), the
 * same way the github plugin resolves `project_path`: `execute_binary` reads it
 * from the injected internal context. Paths handed to the receiver are therefore
 * project-root-relative (`.moss/build/current`); `/tmp/<genid>.tar` is absolute.
 *
 * @module receiver
 */

import { executeBinary } from "@symbiosis-lab/moss-api";
import {
  RECEIVER_PORTS,
  RECEIVER_API_PATH,
  STATUS_PROBE_TIMEOUT_SECONDS,
  CURRENT_BUILD_PATH,
  REACHABILITY_POLL_TIMEOUT_MS,
  REACHABILITY_POLL_INTERVAL_MS,
} from "./constants";
import type {
  ReceiverStatus,
  ReceiverEndpoint,
  GenerationUploadResponse,
  CommitResponse,
} from "./types";

// ============================================================================
// Small helpers
// ============================================================================

/** Base URL for the receiver REST API on a given loopback port. */
export function baseUrlFor(port: number): string {
  return `http://127.0.0.1:${port}${RECEIVER_API_PATH}`;
}

/**
 * Plugin-generated generation id: `moss-<unix_seconds>`.
 *
 * Monotonic enough for v1; the receiver treats it as an opaque dir name and
 * rejects path-traversal. Injectable clock for deterministic tests.
 */
export function generationId(now: number = Date.now()): string {
  return `moss-${Math.floor(now / 1000)}`;
}

/**
 * Parse a JSON object from raw stdout. Returns null on empty/non-JSON/non-object
 * output (e.g., a curl connection error or a different service answering the port).
 */
function parseJsonObject(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ============================================================================
// 1. Port discovery
// ============================================================================

/**
 * Probe a single port's `/status`. Returns the parsed status when the body is
 * JSON containing `receiver_version`, otherwise null.
 */
async function probeStatus(port: number): Promise<ReceiverStatus | null> {
  const result = await executeBinary({
    binaryPath: "curl",
    args: [
      "-sS",
      "-m",
      String(STATUS_PROBE_TIMEOUT_SECONDS),
      `${baseUrlFor(port)}/status`,
    ],
    workingDir: ".",
    timeoutMs: (STATUS_PROBE_TIMEOUT_SECONDS + 2) * 1000,
    env: {},
  });

  // curl connection-refused / timeout → non-zero exit, empty stdout → skip port.
  if (!result.success) return null;

  return parseReceiverStatusBody(result.stdout);
}

/** Parse a `/status` response body, or null when it isn't a receiver reply. */
function parseReceiverStatusBody(stdout: string): ReceiverStatus | null {
  const body = parseJsonObject(stdout);
  if (!body || typeof body.receiver_version === "undefined" || body.receiver_version === null) {
    return null;
  }

  return {
    onion_address: typeof body.onion_address === "string" ? body.onion_address : "",
    current_generation:
      typeof body.current_generation === "string" ? body.current_generation : null,
    receiver_version: String(body.receiver_version),
    onion_reachable: typeof body.onion_reachable === "boolean" ? body.onion_reachable : null,
    onion_http_code: typeof body.onion_http_code === "string" ? body.onion_http_code : null,
  };
}

/**
 * Re-probe a KNOWN receiver's `/status` (skips port discovery — used after
 * `/commit`, once the receiver is already found, to watch `onion_reachable`
 * resolve). Returns null on the same conditions as {@link probeStatus}.
 */
export async function fetchStatus(baseUrl: string): Promise<ReceiverStatus | null> {
  // Unlike probeStatus (called pre-commit, where a throw aborting the whole
  // deploy is fine), this runs AFTER commit — the site is already live.
  // executeBinary can reject outright (not just resolve success:false), and
  // this is a non-essential confirmation step: any failure here must
  // degrade to "unknown", never surface as a failed publish (moss#917).
  try {
    const result = await executeBinary({
      binaryPath: "curl",
      args: ["-sS", "-m", String(STATUS_PROBE_TIMEOUT_SECONDS), `${baseUrl}/status`],
      workingDir: ".",
      timeoutMs: (STATUS_PROBE_TIMEOUT_SECONDS + 2) * 1000,
      env: {},
    });
    if (!result.success) return null;
    return parseReceiverStatusBody(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Does this receiver's `/status` reply carry `onion_reachable` at all?
 *
 * Receivers older than 1.1 never send the field (moss#917 introduced it) —
 * polling one for up to `REACHABILITY_POLL_TIMEOUT_MS` would just burn the
 * full timeout on every single deploy for no information. Compares
 * major.minor numerically (`"1"` → 1.0, `"1.1"` → 1.1) rather than string
 * equality, since the receiver's own version scheme isn't guaranteed to stay
 * two components long.
 */
export function receiverSupportsReachability(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((n) => parseInt(n, 10) || 0);
  return major > 1 || (major === 1 && minor >= 1);
}

/**
 * Does this receiver accept the v1.2 multipart carrier on `POST /generation`?
 *
 * A receiver older than 1.2 only understands a raw `application/x-tar` body —
 * sending it a multipart part instead would upload nothing (`$request->get_body()`
 * on a multipart request is empty). A missing/unparseable `receiver_version`
 * (e.g. `/status` didn't reply, or some future non-numeric scheme) is treated as
 * legacy: this is the client's fallback default, not the receiver's.
 */
export function receiverSupportsMultipartUpload(version: string | undefined | null): boolean {
  if (!version) return false;
  const parts = version.split(".").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return false;
  const [major = 0, minor = 0] = parts;
  return major > 1 || (major === 1 && minor >= 2);
}

/** Outcome of {@link waitForReachability}. */
export interface ReachabilityOutcome {
  /** `null` when the poll window elapsed without the receiver resolving it —
   * treat exactly like "unknown", never like "confirmed unreachable". */
  reachable: boolean | null;
  httpCode: string | null;
}

/**
 * Poll a known receiver's `/status` until `onion_reachable` resolves to a
 * real boolean, or the timeout elapses (moss#917).
 *
 * `/commit` only confirms the local containers came up — the receiver's own
 * dual-probe Tor-network check runs on its health-poll cycle and can lag a
 * few seconds behind. This waits (bounded) for that check to actually land
 * rather than showing "Published" on local health alone.
 *
 * Deps are injectable so tests can drive this without real timers or a real
 * receiver — same pattern as `generationId`'s injectable clock.
 */
export async function waitForReachability(
  baseUrl: string,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    fetchStatusFn?: (baseUrl: string) => Promise<ReceiverStatus | null>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<ReachabilityOutcome> {
  const {
    timeoutMs = REACHABILITY_POLL_TIMEOUT_MS,
    intervalMs = REACHABILITY_POLL_INTERVAL_MS,
    fetchStatusFn = fetchStatus,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = opts;

  const deadline = now() + timeoutMs;
  let last: ReceiverStatus | null = null;
  while (true) {
    last = await fetchStatusFn(baseUrl);
    if (last && last.onion_reachable !== null) {
      return { reachable: last.onion_reachable, httpCode: last.onion_http_code };
    }
    if (now() >= deadline) break;
    await sleep(intervalMs);
  }
  return { reachable: last?.onion_reachable ?? null, httpCode: last?.onion_http_code ?? null };
}

/**
 * Discover a running OnionPress receiver by probing the contract's ports in
 * order. The FIRST port whose `/status` returns a JSON body containing
 * `receiver_version` wins. Returns null when no port responds — the caller
 * should tell the user to start OnionPress.
 */
export async function discoverReceiver(
  ports: readonly number[] = RECEIVER_PORTS,
): Promise<ReceiverEndpoint | null> {
  for (const port of ports) {
    const status = await probeStatus(port);
    if (status) {
      return { port, baseUrl: baseUrlFor(port), status };
    }
  }
  return null;
}

// ============================================================================
// 2. Pack the sealed generation
// ============================================================================

/**
 * Environment for the packing `tar`.
 *
 * `COPYFILE_DISABLE=1` is load-bearing. On macOS `tar` is Apple's bsdtar, which
 * defaults to `--mac-metadata` in create mode: for every entry carrying an
 * extended attribute it emits a second AppleDouble member named `._<name>`
 * holding the serialized xattrs. Every file moss writes under
 * `.moss/build/current` carries `com.apple.provenance`, so this doubles the
 * archive — `._index.html`, `._assets`, `._robots.txt`, … Apple's tar silently
 * re-absorbs those members when it extracts, which is why the archive looks
 * clean locally; the receiver unpacks with PHP `PharData` on Linux, which has no
 * such special case and lands them as real junk files in the published site.
 *
 * The env var (rather than `--no-mac-metadata`) is what we can set portably:
 * OnionPress deploys also run from Linux, where GNU tar has no such flag but
 * harmlessly ignores the variable.
 */
const PACK_ENV: Record<string, string> = { COPYFILE_DISABLE: "1" };

/**
 * Tar the current generation's CONTENTS to `/tmp/<genId>.tar`.
 *
 * `tar -cf <tar> -C <buildPath> .` follows the `current` symlink, so the archive
 * holds files like `index.html`, `assets/…` at tar root — the shape the receiver
 * extracts via `PharData`.
 *
 * @returns absolute path to the created tar.
 * @throws if tar fails (e.g., missing `current` symlink — build first).
 */
export async function packGeneration(
  genId: string,
  buildPath: string = CURRENT_BUILD_PATH,
): Promise<string> {
  const tarPath = `/tmp/${genId}.tar`;
  const result = await executeBinary({
    binaryPath: "tar",
    args: ["-cf", tarPath, "-C", buildPath, "."],
    workingDir: ".",
    timeoutMs: 300_000, // 5 min — large media generations can be slow to archive
    env: PACK_ENV,
  });
  if (!result.success) {
    throw new Error(
      `Could not package the built site. Run a build first, then Publish again. (${result.stderr.trim()})`,
    );
  }
  return tarPath;
}

// ============================================================================
// 3. Upload the tar
// ============================================================================

/**
 * `POST /generation?id=<genId>`, carrier chosen by the receiver's advertised
 * version (from `/status`, see {@link receiverSupportsMultipartUpload}):
 *
 *  - `>= 1.2`: multipart/form-data, tar in a part named `tar` (`curl -F`).
 *    curl sets its own boundary in the `Content-Type` header — do not
 *    override it, or the receiver can't parse the parts.
 *  - otherwise: the legacy raw body upload, unchanged.
 *
 * Throws when curl fails or the receiver replies `ok:false` — this ABORTS the
 * deploy before `/commit`, so a rejected/partial upload is never committed.
 */
export async function uploadGeneration(
  baseUrl: string,
  genId: string,
  tarPath: string,
  receiverVersion?: string | null,
): Promise<void> {
  const args = receiverSupportsMultipartUpload(receiverVersion)
    ? ["-sS", "-X", "POST", "-F", `tar=@${tarPath}`, `${baseUrl}/generation?id=${genId}`]
    : [
        "-sS",
        "-X",
        "POST",
        "--data-binary",
        `@${tarPath}`,
        "-H",
        "Content-Type: application/x-tar",
        `${baseUrl}/generation?id=${genId}`,
      ];

  const result = await executeBinary({
    binaryPath: "curl",
    args,
    workingDir: ".",
    timeoutMs: 300_000,
    env: {},
  });

  if (!result.success) {
    throw new Error(`Upload to OnionPress failed: ${result.stderr.trim() || "curl error"}`);
  }

  const body = parseJsonObject(result.stdout) as GenerationUploadResponse | null;
  if (!body || body.ok !== true) {
    throw new Error(
      `OnionPress rejected the upload: ${(body && body.error) || result.stdout.trim() || "unknown error"}`,
    );
  }
}

// ============================================================================
// 4. Commit (atomic flip)
// ============================================================================

/**
 * `POST /commit` with `{ generation: <genId> }`. On success the receiver flips
 * `site/current` to the new generation and returns `{ ok:true, url }`.
 * Throws when curl fails or `ok !== true` / no url.
 */
export async function commitGeneration(baseUrl: string, genId: string): Promise<CommitResponse> {
  const result = await executeBinary({
    binaryPath: "curl",
    args: [
      "-sS",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify({ generation: genId }),
      `${baseUrl}/commit`,
    ],
    workingDir: ".",
    timeoutMs: 60_000,
    env: {},
  });

  if (!result.success) {
    throw new Error(`OnionPress commit failed: ${result.stderr.trim() || "curl error"}`);
  }

  const body = parseJsonObject(result.stdout) as CommitResponse | null;
  if (!body || body.ok !== true || !body.url) {
    throw new Error(
      `OnionPress did not confirm the publish: ${(body && body.error) || result.stdout.trim() || "unknown error"}`,
    );
  }

  return { ok: true, url: body.url };
}

// ============================================================================
// 5. Cleanup
// ============================================================================

/**
 * Remove the temporary tar. Best-effort: never throws — a leftover tar in /tmp
 * must not fail an otherwise-successful deploy.
 */
export async function cleanupTar(tarPath: string): Promise<void> {
  try {
    await executeBinary({
      binaryPath: "rm",
      args: ["-f", tarPath],
      workingDir: ".",
      timeoutMs: 10_000,
      env: {},
    });
  } catch {
    // ignore — cleanup is non-fatal
  }
}
