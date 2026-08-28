/**
 * Local Kubo provider — pins the site through the user's own IPFS daemon.
 *
 * RPC-first: the daemon's HTTP RPC on 127.0.0.1:5001 (POST even for reads) does
 * the work, so we never need the on-disk site path or a bundled binary. The
 * `ipfs` CLI is only consulted (kubo-bootstrap.ts) to detect an installed
 * node and start it — never to download one.
 *
 * This provider deliberately does NOT publish IPNS. The site's stable name is
 * owned by one layer only (ipns-identity.ts, keyed on moss's own keystore):
 * the node's keystore holds a DIFFERENT key, so a fallback publish through it
 * would move the site to a permanently different address on any transient
 * failure of the identity path.
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
  UPLOAD_TIMEOUT_MS,
  API_TIMEOUT_MS,
  DAEMON_PROBE_TIMEOUT_MS,
} from "../constants";
import { providerGatewayUrl, kuboRpcBase, isDefaultNodeRpc } from "../gateways";
import { postRaw, postMultipart, toMultipartFiles } from "../http";
import { promptLocalDaemon } from "../setup-panel";
import { bootstrapLocalNode, kuboInstalled } from "../kubo-bootstrap";
import { reportProgress, sleep } from "../utils";

interface KuboAddLine {
  Name: string;
  Hash: string;
  Size?: string;
}

export class LocalProvider implements IpfsProvider {
  readonly id = "local" as const;
  readonly label = "Local Kubo node";

  constructor(private config: IpfsSettings) {}

  private url(path: string): string {
    return `${kuboRpcBase(this.config)}/api/v0${path}`;
  }

  /** Probe the daemon RPC (POST /version). */
  private async daemonReachable(): Promise<boolean> {
    try {
      const res = await postRaw(this.url("/version"), {}, { timeoutMs: DAEMON_PROBE_TIMEOUT_MS });
      return res.ok;
    } catch {
      return false;
    }
  }

  async checkReady(): Promise<ReadyState> {
    if (await this.daemonReachable()) return { ready: true };
    if (!isDefaultNodeRpc(this.config)) {
      return {
        ready: false,
        reason: `No IPFS node answered at ${kuboRpcBase(this.config)} — check that it's running and reachable.`,
      };
    }
    const installed = await kuboInstalled();
    return {
      ready: false,
      reason: installed
        ? "Your IPFS node isn't running."
        : "IPFS (Kubo) isn't installed on this computer yet.",
    };
  }

  async runSetup(): Promise<boolean> {
    // Zero-click first: on the default same-machine endpoint, start an
    // ALREADY-INSTALLED node automatically (never a download — when Kubo is
    // missing, the panel explains and links the installer instead).
    let bootstrapReason: string | undefined;
    if (isDefaultNodeRpc(this.config)) {
      bootstrapReason = await this.tryBootstrap();
      if (bootstrapReason === undefined) return true;
      console.warn(`   Node bootstrap didn't complete: ${bootstrapReason}`);
    }
    // Guidance panel with a Retry that re-probes the RPC each time.
    // Loops until the daemon answers or the user cancels.
    for (;;) {
      const state = await this.checkReady();
      if (state.ready) return true;
      const installed = await kuboInstalled();
      const retry = await promptLocalDaemon({ reason: bootstrapReason ?? state.reason, installed });
      if (!retry) return false;
      bootstrapReason = undefined; // after a manual retry, show fresh probe state
    }
  }

  /** Bootstrap + wait for readiness. Returns undefined on success, else a reason. */
  private async tryBootstrap(): Promise<string | undefined> {
    // A heartbeat keeps the inactivity watchdog fed while the start attempt
    // runs (no event channels under QuickJS for finer-grained progress).
    let statusMessage = "Setting up an IPFS node...";
    const heartbeat = setInterval(() => {
      void reportProgress("setup", 2, 10, statusMessage);
    }, 5000);
    let result;
    try {
      result = await bootstrapLocalNode((message) => {
        statusMessage = message;
        void reportProgress("setup", 2, 10, message);
      });
    } finally {
      clearInterval(heartbeat);
    }
    if (!result.ok) return result.reason ?? "Automatic node setup failed.";
    // Daemon start is detached — poll the RPC until it answers (~45s budget;
    // progress keeps the inactivity watchdog fed).
    for (let i = 0; i < 22; i++) {
      await reportProgress("setup", 2, 10, `Waiting for the IPFS node... (${i + 1}/22)`);
      if (await this.daemonReachable()) return undefined;
      await sleep(2000);
    }
    return "The IPFS node was started but its RPC did not come up in time.";
  }

  async uploadDir(files: SiteFile[], onProgress: UploadProgress): Promise<DeployOutput> {
    const sizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    return { ...(await this.uploadMultipart(files, onProgress)), sizeBytes };
  }

  /** Primary path: /api/v0/add with wrap-with-directory (files at root). */
  private async uploadMultipart(
    files: SiteFile[],
    onProgress: UploadProgress,
  ): Promise<{ cid: string }> {
    onProgress(10, "Adding to local IPFS node...");
    const res = await postMultipart(
      this.url("/add?recursive=true&wrap-with-directory=true&cid-version=1&pin=true&progress=false"),
      { files: toMultipartFiles(files, "file", "") },
      { timeoutMs: UPLOAD_TIMEOUT_MS },
    );
    if (!res.ok) throw new Error(`IPFS add failed (HTTP ${res.status}): ${res.text().slice(0, 200)}`);

    const cid = rootCidFromAddOutput(res.text());
    if (!cid) throw new Error("IPFS add returned no root CID.");
    onProgress(100, "Pinned");
    return { cid };
  }

  /**
   * Verify via the RPC (authoritative and immediate — the content was just
   * added to this very node; no gateway port or propagation involved):
   * /api/v0/ls on the nested path succeeds iff the tree reconstructed.
   */
  async verifyDirectory(cid: string, nestedPath: string): Promise<StructureVerdict> {
    try {
      const arg = encodeURIComponent(`/ipfs/${cid}/${nestedPath}`);
      const res = await postRaw(this.url(`/ls?arg=${arg}`), {}, { timeoutMs: API_TIMEOUT_MS });
      return kuboLsVerdict(res.ok, res.status, res.text());
    } catch {
      return "inconclusive"; // daemon hiccup — not evidence of broken structure
    }
  }

  gatewayUrl(cid: string): string {
    return providerGatewayUrl("local", cid);
  }
}

/**
 * Map a Kubo /ls response to a structure verdict. Kubo answers a missing link
 * with HTTP 500 and a "no link named …" (or "not found") message — that is the
 * definitive broken-structure signal; any other failure is inconclusive.
 */
export function kuboLsVerdict(ok: boolean, status: number, text: string): StructureVerdict {
  if (ok) return "ok";
  const lower = text.toLowerCase();
  if (status === 500 && (lower.includes("no link named") || lower.includes("not found"))) {
    return "broken";
  }
  return "inconclusive";
}

/**
 * Parse Kubo's newline-delimited /add output and return the root directory CID.
 * With wrap-with-directory, the wrapper entry has an empty Name; fall back to
 * the last entry.
 */
export function rootCidFromAddOutput(text: string): string | null {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  const entries: KuboAddLine[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as KuboAddLine);
    } catch {
      // Skip non-JSON progress lines.
    }
  }
  if (entries.length === 0) return null;

  const wrapper = entries.find((e) => e.Name === "");
  return (wrapper ?? entries[entries.length - 1]).Hash ?? null;
}
