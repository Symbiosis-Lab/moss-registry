/**
 * Zero-click local node bootstrap.
 *
 * "Install Kubo and run `ipfs daemon`" is a developer flow, not a writer flow.
 * When the local provider finds no daemon on the default endpoint, this module
 * makes publishing work anyway: resolve a Kubo binary through moss's unified
 * Rust-side binary resolver (PATH → ~/.moss/bin cache → pinned official
 * download, same mechanism the github plugin uses for portable git), init the
 * repo if needed, start the daemon detached, and wait for the RPC to answer.
 *
 * Everything is best-effort: any failure returns a human reason and the caller
 * falls back to the guidance panel. Windows is guidance-only for now (no `sh`
 * for detached spawning).
 */

import {
  executeBinary,
  getPlatformInfo,
  getTauriCore,
  type BinaryConfig,
  type BinaryResolution,
  type PlatformInfo,
} from "@symbiosis-lab/moss-api";
import { KUBO_VERSION, KUBO_DIST_BASE } from "./constants";

/** Official dist archive per moss platform key. */
const KUBO_ASSETS: Record<string, string> = {
  "darwin-arm64": `kubo_${KUBO_VERSION}_darwin-arm64.tar.gz`,
  "darwin-x64": `kubo_${KUBO_VERSION}_darwin-amd64.tar.gz`,
  "linux-x64": `kubo_${KUBO_VERSION}_linux-amd64.tar.gz`,
};

/** Build the resolver config for Kubo on the given platform (pure; tested). */
export function buildKuboBinaryConfig(platform: PlatformInfo): BinaryConfig | null {
  const asset = KUBO_ASSETS[platform.platformKey];
  if (!asset) return null; // unsupported platform → guidance panel
  return {
    name: "kubo",
    binary_name: "ipfs",
    version_check: { args: ["version", "--number"] },
    sources: {
      [platform.platformKey]: {
        direct_url: `${KUBO_DIST_BASE}/${KUBO_VERSION}/${asset}`,
        archive_format: "tar_gz",
      },
    },
    archive_layout: { binary_path: "kubo/ipfs", executable_dirs: ["kubo"] },
    cache_dir: "kubo",
  };
}

export interface BootstrapResult {
  ok: boolean;
  /** Human reason when ok=false (shown in the guidance panel). */
  reason?: string;
}

/**
 * Resolve a Kubo binary and start a daemon on the default endpoint.
 * Reports progress through `onStatus` (the caller owns progress plumbing).
 * Does NOT wait for the RPC to come up — the caller polls readiness.
 */
export async function bootstrapLocalNode(
  onStatus: (message: string) => void,
): Promise<BootstrapResult> {
  let platform: PlatformInfo;
  try {
    platform = await getPlatformInfo();
  } catch (e) {
    return { ok: false, reason: `Could not detect the platform: ${e instanceof Error ? e.message : e}` };
  }

  const config = buildKuboBinaryConfig(platform);
  if (!config) {
    return {
      ok: false,
      reason: "Automatic node setup isn't supported on this platform yet — install Kubo manually.",
    };
  }

  let binaryPath: string | null = null;

  // 1. An already-installed binary on PATH — the common case, and the only
  //    dependency-free one (plain executeBinary works on every moss build).
  try {
    const onPath = await executeBinary({ binaryPath: "ipfs", args: ["version", "--number"], timeoutMs: 5000 });
    if (onPath.success) binaryPath = "ipfs";
  } catch {
    // Not on PATH — try the host resolver below.
  }

  // 2. Host-side resolver (cache → pinned official download). Invoked via
  //    getTauriCore() — the SDK's resolveBinary wrapper wires a Tauri event
  //    listener for progress, which needs transformCallback and does not exist
  //    in the QuickJS runtime (verified live). Also not all releases register
  //    the command yet (v0.7.21 doesn't — verified live), hence best-effort.
  if (!binaryPath) {
    try {
      onStatus("Downloading an IPFS node...");
      const resolution = await getTauriCore().invoke<BinaryResolution>("resolve_binary_command", {
        config,
        configuredPath: null,
        autoDownload: true,
      });
      binaryPath = resolution.path;
      console.log(`   Kubo resolved via ${resolution.source}: ${binaryPath}`);
    } catch (e) {
      return { ok: false, reason: `Could not get an IPFS node binary: ${e instanceof Error ? e.message : e}` };
    }
  }

  // Init is idempotent-enough: an existing repo makes it fail, which is fine.
  onStatus("Initializing the IPFS node...");
  try {
    await executeBinary({ binaryPath, args: ["init"], timeoutMs: 60_000 });
  } catch {
    // Existing repo or transient failure — the daemon start decides.
  }

  onStatus("Starting the IPFS node...");
  try {
    // Detached spawn: executeBinary would otherwise block on the daemon.
    const started = await executeBinary({
      binaryPath: "/bin/sh",
      args: ["-c", `nohup "${binaryPath}" daemon >/dev/null 2>&1 &`],
      timeoutMs: 10_000,
    });
    if (!started.success) {
      return { ok: false, reason: `Could not start the IPFS daemon: ${started.stderr.slice(0, 200)}` };
    }
  } catch (e) {
    return { ok: false, reason: `Could not start the IPFS daemon: ${e instanceof Error ? e.message : e}` };
  }

  return { ok: true };
}
