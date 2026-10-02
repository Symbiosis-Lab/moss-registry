/**
 * GitHub Deployer Plugin
 *
 * Deploys sites to GitHub Pages via git push to the gh-pages branch.
 * On first-time deploy, also pushes source files to the main branch.
 *
 * Authentication:
 * - Uses OAuth Device Flow for browser-based GitHub login
 * - Stores tokens in git credential helper for persistence
 */

import type { DeployContext, ConfigureDomainContext, HookResult, DnsTarget, DnsRecord } from "./types";
import { fetchUrl } from "@symbiosis-lab/moss-api";
import { reportProgress, reportError, setCurrentHookName, showToast, closeBrowser, resolveGitPath } from "./utils";
import { buildPagesUrl, parseGitHubUrl } from "./git";
import { verifyRepoExists, getOriginOwnerRepo, deployViaGitPush, type DeployResult } from "./github-deploy";
import { resolveTokenOutcome } from "./auth";
import { ensureGitHubRepo } from "./repo-setup";
import { checkPagesStatus, requestPagesBuild, setCustomDomain, ensurePagesSource, getPages, enforceHttps } from "./github-api";
import { check_setup } from "./setup";

// ============================================================================
// GitHub Pages DNS Configuration
// ============================================================================

/**
 * GitHub Pages A record IP addresses
 * These are the official GitHub Pages IPs for apex domain configuration
 * @see https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain
 */
const GITHUB_PAGES_IPS = [
  "185.199.108.153",
  "185.199.109.153",
  "185.199.110.153",
  "185.199.111.153",
];

/**
 * Generate DNS records for GitHub Pages custom domain configuration
 *
 * @param owner - GitHub username (for CNAME target)
 * @returns DnsTarget with A records for apex and CNAME for www
 */
function generateDnsTarget(owner: string): DnsTarget {
  const records: DnsRecord[] = [
    // A records for apex domain (@)
    ...GITHUB_PAGES_IPS.map(ip => ({
      record_type: "A",
      name: "@",
      value: ip,
    })),
    // CNAME for www subdomain
    {
      record_type: "CNAME",
      name: "www",
      value: `${owner}.github.io`,
    },
  ];

  return { records };
}

// ============================================================================
// Pages Status Polling
// ============================================================================

/**
 * Poll GitHub Pages API until site is live (max 60s)
 *
 * Feature 21: Check if deployed site is accessible before returning.
 *
 * @param owner - GitHub username
 * @param repo - Repository name
 * @param token - GitHub OAuth token (optional - if not available, skips status check)
 * @param pagesUrl - The expected GitHub Pages URL
 * @param expectedCommit - Full SHA of the orphan commit pushed to gh-pages.
 *   When set, a "built" status with a different commit is treated as stale.
 * @returns Object with isLive status, URL, and optional error message
 */
