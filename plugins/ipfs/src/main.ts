/**
 * IPFS Deployer Plugin
 *
 * Publishes a moss site to IPFS and returns a shareable gateway URL. Two
 * backends (Pinata, local Kubo) sit behind one provider interface; the deploy
 * flow is provider-agnostic. Optionally publishes a stable IPNS name and emits a
 * DNSLink DnsTarget for custom domains.
 *
 * Upload strategy: one multipart directory request (the host's encoder
 * preserves directory paths in filenames — verified at the wire). On the first
 * deploy against a provider we verify the tree actually reconstructed (nested
 * path resolves) and cache the result per provider; a CONFIRMED broken
 * structure fails the deploy loudly — never a silent broken site. Transient
 * probe failures are inconclusive: nothing is persisted and the next deploy
 * re-verifies.
 */

import type {
  DeployContext,
  ConfigureDomainContext,
  HookResult,
  ProviderId,
  SiteFile,
  StructureVerdict,
} from "./types";
import { readSettings } from "./settings";
import { getState, recordSuccess, recordError } from "./state";
import { getProvider, makeProviderById } from "./providers";
import { readSiteFiles } from "./site-files";
import { makeSiteRelative } from "./relative-urls";
import { siteDisplayUrl, deployAddresses, IPNS_RECORD_NOTE } from "./gateways";
import { localGatewayHost } from "./kubo-gateway";
import { generateDnsTarget } from "./dnslink";
import { categorizeError } from "./errors";
import {
  setCurrentHookName,
  reportProgress,
  reportError,
} from "./utils";
import { publishIdentityIpns, isPublished } from "./ipns-identity";
import { checkSetup } from "./setup";
import type { SetupContext, SetupVerdict } from "./types";
import { HEARTBEAT_MS } from "./constants";

/**
 * The path whose resolution proves the directory tree reconstructed: any
 * nested path (contains "/") breaks if multipart filename slashes were
 * stripped. A flat site has nothing that can break, so there is nothing to
 * verify (returns null).
 */
function nestedProbePath(files: SiteFile[]): string | null {
  return files.find((f) => f.path.includes("/"))?.path ?? null;
}

// ============================================================================
// deploy hook
// ============================================================================

