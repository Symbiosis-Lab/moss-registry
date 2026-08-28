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
import { kuboRpcBase, isDefaultNodeRpc } from "../gateways";
import { postRaw, postMultipart, toMultipartFiles } from "../http";
import { promptLocalDaemon, promptDaemonConsent, type GatewayPortOffer } from "../setup-panel";
import {
  bootstrapLocalNode,
  kuboInstalled,
  diagnoseDaemon,
  describeDaemonFailure,
} from "../kubo-bootstrap";
import { findFreeGatewayPort, setGatewayPort } from "../kubo-gateway";
import { getState, updateState } from "../state";
import { reportProgress, sleep } from "../utils";

/** Why an automatic start did not produce a reachable daemon. */
interface FailedStart {
  reason: string;
  /** Present when the failure is a taken gateway port we could move off. */
  portOffer?: GatewayPortOffer;
}

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
    // One automatic start attempt per user decision: the first pass tries it,
    // and each explicit Retry earns another. `pending` carries what the last
    // attempt found, so the panel shows the daemon's own reason.
    let mayAutoStart = isDefaultNodeRpc(this.config);
    let pending: FailedStart | undefined;

    for (;;) {
      const state = await this.checkReady();
      if (state.ready) return true;
      const installed = await kuboInstalled();

      if (mayAutoStart && installed) {
        mayAutoStart = false;
        if (await this.consentToRunADaemon()) {
          pending = await this.tryBootstrap();
          if (!pending) return true;
          console.warn(`   Node bootstrap didn't complete: ${pending.reason}`);
        }
      }

      const choice = await promptLocalDaemon({
        reason: pending?.reason ?? state.reason,
        installed,
        portOffer: pending?.portOffer,
      });
      if (choice === "cancel") return false;
      if (choice === "change-port" && pending?.portOffer) {
        if (!(await setGatewayPort(pending.portOffer.suggested))) {
          pending = { reason: "moss could not change the gateway port in your IPFS config." };
          continue;
        }
      }
      pending = undefined;
      mayAutoStart = isDefaultNodeRpc(this.config);
    }
  }

  /**
   * Consent to moss running a background daemon on this computer, asked once
   * per project and remembered in the plugin's own state.
   */
  private async consentToRunADaemon(): Promise<boolean> {
    if ((await getState()).daemonConsentAt) return true;
    if (!(await promptDaemonConsent())) return false;
    await updateState({ daemonConsentAt: new Date().toISOString() });
    return true;
  }

  /** Bootstrap + wait for readiness. Returns undefined on success, else why not. */
  private async tryBootstrap(): Promise<FailedStart | undefined> {
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

    if (!result.ok) {
      const reason = result.reason ?? "Automatic node setup failed.";
      if (result.gatewayPortTaken === undefined) return { reason };
      const suggested = await findFreeGatewayPort();
      return suggested === null
        ? { reason }
        : { reason, portOffer: { taken: result.gatewayPortTaken, suggested } };
    }

    // The spawn is detached, so its exit status proves nothing — poll the RPC
    // (~45s budget), then ask the process itself what went wrong.
    for (let i = 0; i < 22; i++) {
      await reportProgress("setup", 2, 10, `Waiting for the IPFS node... (${i + 1}/22)`);
      if (await this.daemonReachable()) return undefined;
      await sleep(2000);
    }
    const diagnosis = result.daemon ? await diagnoseDaemon(result.daemon) : null;
    return { reason: describeDaemonFailure(diagnosis) };
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
