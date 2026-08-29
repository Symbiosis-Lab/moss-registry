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
 *
 * It also owns the setup conversation for this backend (`checkSetup`) — start
 * the node, move a taken gateway port — so the publish gate and the deploy
 * guard decide readiness from one place rather than two wordings of it.
 */

import type { SetupNeed, SetupVerdict } from "@symbiosis-lab/moss-api";
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
import {
  bootstrapLocalNode,
  describeDaemonFailure,
  diagnoseDaemon,
  kuboInstalled,
} from "../kubo-bootstrap";
import { setGatewayPort, findFreeGatewayPort } from "../kubo-gateway";
import { sleep } from "../utils";

/** Start the user's IPFS node. Carries the consent line moss shows first. */
export const START_DAEMON_ACTION = "start_daemon";
/**
 * Move the node's gateway off a port something else already holds. The port
 * offered is part of the id (`change_port:8081`) so the number on the button
 * is the number that gets written — a second scan at click time could return
 * a different one, and nothing would tell the user it had changed.
 */
export const CHANGE_PORT_ACTION = "change_port";

/**
 * Said before the click, not after it: starting a daemon on someone's computer
 * is theirs to agree to, and these are the three facts they cannot discover
 * afterwards.
 */
const DAEMON_CONSENT =
  "It keeps running after you quit moss — that is what keeps your site reachable. " +
  "It does not start again by itself after you restart your computer. " +
  "To stop it: quit IPFS Desktop, or run `ipfs shutdown` in Terminal.";

/** How long to wait for a just-started daemon to answer its RPC. */
const DAEMON_START_POLLS = 22;
const DAEMON_START_POLL_MS = 2000;

/** Why an automatic start did not produce a reachable daemon. */
interface FailedStart {
  reason: string;
  /** Present when the failure is a taken gateway port we could move off. */
  portOffer?: { taken: number; suggested: number };
}

function notReady(need: SetupNeed): SetupVerdict {
  return { ready: false, needs: [need] };
}

/** The port a `change_port:<n>` click carries, or null for any other action. */
function portFromAction(action: string | undefined): number | null {
  const prefix = `${CHANGE_PORT_ACTION}:`;
  if (!action?.startsWith(prefix)) return null;
  const port = Number(action.slice(prefix.length));
  return Number.isInteger(port) && port > 0 ? port : null;
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

  /**
   * The deploy-time guard, which is the setup gate's own verdict read as a
   * yes/no. One decision tree, so a headless publish can never disagree with
   * what the modal said.
   */
  async checkReady(): Promise<ReadyState> {
    const verdict = await this.checkSetup();
    return verdict.ready
      ? { ready: true }
      : { ready: false, reason: verdict.needs?.[0]?.message ?? "Your IPFS node isn't ready." };
  }

  /**
   * Is the user's own node up — and if the last click asked us to fix
   * something, did that work?
   *
   * The wait is the host's to bound, not ours: moss suspends its watchdog
   * while a hook is in a host call and offers Cancel, so the poll in
   * `startNode` is allowed to take as long as a DHT-warming daemon takes.
   */
  async checkSetup(action?: string): Promise<SetupVerdict> {
    let attempt: FailedStart | undefined;

    const port = portFromAction(action);
    if (port !== null) {
      attempt = (await setGatewayPort(port))
        ? await this.startNode()
        : { reason: "moss could not change the gateway port in your IPFS node's configuration." };
    } else if (action === START_DAEMON_ACTION) {
      attempt = await this.startNode();
    }

    if (await this.daemonReachable()) return { ready: true };

    // A node somewhere else on the network is not ours to start or diagnose.
    if (!isDefaultNodeRpc(this.config)) {
      return notReady({
        id: "node_unreachable",
        message:
          `No IPFS node answered at ${kuboRpcBase(this.config)}. Check that it is running and ` +
          `reachable from this computer, or clear the Node RPC Endpoint setting to use ` +
          `the node on this machine.`,
      });
    }

    if (attempt?.portOffer) {
      const { taken, suggested } = attempt.portOffer;
      return notReady({
        id: "gateway_port",
        message:
          `Your IPFS node's gateway is set to port ${taken}, which another program on this ` +
          `computer is already using, so the node stops as soon as it starts.`,
        actions: [
          {
            id: `${CHANGE_PORT_ACTION}:${suggested}`,
            label: `Use port ${suggested}`,
            consent:
              "This edits your IPFS node's own configuration. Nothing else about it changes.",
          },
        ],
      });
    }

    if (!(await kuboInstalled())) {
      return notReady({
        id: "kubo_missing",
        message:
          "Publishing through your own node needs IPFS installed on this computer. The " +
          "easiest way is IPFS Desktop (https://docs.ipfs.tech/install/ipfs-desktop/) — " +
          "install it, open it once, then publish again. Prefer a hosted option? Switch " +
          "this plugin's provider to Pinata in its settings.",
      });
    }

    return notReady({
      id: "daemon_stopped",
      message: attempt?.reason ?? "IPFS is installed on this computer, but it isn't running.",
      actions: [{ id: START_DAEMON_ACTION, label: "Start IPFS", consent: DAEMON_CONSENT }],
    });
  }

  /**
   * Start the node and watch it come up. Returns undefined once the RPC
   * answers, else why it did not.
   *
   * The spawn is detached, so its exit status proves nothing — a shell that
   * forked successfully exits 0 whether or not the daemon lives half a second
   * later. Hence the poll, and then the daemon's own log.
   */
  private async startNode(): Promise<FailedStart | undefined> {
    const result = await bootstrapLocalNode(() => {});

    if (!result.ok) {
      const reason = result.reason ?? "Automatic node setup failed.";
      if (result.gatewayPortTaken === undefined) return { reason };
      const suggested = await findFreeGatewayPort();
      return suggested === null
        ? { reason }
        : { reason, portOffer: { taken: result.gatewayPortTaken, suggested } };
    }

    for (let i = 0; i < DAEMON_START_POLLS; i++) {
      if (await this.daemonReachable()) return undefined;
      await sleep(DAEMON_START_POLL_MS);
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