async function deploy(context: DeployContext): Promise<HookResult> {
  setCurrentHookName("deploy");
  console.log("IPFS Deployer: Starting deployment...");

  // Validate the built site up front. context.site_files is also exactly the
  // list we read and upload — the guard and the upload can never diverge.
  const sitePaths = context.site_files ?? [];
  if (sitePaths.length === 0) {
    const msg = "Site directory is empty. Please build your site first.";
    await reportError(msg, "validation", true);
    return { success: false, message: msg };
  }

  // Settings come from moss (host-merged manifest defaults + the user's
  // config.json); state is the plugin's own, in state.json.
  const config = readSettings(context.config);
  if (!config.pinName) {
    // Default the pin label to the project's name (BaseContext.project_info);
    // providers fall back to "moss-site" when neither is available.
    config.pinName = context.project_info?.site_name || context.project_info?.folder_name;
  }
  const state = await getState();
  const provider = getProvider(config);

  // Progress state. The helper keeps the heartbeat's closure vars in sync with
  // every direct report, so the heartbeat can never replay a stale phase.
  let currentStage = "configuring";
  let currentStep = 1;
  let currentMessage = "Preparing...";
  const progress = async (stage: string, step: number, message: string): Promise<void> => {
    currentStage = stage;
    currentStep = step;
    currentMessage = message;
    await reportProgress(stage, step, 10, message);
  };
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  try {
    // --- Readiness gate. Interactive setup already ran: moss drives the
    // check_setup conversation (setup.ts) before the publish reaches this
    // hook. This is the headless backstop — a not-ready provider fails with
    // its reason, never with UI.
    await progress("configuring", 1, `Checking ${provider.label}...`);
    const ready = await provider.checkReady();
    if (!ready.ready) {
      return { success: false, message: ready.reason };
    }

    // --- Heartbeat covers the long phases (read/upload/verify/publish). ---
    heartbeat = setInterval(() => {
      void reportProgress(currentStage, currentStep, 10, currentMessage);
    }, HEARTBEAT_MS);

    // --- Read the built site into memory (base64, bounded concurrency). ---
    await progress("reading", 3, "Reading site files...");
    const read = await readSiteFiles(sitePaths, (_pct, msg) => {
      currentMessage = msg;
    });
    let files = read.files;
    console.log(`   ${files.length} files, ${read.totalBytes} bytes`);
    for (const w of read.warnings) console.warn(`   ${w}`);

    // Rewrite root-absolute HTML links to relative so the site renders on
    // path-form gateways too (host/ipfs/<cid>/…) — moss emits absolute paths,
    // which only work on origin-rooted (subdomain) gateways.
    if (config.relativeUrls !== false) {
      const rel = makeSiteRelative(files);
      files = rel.files;
      if (rel.rewritten > 0) console.log(`   Rewrote absolute links in ${rel.rewritten} HTML files`);
    }

    // --- Upload / pin the directory. ---
    const onUpload = (pct: number, msg: string): void => {
      void progress("uploading", Math.min(4 + Math.floor((pct / 100) * 3), 7), msg);
    };
    const alreadyVerified = state.structureVerified?.[provider.id] === true;
    const upload = await provider.uploadDir(files, onUpload);
    const { cid } = upload;
    console.log(`   Pinned CID: ${cid}`);

    // --- Structure verification (until proven once per provider). When the
    // backend's own upload response already proved the tree (upload.verified),
    // no separate probe runs at all. A CONFIRMED broken tree fails the deploy:
    // there is no fallback the QuickJS runtime could execute, and a broken
    // site must never be reported as success.
    let verifiedNow = alreadyVerified;
    if (!alreadyVerified) {
      const nested = nestedProbePath(files);
      if (nested === null || upload.verified === true) {
        // Flat site (nothing to lose) or response-proven structure.
        verifiedNow = true;
      } else {
        let verdict: StructureVerdict;
        if (upload.verified === false) {
          verdict = "broken"; // the backend response disproved the tree
        } else {
          await progress("verifying", 8, "Verifying site directory...");
          verdict = await provider.verifyDirectory(cid, nested);
        }
        if (verdict === "ok") {
          verifiedNow = true;
        } else if (verdict === "broken") {
          throw new Error(
            `${provider.label} did not preserve the site's folder structure, so the ` +
              `deployed pages would not load. This indicates a host or backend regression — ` +
              `please report it (moss's multipart encoding and ${provider.label} both ` +
              `normally preserve directories).`,
          );
        } else {
          console.warn("   Structure probe inconclusive — will re-verify on the next deploy.");
        }
      }
    }

    // Ask the node where its gateway is rather than assuming Kubo's default
    // 8080, which moss's own preview server holds on every machine. Unknown
    // means no local link is offered at all — better than one that 404s.
    const localHost =
      provider.id === "local" ? await localGatewayHost(config) : undefined;

    // --- Publish the site's stable IPNS name. ---
    // One owner: the name derives from moss's own key (ipns-identity.ts). A
    // failure here is fatal for the deploy rather than routed around — the
    // only other key available would publish the site at a DIFFERENT
    // permanent address, which is worse than not publishing.
    let ipnsName: string | undefined;
    if (config.useIpns) {
      await progress("publishing", 9, "Publishing IPNS name...");
      const outcome = await publishIdentityIpns(cid, config);
      if (!isPublished(outcome)) {
        throw new Error(
          `Your site was pinned (CID ${cid}), but its stable IPNS address could not be ` +
            `updated, so the address still points at your previous deploy: ${outcome.reason}`,
        );
      }
      ipnsName = outcome.name;
      console.log(`   IPNS: ${ipnsName} seq=${outcome.sequence}`);
    }

    // --- Co-pin: same CID, one more keeper (best-effort, never fatal). ---
    // Both backends produce byte-identical CIDs, so this is pure redundancy:
    // the address doesn't change, one more party keeps the bytes alive.
    let coPinnedId: ProviderId | "" = "";
    if (config.coPin) {
      const otherId: ProviderId = provider.id === "pinata" ? "local" : "pinata";
      try {
        const secondary = makeProviderById(otherId, config);
        const secondaryReady = await secondary.checkReady();
        if (secondaryReady.ready) {
          await progress("pinning", 9, `Co-pinning to ${secondary.label}...`);
          const sec = await secondary.uploadDir(files, () => {});
          if (sec.cid === cid) {
            coPinnedId = otherId;
            console.log(`   Co-pinned to ${secondary.label}`);
          } else {
            // A different CID is NOT redundancy for this deploy's address —
            // report the co-pin as skipped rather than claiming a keeper.
            console.warn(
              `   Co-pin skipped: ${secondary.label} returned a different CID (${sec.cid}) — expected ${cid}`,
            );
          }
        } else {
          console.log(`   Co-pin skipped: ${secondaryReady.reason}`);
        }
      } catch (e) {
        console.warn(`   Co-pin to ${otherId} failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }

    // --- Persist derived state in one write. ---
    await recordSuccess(cid, {
      lastUsedIpns: !!ipnsName,
      ...(verifiedNow && !alreadyVerified
        ? { structureVerified: { ...state.structureVerified, [provider.id]: true } }
        : {}),
    });

    const domain = context.domain;
    const dnsTarget = domain ? generateDnsTarget({ cid }) : undefined;
    // The standing address: the domain if one is set, else the IPNS name
    // (now that it's published), else the CID — always through the public
    // door. The local node's own gateway is instant but private to this
    // machine, so it never becomes this URL; it exists only as the "Local
    // gateway" row below.
    const displayUrl = siteDisplayUrl(cid, config, { ipnsName, domain });

    await progress("complete", 10, "Published to IPFS!");
    stopHeartbeat();

    // A site kept alive ONLY by this machine's node disappears when the node
    // stops — say so (UX contract: never let a site vanish silently). It rides
    // on the local gateway's own row, where the reader is looking at it.
    const localOnly = provider.id === "local" && coPinnedId !== "pinata";
    const addresses = deployAddresses({
      cid,
      ipnsName,
      provider: provider.id,
      config,
      localHost,
      domain,
      localOnly,
    });
    const message =
      `Your site is on IPFS!\n\n` +
      `URL: ${displayUrl}\n` +
      (ipnsName ? `Stable IPNS: ${ipnsName}\n` : ``) +
      `CID: ${cid}\n\n` +
      `Pinned via ${provider.label}.` +
      (coPinnedId ? ` Also pinned to ${coPinnedId === "local" ? "your local node" : "Pinata"}.` : ``);

    return {
      success: true,
      message,
      // Outcome UX is data: moss renders the toast, and opens the addresses
      // window itself the first time a site lands on this target.
      toast: { outcome: "success", title: "Published to IPFS!", url: displayUrl },
      deployment: {
        method: "ipfs",
        addresses,
        url: displayUrl,
        deployed_at: new Date().toISOString(),
        // Only the two keys configure_domain reads back; every other field
        // this used to carry (provider, gateway, pin_name, size_bytes,
        // structure_verified, co_pinned, is_live) has no reader in moss or
        // this plugin — state.json is where that bookkeeping actually lives.
        metadata: {
          cid,
          ipns_name: ipnsName ?? "",
        },
        ...(dnsTarget ? { dns_target: dnsTarget } : {}),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`IPFS Deployer: Failed - ${errorMessage}`);
    await recordError(errorMessage);
    await reportError(errorMessage, "deploy", true);
    return {
      success: false,
      message: errorMessage,
      toast: { outcome: "error", title: categorizeError(errorMessage) },
    };
  } finally {
    stopHeartbeat();
  }
}

// ============================================================================
// configure_domain hook (DNSLink)
// ============================================================================

/**
 * Advisory/idempotent: the DNSLink records are written by moss from the
 * dns_target that `deploy` returned. This hook explains the setup and confirms
 * what the user should expect.
 */
async function configure_domain(context: ConfigureDomainContext): Promise<HookResult> {
  setCurrentHookName("configure_domain");
  const domain = context.domain ?? "";
  console.log(`IPFS Deployer: Configuring custom domain "${domain}"...`);

  // Per-field fallback: a deployment can carry metadata with a CID but no
  // ipns_name (IPNS off for that publish, or an older deploy that had a
  // publish since), and state.json is the only place the name still lives.
  // Gating the whole fallback on `meta` made state?.ipnsName unreachable
  // whenever metadata had a cid.
  const meta = context.deployment?.metadata;
  const state = await getState();
  const cid = meta?.cid ?? state?.lastCid;
  const ipnsName = meta?.ipns_name ?? state?.ipnsName;

  if (!cid) {
    return { success: false, message: "No IPFS deployment found. Deploy first." };
  }

  const message =
    `Custom domain "${domain}" is set up for IPFS via DNSLink.\n\n` +
    `A TXT record on _dnslink.${domain} points to /ipfs/${cid}, this publish's content. ` +
    `Publishing again gives you a new record to paste — moss shows it each time.\n` +
    (ipnsName
      ? `Your site also has a stable IPNS address (${ipnsName}) that always follows the ` +
        `latest publish, but isn't the domain's target: ${IPNS_RECORD_NOTE} ` +
        `That would take the domain down between publishes.\n`
      : ``) +
    `Your site resolves at https://${domain} through DNSLink-aware gateways (dweb.link, ipfs.io).`;

  return { success: true, message };
}

// ============================================================================
// check_setup hook — the verdict travels back inside a HookResult
// ============================================================================

async function check_setup(
  ctx: SetupContext,
): Promise<{ success: boolean; setup: SetupVerdict }> {
  setCurrentHookName("check_setup");
  return { success: true, setup: await checkSetup(ctx) };
}

// ============================================================================
// Plugin registration
// ============================================================================

const IpfsPlugin = { deploy, configure_domain, check_setup };
(window as unknown as { IpfsPlugin: typeof IpfsPlugin }).IpfsPlugin = IpfsPlugin;

export {
  deploy,
  deploy as on_deploy,
  configure_domain,
  configure_domain as on_configure_domain,
  check_setup,
};
export default IpfsPlugin;
