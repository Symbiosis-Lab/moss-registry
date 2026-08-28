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
 * The spawn is OBSERVED. A backgrounded `nohup … &` exits successfully the
 * instant the fork succeeds, so the shell's exit code says nothing about the
 * daemon: it reports success just as loudly when the daemon dies half a second
 * later because its gateway port was taken. We therefore keep the pid and the
 * daemon's stderr, and a failure to come up is explained from those, never
 * from the spawn's own status. Windows is guidance-only for now (no `sh`).
 */

import { executeBinary, getPlatformInfo } from "@symbiosis-lab/moss-api";
import { gatewayAddrFromBinary, portFromMultiaddr, portIsFree } from "./kubo-gateway";

export interface DaemonHandle {
  /** Process id of the spawned daemon. */
  pid: number;
  /** File the daemon's stdout+stderr is being appended to. */
  logPath: string;
}

export interface BootstrapResult {
  ok: boolean;
  /** Whether an ipfs binary exists on PATH (drives the panel copy). */
  installed: boolean;
  /** Human reason when ok=false (shown in the guidance panel). */
  reason?: string;
  /**
   * Set when the node's configured gateway port is already taken. The caller
   * offers to move the gateway — with the user's consent, since it edits their
   * node's config.
   */
  gatewayPortTaken?: number;
  /** Set when ok — what to ask about if the RPC never comes up. */
  daemon?: DaemonHandle;
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
 * Parse the spawn script's output: the pid on the first line, the resolved log
 * path on the second. Either missing means we cannot observe the daemon.
 */
export function parseSpawnOutput(stdout: string): DaemonHandle | null {
  const [pidLine, pathLine] = stdout.trim().split("\n").map((l) => l.trim());
  const pid = Number(pidLine);
  if (!Number.isInteger(pid) || pid <= 0 || !pathLine) return null;
  return { pid, logPath: pathLine };
}

/** What the daemon was doing when we last looked. */
export interface DaemonDiagnosis {
  alive: boolean;
  /** Tail of the daemon's own output; empty when it wrote nothing. */
  log: string;
}

/** Ask the OS whether the daemon is still running, and read what it said. */
export async function diagnoseDaemon(handle: DaemonHandle): Promise<DaemonDiagnosis> {
  try {
    const res = await executeBinary({
      binaryPath: "/bin/sh",
      args: [
        "-c",
        `if kill -0 ${handle.pid} 2>/dev/null; then echo ALIVE; else echo DEAD; fi; ` +
          `tail -c 2000 '${handle.logPath}' 2>/dev/null`,
      ],
      timeoutMs: 10_000,
    });
    const out = (res.stdout ?? "").split("\n");
    return { alive: out[0]?.trim() === "ALIVE", log: out.slice(1).join("\n").trim() };
  } catch {
    return { alive: false, log: "" };
  }
}

/**
 * Why the daemon never answered, in the user's terms. The daemon's own last
 * words are the message whenever it left any: "started but did not come up in
 * time" describes our waiting, not their problem.
 */
export function describeDaemonFailure(diagnosis: DaemonDiagnosis | null): string {
  if (!diagnosis) {
    return "The IPFS node was started but never answered, and moss could not tell why.";
  }
  const lastWords = diagnosis.log
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-3)
    .join(" ");
  if (!diagnosis.alive) {
    return lastWords
      ? `The IPFS node quit right after starting: ${lastWords}`
      : "The IPFS node quit right after starting, without saying why.";
  }
  return lastWords
    ? `The IPFS node is running but is not answering yet: ${lastWords}`
    : "The IPFS node is running but has not started answering yet.";
}

/**
 * Start a daemon from an already-installed Kubo. Reports progress through
 * `onStatus`. Does NOT wait for the RPC to come up — the caller polls
 * readiness, and asks `diagnoseDaemon` when that fails. Never downloads.
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

  // The daemon binds its gateway before it serves anything; if that port is
  // taken it exits seconds later. Ask first, so the answer is a sentence
  // instead of a timeout. moss's preview server holds 8080 — Kubo's default.
  const gatewayAddr = await gatewayAddrFromBinary();
  const gatewayPort = gatewayAddr ? portFromMultiaddr(gatewayAddr) : null;
  if (gatewayPort !== null && !(await portIsFree(gatewayPort))) {
    return {
      ok: false,
      installed: true,
      gatewayPortTaken: gatewayPort,
      reason:
        `Your IPFS node wants port ${gatewayPort} for its gateway, but another program on ` +
        `this computer already has it${gatewayPort === 8080 ? " (moss's own preview server uses 8080)" : ""}.`,
    };
  }

  onStatus("Starting your IPFS node...");
  try {
    // Detached spawn: executeBinary would otherwise block on the daemon. The
    // script prints the pid and the log path so the caller can come back and
    // ask what happened — the shell's own exit code is the fork's, not the
    // daemon's, and is treated as no evidence either way.
    const started = await executeBinary({
      binaryPath: "/bin/sh",
      args: [
        "-c",
        'log="${TMPDIR:-/tmp}/moss-ipfs-daemon.log"; : >"$log"; ' +
          'nohup ipfs daemon >>"$log" 2>&1 & echo "$!"; echo "$log"',
      ],
      timeoutMs: 10_000,
    });
    const daemon = parseSpawnOutput(started.stdout ?? "");
    if (!daemon) {
      return {
        ok: false,
        installed: true,
        reason: `Could not start the IPFS daemon: ${(started.stderr || "no process was created").slice(0, 200)}`,
      };
    }
    return { ok: true, installed: true, daemon };
  } catch (e) {
    return {
      ok: false,
      installed: true,
      reason: `Could not start the IPFS daemon: ${e instanceof Error ? e.message : e}`,
    };
  }
}
