/**
 * Zero-click local node bootstrap — for nodes that are already installed.
 *
 * When the local provider finds no daemon on the default endpoint, this module
 * detects an installed Kubo (`executeBinary("ipfs", ["version"])` — the only
 * plugin-facing capability for this), initializes its repo if needed, and
 * starts the daemon detached so publishing just works.
 *
 * It deliberately does NOT download anything: plugins cannot reach the host's
 * binary resolver (not a plugin-facing command), and a silent binary download
 * would be wrong for moss's users anyway. When Kubo isn't installed, the
 * caller shows an in-app explanation with an install link (setup-panel.ts) —
 * the user decides.
 *
 * Everything is best-effort: any failure returns a human reason and the caller
 * falls back to the guidance panel. Windows is guidance-only for now (no `sh`
 * for detached spawning).
 */

import { executeBinary, getPlatformInfo } from "@symbiosis-lab/moss-api";

export interface BootstrapResult {
  ok: boolean;
  /** Whether an ipfs binary exists on PATH (drives the panel copy). */
  installed: boolean;
  /** Human reason when ok=false (shown in the guidance panel). */
  reason?: string;
}

/** True when a Kubo binary answers on PATH. */
export async function kuboInstalled(): Promise<boolean> {
  try {
    const res = await executeBinary({ binaryPath: "ipfs", args: ["version", "--number"], timeoutMs: 5000 });
    return !!res.success;
  } catch {
    return false;
  }
}

/**
 * Start a daemon from an already-installed Kubo. Reports progress through
 * `onStatus`. Does NOT wait for the RPC to come up — the caller polls
 * readiness. Never downloads anything.
 */
export async function bootstrapLocalNode(
  onStatus: (message: string) => void,
): Promise<BootstrapResult> {
  if (!(await kuboInstalled())) {
    return {
      ok: false,
      installed: false,
      reason: "IPFS (Kubo) isn't installed on this computer yet.",
    };
  }

  try {
    const platform = await getPlatformInfo();
    if (platform.os === "windows") {
      return {
        ok: false,
        installed: true,
        reason: "Automatic start isn't supported on Windows yet — start your IPFS node, then retry.",
      };
    }
  } catch {
    // Platform detection failing shouldn't block the attempt on unix-likes.
  }

  // Init is idempotent-enough: an existing repo makes it fail, which is fine.
  onStatus("Preparing your IPFS node...");
  try {
    await executeBinary({ binaryPath: "ipfs", args: ["init"], timeoutMs: 60_000 });
  } catch {
    // Existing repo or transient failure — the daemon start decides.
  }

  onStatus("Starting your IPFS node...");
  try {
    // Detached spawn: executeBinary would otherwise block on the daemon.
    const started = await executeBinary({
      binaryPath: "/bin/sh",
      args: ["-c", `nohup ipfs daemon >/dev/null 2>&1 &`],
      timeoutMs: 10_000,
    });
    if (!started.success) {
      return {
        ok: false,
        installed: true,
        reason: `Could not start the IPFS daemon: ${started.stderr.slice(0, 200)}`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      installed: true,
      reason: `Could not start the IPFS daemon: ${e instanceof Error ? e.message : e}`,
    };
  }

  return { ok: true, installed: true };
}