async function waitForPagesLive(
  owner: string,
  repo: string,
  token: string | null,
  pagesUrl: string,
  expectedCommit?: string,
): Promise<{ isLive: boolean; url: string; error?: string }> {
  // If no token available, skip status check
  if (!token) {
    console.log("   Status check skipped (no token available)");
    return { isLive: false, url: pagesUrl };
  }

  const maxAttempts = 6; // 6 attempts × 5s = 30s max
  const pollInterval = 5000;
  let buildRequested = false;

  console.log("   Checking deployment status...");

  for (let i = 0; i < maxAttempts; i++) {
    // Report progress FIRST to reset the 60-second inactivity timer
    // This must happen BEFORE sleep() to prevent timeout
    await reportProgress("verifying", 9, 10, `Waiting for GitHub Pages... (${i + 1}/${maxAttempts})`);

    const status = await checkPagesStatus(owner, repo, token);

    if (status.status === "built") {
      // Guard against stale builds: if we know the expected commit,
      // only consider it live when the build matches our push.
      if (expectedCommit && status.commit && status.commit !== expectedCommit) {
        console.log(`   Stale build detected (got ${status.commit}, expected ${expectedCommit})`);
        // Force-pushed orphan commits sometimes don't trigger automatic builds.
        // Request one explicitly — but only once per deploy.
        if (!buildRequested) {
          buildRequested = true;
          console.log("   Requesting rebuild...");
          await requestPagesBuild(owner, repo, token);
        }
      } else {
        console.log("   Site is live!");
        return { isLive: true, url: pagesUrl };
      }
    }

    if (status.status === "errored") {
      console.log("   Build failed on GitHub");
      return { isLive: false, url: pagesUrl, error: status.error };
    }

    // Still building or stale — sleep before next check
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  // Timeout - return URL anyway with isLive: false
  console.log("   Status check timed out (site may still be building)");
  return { isLive: false, url: pagesUrl };
}

// ============================================================================
// HTTP Reachability Check
// ============================================================================

/**
 * Check if a URL is reachable via HTTP GET.
 * Uses Rust-side fetchUrl (ureq) for reliable, CORS-free checks.
 * Retries with interval. Used as final "deployed" verification.
 */
async function checkSiteReachable(
  url: string,
  maxAttempts = 3,
  intervalMs = 5000,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await reportProgress("verifying", 9, 10, `Checking ${url}... (${i + 1}/${maxAttempts})`);
    try {
      const result = await fetchUrl(url, { timeoutMs: 10000 });
      if (result.ok) return true;
    } catch {
      // Network error, retry
    }
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * deploy hook - Deploy to GitHub Pages via git push
 *
 * This capability:
 * 0. Validates requirements (git repo, GitHub remote, built site)
 * 1. Ensures authentication (prompts login if needed)
 * 2. Pushes source files to main branch (first-time only, non-fatal)
 * 3. Force-pushes built site to gh-pages via git CLI
 * 4. Verifies deployment is live
 */
async function deploy(context: DeployContext): Promise<HookResult> {
  setCurrentHookName("deploy");

  console.log("GitHub Deployer: Starting deployment...");

  // Pre-flight: resolve git binary (downloads if needed)
  await reportProgress("configuring", 1, 10, "Checking git...");
  const gitPath = await resolveGitPath();
  if (!gitPath) {
    const msg = "Git is required for deployment.\n\nInstall git by running: xcode-select --install";
    await reportError(msg, "validation", true);
    return { success: false, message: msg };
  }
  console.log(`   Using git: ${gitPath}`);

  try {
    // Phase 0.5: Early validation using context.site_files (Bug 13 fix)
    // The plugin trusts moss to provide site_files - no need to call listFiles()
    if (!context.site_files || context.site_files.length === 0) {
      const msg = "Site directory is empty. Please build your site first.";
      await reportError(msg, "validation", true);
      return { success: false, message: msg };
    }
    console.log(`   Site files: ${context.site_files.length} files ready`);

    // Phase 0: the account, before anything that needs it. Signing in is the
    // setup gate's job — `check_setup` ran on the Publish click and offered
    // the button — so reaching here without a token means the token stopped
    // working since. Say so and stop; a login behind a progress bar is the
    // behaviour this replaced.
    await reportProgress("configuring", 2, 10, "Checking authentication...");
    const { token, unreachable } = await resolveTokenOutcome(gitPath);
    if (!token) {
      // Offline, the sign-in this would send them to needs the network that
      // just failed — so naming the token is a wrong diagnosis AND a dead end.
      const msg = unreachable
        ? "moss could not reach GitHub. Check your connection and publish again."
        : "Your GitHub sign-in has expired. Publish again to sign in.";
      await reportError(msg, "authenticating", true);
      return { success: false, message: msg };
    }

    // Phase 1: Determine deploy target from git state (single source of truth)
    let owner: string;
    let repoName: string;
    let wasFirstSetup = false;

    const existing = await getOriginOwnerRepo(gitPath);

    if (existing) {
      // .git origin already points to a GitHub repo — use it
      owner = existing.owner;
      repoName = existing.repo;
      console.log(`   Deploy target: ${owner}/${repoName} (from git origin)`);
    } else {
      // No .git or no GitHub origin — run setup flow
      await reportProgress("setup", 0, 10, "Setting up GitHub repository...");
      const repoInfo = await ensureGitHubRepo(token);

      if (!repoInfo) {
        return { success: false, message: "Repository setup cancelled." };
      }

      const parsed = parseGitHubUrl(repoInfo.sshUrl);
      if (!parsed) {
        throw new Error("Could not parse GitHub URL from setup result: " + repoInfo.sshUrl);
      }

      owner = parsed.owner;
      repoName = parsed.repo;
      wasFirstSetup = true;

      console.log(`   Repository configured: ${repoInfo.fullName}`);
      await closeBrowser();
      console.log("   Browser closed - continuing deployment in background");
    }

    // Phase 2: Verify repository exists (fail fast with clear error)
    await verifyRepoExists(owner, repoName, token);

    // The deploy's slow tail (source backup to main, the Pages-API liveness
    // check) is reported as it happens. moss counts a host call in flight as
    // activity (ADR-072), so nothing has to be said to stay alive.
    let deployResult: DeployResult = { commitSha: "", orphanSha: "", treeChanged: false };

    // Use context.domain from DeployContext (populated by Rust from .moss/config.toml).
    // Fall back to GitHub Pages API safety net if local config is missing
    // (e.g., iCloud sync corruption, manual edit, or config lost).
    let domain = context.domain;
    if (!domain) {
      try {
        const pages = await getPages(owner, repoName, token);
        if (pages?.cname) {
          domain = pages.cname;
          console.log(`   Safety net: preserving existing GitHub Pages CNAME: ${domain}`);
        }
      } catch {
        // Non-fatal — deploy proceeds without CNAME
      }
    }

    // Single deploy: commits source + .moss/build/site/, pushes to main,
    // then extracts .moss/build/site/ tree as orphan commit → gh-pages
    deployResult = await deployViaGitPush({
      owner,
      repo: repoName,
      token,
      gitPath,
      domain,
      onProgress: (percent, message) => {
        // The plugin emits percent=100 once when gh-pages push lands
        // ("Deployed!"), then again with a different message for the
        // post-deploy source backup. From the user's side the publish is done
        // at that boundary, so the tail reports "verifying", not "deploying".
        if (percent >= 100) {
          reportProgress("verifying", 10, 10, message);
        } else {
          // Map 0-99% to steps 5-9 of overall 10-step progress
          reportProgress("deploying", Math.min(5 + Math.floor((percent / 100) * 4), 9), 10, message);
        }
      },
    });

    // Ensure GitHub Pages serves from gh-pages (non-fatal)
    try {
      const pagesResult = await ensurePagesSource(owner, repoName, token, "gh-pages");
      if (!pagesResult.configured) {
        console.warn("Failed to configure GitHub Pages source — user may need to enable Pages manually");
      }
    } catch (e) {
      console.warn(`   Failed to configure Pages source: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Generate pages URL (github.io) for API operations and display URL for user-facing messages
    const pagesUrl = buildPagesUrl(owner, repoName);
    const displayUrl = domain ? `https://${domain}` : pagesUrl;
    const { commitSha, orphanSha, treeChanged } = deployResult;

    // Use treeChanged (gh-pages content) for primary UI, not commitSha (source backup).
    // The gh-pages push always runs; commitSha only reflects source backup to main.
    const deployed = treeChanged;

    // Log the deployment result with URL immediately
    if (deployed) {
      console.log(`   Deployed: ${orphanSha.substring(0, 7)}`);
      console.log(`   Site URL: ${displayUrl}`);
    } else {
      console.log("   No changes to deploy");
      console.log(`   Site URL: ${displayUrl}`);
    }

    // Phase 9: Two-stage deployment verification
    // Stage 1: GitHub API build status (uses github.io URL)
    // Stage 2: HTTP reachability check against displayUrl (verifies actual access)
    // Always verify when tree changed — don't gate on commitSha (source backup).
    let isLive = false;
    let liveError: string | undefined;
    if (deployed) {
      const liveStatus = await waitForPagesLive(owner, repoName, token, pagesUrl, orphanSha);
      liveError = liveStatus.error;

      if (liveStatus.isLive) {
        // API says built — confirm with HTTP reachability against the URL users see
        isLive = await checkSiteReachable(displayUrl);
      } else if (!liveError) {
        // API timed out — try HTTP check as last resort
        isLive = await checkSiteReachable(displayUrl, 2, 3000);
      }
    }

    // Build DNS target for custom domain configuration
    const dnsTarget = generateDnsTarget(owner);

    // Build result message based on scenario
    // Zero-config deployment - no manual steps needed
    let message: string;
    let toastMessage: string;
    let toastVariant: "success" | "info" | "warning" | "error";
    let toastActions: Array<{ label: string; url: string }>;

    if (wasFirstSetup && deployed) {
      // Scenario 1: First-time deployment (gh-pages branch created)
      message =
        `Your site is being deployed to GitHub Pages!\n\n` +
        `Your site will be available at: ${displayUrl}\n\n` +
        `GitHub Pages is automatically enabled for the gh-pages branch.\n` +
        `It may take a few minutes for your site to appear.`;
      toastMessage = "Deploy configured!";
      toastVariant = "success";
      toastActions = [{ label: "View site", url: displayUrl }];
    } else if (deployed && isLive) {
      // Scenario 2a: Subsequent deploy, site is confirmed live
      message =
        `Site deployed to GitHub Pages!\n\n` +
        `Your site: ${displayUrl}\n\n` +
        `Changes have been pushed to gh-pages branch.`;
      toastMessage = "Site is live!";
      toastVariant = "success";
      toastActions = [{ label: "View site", url: displayUrl }];
    } else if (deployed && liveError) {
      // Scenario 2b: Subsequent deploy, build errored on GitHub
      message =
        `Site pushed to GitHub Pages but the build failed.\n\n` +
        `Error: ${liveError}\n\n` +
        `Check GitHub Pages settings for details.`;
      toastMessage = liveError.length > 60 ? liveError.slice(0, 60) + "..." : liveError;
      toastVariant = "warning";
      toastActions = [{ label: "View on GitHub", url: `https://github.com/${owner}/${repoName}/settings/pages` }];
    } else if (deployed) {
      // Scenario 2c: Deployed but not yet reachable (DNS propagation, CDN cache, first deploy)
      message =
        `Site deployed to GitHub Pages!\n\n` +
        `Your site: ${displayUrl}\n\n` +
        `Changes have been pushed. It may take a moment to go live.`;
      toastMessage = "Deployed \u2014 may take a moment to go live";
      toastVariant = "info";
      toastActions = [{ label: "View site", url: displayUrl }];
    } else {
      // Scenario 3: No changes to push
      message =
        `No changes to deploy.\n\n` +
        `Your site: ${displayUrl}\n\n` +
        `Your local site is already up to date.`;
      toastMessage = "No changes to deploy";
      toastVariant = "info";
      toastActions = [{ label: "View site", url: displayUrl }];
    }

    // Phase 10: Final progress message based on scenario
    const progressMsg = wasFirstSetup
      ? "GitHub Pages configured!"
      : deployed
        ? "Deployed!"
        : "No changes to deploy";
    await reportProgress("complete", 10, 10, progressMsg);

    const logMsg = wasFirstSetup
      ? "Setup complete"
      : deployed
        ? "Changes pushed"
        : "No changes";
    console.log(`GitHub Deployer: ${logMsg}`);

    // Show toast with clickable URL (8s duration for clickable link)
    await showToast({
      message: toastMessage,
      variant: toastVariant,
      actions: toastActions,
      duration: 8000,
    });

    // Return result - runtime handles completion
    return {
      success: true,
      message,
      deployment: {
        method: "github-pages",
        url: displayUrl,
        deployed_at: new Date().toISOString(),
        metadata: {
          repo_url: `https://github.com/${owner}/${repoName}`,
          branch: "gh-pages",
          was_first_setup: String(wasFirstSetup),
          commit_sha: commitSha,
          is_live: String(isLive),
        },
        dns_target: dnsTarget,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await reportError(errorMessage, "deploy", true);
    console.error(`GitHub Deployer: Failed - ${errorMessage}`);

    // Categorize error for toast display
    const lowerError = errorMessage.toLowerCase();
    let toastMessage: string;
    if (lowerError.includes("timed out") || lowerError.includes("timeout")) {
      toastMessage = "Push may still be running. Check GitHub in a few minutes.";
    } else if (lowerError.includes("authentication") || lowerError.includes("auth") || lowerError.includes("token")) {
      toastMessage = "Authentication failed";
    } else if (lowerError.includes("network") || lowerError.includes("connection")) {
      toastMessage = "Network error";
    } else if (lowerError.includes("not a git repository") || lowerError.includes("no remote")) {
      toastMessage = "Git not configured";
    } else if (errorMessage.length > 50) {
      toastMessage = errorMessage.slice(0, 50) + "...";
    } else {
      toastMessage = errorMessage;
    }

    // Show error toast (5s duration, no actions needed for errors)
    await showToast({
      message: toastMessage,
      variant: "error",
      duration: 5000,
    });

    // Return result - runtime handles completion
    return { success: false, message: errorMessage };
  }
}

// ============================================================================
// configure_domain Hook Implementation
// ============================================================================

/**
 * configure_domain hook - Set custom domain on GitHub Pages via API
 *
 * Called after moss-seta configures DNS records. This hook tells GitHub
 * about the custom domain so GitHub Pages serves content on it.
 *
 * Uses the GitHub Pages API: PUT /repos/{owner}/{repo}/pages { cname: domain }
 *
 * This is NON-FATAL from moss's perspective - DNS is already configured.
 * If this fails, the user can retry or set the domain manually in GitHub settings.
 */
async function configure_domain(context: ConfigureDomainContext): Promise<HookResult> {
  setCurrentHookName("configure_domain");

  const { domain } = context;

  console.log(`GitHub Deployer: Configuring custom domain "${domain}"...`);

  try {
    // configure_domain is non-fatal, so an unresolvable git falls back to
    // whatever "git" means on this machine rather than refusing.
    const gitPath = (await resolveGitPath()) ?? "git";

    // Get deploy target from git origin
    const repoConfig = await getOriginOwnerRepo(gitPath);
    if (!repoConfig) {
      return {
        success: false,
        message: "No GitHub repository configured. Deploy first.",
      };
    }

    const { owner, repo } = repoConfig;

    const { token, unreachable } = await resolveTokenOutcome(gitPath);
    if (!token) {
      return {
        success: false,
        message: unreachable
          ? "moss could not reach GitHub."
          : "No GitHub authentication token available. Please deploy first to authenticate.",
      };
    }

    // Check current GitHub Pages state (idempotent — safe to call repeatedly)
    const pages = await getPages(owner, repo, token);

    if (!pages) {
      // Pages not enabled yet — can't configure domain until first deploy
      return {
        success: false,
        message: "GitHub Pages not enabled. Deploy first.",
      };
    }

    if (!pages.cname || pages.cname.toLowerCase() !== domain.toLowerCase()) {
      // Phase 1: CNAME not set (or wrong) — set it without HTTPS
      console.log(`   Setting CNAME to "${domain}" on ${owner}/${repo}...`);
      await setCustomDomain(owner, repo, token, domain);
      console.log(`   Custom domain "${domain}" configured on GitHub Pages`);
      return {
        success: true,
        message: `Custom domain "${domain}" set on GitHub Pages. HTTPS will be enforced after certificate provisioning.`,
      };
    }

    if (!pages.https_enforced) {
      // Phase 2: CNAME is set, but HTTPS not enforced — try to enforce
      console.log(`   CNAME already set. Enforcing HTTPS...`);
      const enforced = await enforceHttps(owner, repo, token);
      if (enforced) {
        console.log(`   HTTPS enforced for "${domain}"`);
        return { success: true, message: `HTTPS enforced for "${domain}" on GitHub Pages.` };
      } else {
        // Cert not ready yet — will retry on next orchestrator call (self-healing)
        console.log(`   HTTPS enforcement not yet available (certificate pending)`);
        return { success: true, message: `CNAME set. HTTPS pending certificate provisioning.` };
      }
    }

    // Fully configured — idempotent no-op
    console.log(`   Domain "${domain}" already fully configured with HTTPS`);
    return { success: true, message: `Domain "${domain}" already configured with HTTPS on GitHub Pages.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`GitHub Deployer: Failed to configure domain - ${errorMessage}`);

    return {
      success: false,
      message: `Failed to set custom domain on GitHub Pages: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

/**
 * Plugin object exported as global for the moss plugin runtime
 */
const GithubPlugin = {
  deploy,
  configure_domain,
  check_setup,
};

// Register plugin globally for the plugin runtime
(window as unknown as { GithubPlugin: typeof GithubPlugin }).GithubPlugin = GithubPlugin;

// Also export for module usage
export { deploy, deploy as on_deploy, configure_domain, configure_domain as on_configure_domain, check_setup };
export default GithubPlugin;
