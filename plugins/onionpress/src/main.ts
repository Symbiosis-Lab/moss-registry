/**
 * OnionPress Deployer Plugin
 *
 * Publishes a moss site to a locally-running OnionPress receiver, which serves
 * it as a Tor onion service. The deploy hook:
 *   1. Discovers the receiver by probing loopback ports for `/status`.
 *   2. Tars the sealed generation (`.moss/build/current`).
 *   3. Uploads the tar to `POST /generation`.
 *   4. Commits it via `POST /commit` (atomic flip) and reads back the onion URL.
 *   5. Cleans up the temporary tar.
 *
 * Transport is plain loopback HTTP via the sanctioned `execute_binary`
 * (`curl` + `tar`) — the same escape hatch the github plugin uses for git.
 * See `docs/static-publish-protocol.md` (in the OnionPress fork) for the full wire contract.
 */

import type { DeployContext, HookResult } from "./types";
import {
  discoverReceiver,
  generationId,
  packGeneration,
  uploadGeneration,
  commitGeneration,
  cleanupTar,
  waitForReachability,
  receiverSupportsReachability,
} from "./receiver";
import { setCurrentHookName, reportProgress, reportError } from "./utils";
import { classifyLiveness } from "./liveness";

// This hook raises no toasts. moss owns every status surface (see moss's
// docs/reference/plugin-architecture-boundary.md: the task/progress UI is
// moss's; hooks must survive without a UI) — the hook describes its outcome
// in `HookResult.toast` and returns evidence in `deployment.metadata`, and
// moss's publish-verdict pipeline renders checking/live/failed from there.
// The SDK-toast era ended 2026-08-17: a plugin-raised "Checking whether your
// site is live…" toast survived two app-side redesigns of this exact surface
// because it lived on the wrong side of the boundary.

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * deploy hook — publish the current generation to a local OnionPress receiver.
 */
async function deploy(_context: DeployContext): Promise<HookResult> {
  setCurrentHookName("deploy");

  console.log("OnionPress Deployer: Starting deployment...");

  // ── 1. Discover the receiver ────────────────────────────────────────────
  await reportProgress("configuring", 1, 10, "Looking for OnionPress...");
  const endpoint = await discoverReceiver();
  if (!endpoint) {
    const message =
      "No running OnionPress found. Start OnionPress on this machine, then Publish again.";
    await reportError(message, "deploy", true);
    console.error("OnionPress Deployer: no receiver on any known port");
    return {
      success: false,
      message,
      toast: { outcome: "error", title: "Start OnionPress first, then Publish again." },
    };
  }
  console.log(`   Receiver found on port ${endpoint.port} (v${endpoint.status.receiver_version})`);

  const genId = generationId();
  let tarPath: string | undefined;

  // Each step reports once, when it starts. moss counts a host call in flight
  // as activity (ADR-072), so the tar and the upload keep the publish alive by
  // being the work — nothing has to be said on a timer.
  try {
    // ── 2. Pack the sealed generation ─────────────────────────────────────
    await reportProgress("deploying", 3, 10, "Packing your site...");
    tarPath = await packGeneration(genId);

    // ── 3. Upload (aborts before commit on any failure) ───────────────────
    await reportProgress("deploying", 6, 10, "Uploading to OnionPress...");
    await uploadGeneration(endpoint.baseUrl, genId, tarPath, endpoint.status.receiver_version);

    // ── 4. Commit — atomic flip, returns the onion URL ────────────────────
    await reportProgress("deploying", 9, 10, "Publishing...");
    const commit = await commitGeneration(endpoint.baseUrl, genId);
    const onionUrl = commit.url as string;
    const onionAddress = endpoint.status.onion_address || hostFromUrl(onionUrl);

    // ── 5. Confirm actual reachability, don't just trust local health ─────
    // `/commit` only means the local containers came up. When the hidden-
    // service descriptor isn't fresh, OnionHeaven's hub 302s visitors to a
    // Wayback mirror that (for a brand-new site) has nothing archived —
    // "Published" seconds before "not archived yet" (moss#917). Wait
    // (bounded) for the receiver's own dual-probe reachability check to
    // actually resolve before claiming the site is live.
    // Skip the poll entirely against a receiver that predates onion_reachable
    // (< 1.1) — it will never resolve, so waiting would just burn the full
    // timeout on every deploy for no information.
    let reachable: boolean | null = null;
    let httpCode: string | null = null;
    if (receiverSupportsReachability(endpoint.status.receiver_version)) {
      await reportProgress("deploying", 9, 10, "Confirming it's reachable on Tor...");
      ({ reachable, httpCode } = await waitForReachability(endpoint.baseUrl));
    }

    await reportProgress("complete", 10, 10, "Published!");

    // One verdict, never a prediction. `checking` is its own answer — the
    // poll window here is deliberately shorter than descriptor publication
    // usually takes, because stalling the publish UI to wait for it would be
    // worse. moss keeps watching after this returns and settles the verdict
    // there — see `system/stack_serving.rs` and ADR-050, which is also why
    // "not live" can honestly say moss is still working on it.
    const verdict = classifyLiveness(reachable, httpCode);
    console.log(`   Published: ${onionUrl} (${verdict}${httpCode ? `, ${httpCode}` : ""})`);

    // No toast on success, deliberately — even for `live`. Post-upload status
    // belongs to moss's verdict pipeline (advisory while checking, one final
    // toast at alive-or-failed), which keeps watching after this returns and
    // has strictly better evidence than this bounded poll. A toast raised
    // here would race that surface with a weaker answer.
    return {
      success: true,
      message:
        verdict === "live"
          ? `Your site is live on Tor at ${onionUrl}`
          : `Published to ${onionUrl}`,
      deployment: {
        method: "onionpress",
        url: onionUrl,
        deployed_at: new Date().toISOString(),
        metadata: {
          onion_address: onionAddress,
          generation: genId,
          port: String(endpoint.port),
          receiver_version: endpoint.status.receiver_version,
          onion_reachable: reachable === null ? "unknown" : String(reachable),
          liveness: verdict,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportError(message, "deploy", true);
    console.error(`OnionPress Deployer: Failed - ${message}`);
    return {
      success: false,
      message,
      toast: {
        outcome: "error",
        title: message.length > 60 ? message.slice(0, 60) + "..." : message,
      },
    };
  } finally {
    if (tarPath) {
      await cleanupTar(tarPath);
    }
  }
}

/** Extract the host from an http(s) URL without throwing on malformed input. */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

const OnionpressPlugin = {
  deploy,
};

// Register plugin globally for the plugin runtime
(window as unknown as { OnionpressPlugin: typeof OnionpressPlugin }).OnionpressPlugin =
  OnionpressPlugin;

// Also export for module usage
export { deploy, deploy as on_deploy };
export default OnionpressPlugin;
