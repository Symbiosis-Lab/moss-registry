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
import { getConfig, applyUserSettings, recordSuccess, recordError } from "./config";
import { getProvider, makeProviderById } from "./providers";
import { readSiteFiles } from "./site-files";
import { makeSiteRelative } from "./relative-urls";
import { siteDisplayUrl, gatewayLinks } from "./gateways";
import { generateDnsTarget } from "./dnslink";
import { categorizeError } from "./errors";
import {
  setCurrentHookName,
  reportProgress,
  reportError,
  showToast,
  closeBrowser,
} from "./utils";
import { getUrl } from "./http";
import { publishIdentityIpns } from "./ipns-identity";
import { showResultPanel, type ResultView } from "./result-panel";
import { REACHABILITY_TIMEOUT_MS, HEARTBEAT_MS } from "./constants";

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

  // Single config read: persisted state + user settings overlay.
  const persisted = await getConfig();
  const firstDeploy = !persisted.lastCid;
  const config = applyUserSettings(persisted, context.config);
  if (!config.pinName) {
    // Default the pin label to the project's name (BaseContext.project_info);
    // providers fall back to "moss-site" when neither is available.
    config.pinName = context.project_info?.site_name || context.project_info?.folder_name;
  }
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
    // --- Setup gate: ensure the provider is ready (creds / daemon). ---
    // No deploy heartbeat yet: the setup panels run their own heartbeat
    // (showPanel), so only one progress source is active at a time.
    await progress("configuring", 1, `Checking ${provider.label}...`);
    let ready = await provider.checkReady();
    if (!ready.ready) {
      await progress("configuring", 2, ready.reason);
      const ok = await provider.runSetup();
      await closeBrowser();
      if (!ok) {
        return { success: false, message: `${provider.label} not configured.` };
      }
      ready = await provider.checkReady();
      if (!ready.ready) {
        return { success: false, message: ready.reason };
      }
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
    const alreadyVerified = config.structureVerified?.[provider.id] === true;
    const upload = await provider.uploadDir(files, onUpload);
    const { cid, sizeBytes } = upload;
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

    // --- Reachability (informational): probe the URL users actually click,
    // concurrent with IPNS publish. (Pinata's shared gateway 403s HTML, and a
    // laptop node's content lags on public gateways — siteDisplayUrl picks the
    // URL that should genuinely work per provider.)
    const displayUrl = siteDisplayUrl(cid, provider.id, config);
    const isLivePromise = getUrl(`${displayUrl.replace(/\/$/, "")}/`, REACHABILITY_TIMEOUT_MS)
      .then((r) => r.ok)
      .catch(() => false);

    // --- Publish a stable IPNS name (best-effort, but degradation is loud). ---
    // Preferred: identity IPNS — the name derives from a moss-held key, so it
    // is identical across providers and machines. Fallback: the provider's own
    // IPNS (local Kubo keystore). Both absent → honest note.
    let ipnsName: string | undefined;
    let ipnsNote = "";
    if (config.useIpns) {
      await progress("publishing", 9, "Publishing IPNS name...");
      const identity = await publishIdentityIpns(cid, config);
      if (identity) {
        ipnsName = identity.name;
        console.log(`   IPNS (identity): ${ipnsName} seq=${identity.sequence}`);
      } else if (provider.publishIpns) {
        ipnsName = await provider.publishIpns(cid);
        if (ipnsName) {
          console.log(`   IPNS: ${ipnsName}`);
        } else {
          ipnsNote = `\n\nNote: IPNS publish failed on ${provider.label} this deploy — the URL above points at this deploy's CID.`;
          console.warn("   IPNS publish failed — continuing with CID-only URLs.");
        }
      } else {
        ipnsNote =
          `\n\nNote: ${provider.label} does not support IPNS — the URL points at this deploy's CID. ` +
          `Use the local IPFS node provider for a stable IPNS name, or set up a custom domain (DNSLink).`;
      }
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

    const isLive = await isLivePromise;

    // --- Persist derived state in one write. ---
    await recordSuccess(cid, {
      lastUsedIpns: !!ipnsName,
      ...(ipnsName ? { ipnsName } : {}),
      ...(verifiedNow && !alreadyVerified
        ? { structureVerified: { ...persisted.structureVerified, [provider.id]: true } }
        : {}),
    });

    const links = gatewayLinks(cid, ipnsName, provider.id, config);
    const domain = context.domain;
    const dnsTarget = domain ? generateDnsTarget({ ipnsName, cid }) : undefined;

    await progress("complete", 10, "Published to IPFS!");
    stopHeartbeat();

    const message =
      `Your site is on IPFS!\n\n` +
      `URL: ${displayUrl}\n` +
      (ipnsName ? `Stable IPNS: ${ipnsName}\n` : ``) +
      `CID: ${cid}\n\n` +
      `Pinned via ${provider.label}.` +
      (coPinnedId ? ` Also pinned to ${coPinnedId === "local" ? "your local node" : "Pinata"}.` : ``) +
      ipnsNote;

    await showToast({
      message: "Published to IPFS!",
      variant: "success",
      actions: [{ label: "View site", url: displayUrl }],
      duration: 8000,
    });

    // First successful deploy: open the details panel. Resolves on open — it
    // does not block the hook on user dismissal.
    if (firstDeploy) {
      const view: ResultView = {
        cid,
        ipnsName,
        providerLabel: provider.label,
        primaryUrl: displayUrl,
        links,
        domain,
        domainStable: !!ipnsName,
      };
      await showResultPanel(view);
    }

    return {
      success: true,
      message,
      deployment: {
        method: "ipfs",
        url: displayUrl,
        deployed_at: new Date().toISOString(),
        metadata: {
          provider: provider.id,
          cid,
          ipns_name: ipnsName ?? "",
          pin_name: config.pinName ?? "",
          size_bytes: String(sizeBytes),
          gateway: displayUrl,
          structure_verified: String(verifiedNow),
          co_pinned: coPinnedId,
          is_live: String(isLive),
        },
        ...(dnsTarget ? { dns_target: dnsTarget } : {}),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`IPFS Deployer: Failed - ${errorMessage}`);
    await recordError(errorMessage);
    await reportError(errorMessage, "deploy", true);
    await showToast({ message: categorizeError(errorMessage), variant: "error", duration: 5000 });
    return { success: false, message: errorMessage };
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

  const meta = context.deployment?.metadata;

  let cid: string | undefined;
  let ipnsName: string | undefined;
  if (meta && (meta.cid || meta.ipns_name)) {
    // Deployment metadata is the source of truth for what THIS deploy emitted.
    // An empty ipns_name means the deploy used a CID target (IPNS off) — do NOT
    // fall back to a persisted (possibly stale) IPNS name.
    cid = meta.cid || undefined;
    ipnsName = meta.ipns_name || undefined;
  } else {
    // No deployment metadata (e.g. a standalone call) — best-effort from
    // persisted state. Only treat the domain as IPNS-backed if the last deploy
    // actually published one.
    const persisted = await getConfig();
    cid = persisted.lastCid;
    ipnsName = persisted.lastUsedIpns ? persisted.ipnsName : undefined;
  }

  if (!cid && !ipnsName) {
    return { success: false, message: "No IPFS deployment found. Deploy first." };
  }

  const target = ipnsName ? `/ipns/${ipnsName}` : `/ipfs/${cid}`;
  const message =
    `Custom domain "${domain}" is set up for IPFS via DNSLink.\n\n` +
    `A TXT record on _dnslink.${domain} points to ${target}.\n` +
    (ipnsName
      ? `Because it uses IPNS, future deploys update automatically — no DNS changes needed.\n`
      : `This points at a fixed CID; re-run deploy with IPNS enabled to avoid editing DNS each publish.\n`) +
    `Your site resolves at https://${domain} through DNSLink-aware gateways (dweb.link, ipfs.io).`;

  return { success: true, message };
}

// ============================================================================
// Plugin registration
// ============================================================================

const IpfsPlugin = { deploy, configure_domain };
(window as unknown as { IpfsPlugin: typeof IpfsPlugin }).IpfsPlugin = IpfsPlugin;

export { deploy, deploy as on_deploy, configure_domain, configure_domain as on_configure_domain };
export default IpfsPlugin;
