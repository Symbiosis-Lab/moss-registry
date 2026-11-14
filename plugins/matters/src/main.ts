/**
 * Matters.town plugin: imports a Matters account's articles into the folder,
 * and posts copies of the site's posts to Matters through moss's syndication
 * contract (moments for short posts, published articles for long posts).
 * Requires authentication via webview (domain: matters.town)
 */

import type {
  ProcessContext,
  HookResult,
} from "./types";
import {
  reportError,
  setCurrentHookName,
  sleep,
  formatArticleSyncSummary,
} from "./utils";
import { startTask } from "@symbiosis-lab/moss-api";
import {
  fetchAllArticlesSince,
  fetchAllDraftsSince,
  fetchAllCollections,
  fetchUserProfile,
  fetchArticleComments,
  fetchAllArticleCommentCounts,
  apiConfig,
  MattersAuthError,
} from "./api";
import {
  clearTokenCache,
  getSessionState,
  shouldNudgeSessionExpired,
  captureLogin,
  beginFreshLogin,
  bindStoredToken,
} from "./credential";
import { resolveAuthRoute, isUserPresent } from "./auth-route";
import { syncToLocalFiles, scanLocalArticles, detectBoundUser, nextKnownCollectionIds } from "./sync";
import { downloadMediaAndUpdate, rewriteAllInternalLinks } from "./downloader";
import { getConfig, saveConfig } from "./config";
import { overallProgress, type ProgressReporter } from "./progress";
import { loadSocialData, saveSocialData, mergeSocialData, reconcileLegacySocialData } from "./social";
import {
  showToast,
  getPluginEnvVar,
} from "@symbiosis-lab/moss-api";
import {
  initializeDomain,
  getDomain,
  loginUrl,
} from "./domain";

// ============================================================================
// Social-fetch predicates (exported for unit tests — used in Phase 8 below)
// ============================================================================

/**
 * Should the social fetch for this article be SKIPPED?
 *
 * Skip only when:
 * - remoteCounts discovery succeeded (remoteCount defined)
 * - we've synced before with this code path (storedCount defined)
 * - remote count matches what we last recorded
 * - AND we genuinely have data: either zero comments everywhere, or we have
 *   stored comments to prove the count was accurate on last sync.
 *
 * A poisoned entry (storedCount=57, existingComments=[]) must NOT skip —
 * the count was recorded without actually fetching the data.
 */
export function shouldSkipSocialFetch(
  remoteCount: number | undefined,
  storedCount: number | undefined,
  existingCommentsLength: number,
): boolean {
  return (
    remoteCount !== undefined &&
    storedCount !== undefined &&
    remoteCount === storedCount &&
    (remoteCount === 0 || existingCommentsLength > 0)
  );
}

/**
 * What sinceTimestamp should be passed to fetchArticleComments?
 *
 * Pass lastSyncedAt only when we already have local comments AND the stored
 * count is defined. An entry whose count was cleared by reconcile (poisoned
 * entry) but which still has a FEW stored comments must do a FULL refetch —
 * giving it lastSyncedAt would drop all older comments via the since-filter,
 * re-recording a near-empty count and re-locking the skip permanently.
 */
export function resolveSinceTimestamp(
  existingCommentsLength: number,
  storedCount: number | undefined,
  lastSyncedAt: string | undefined,
): string | undefined {
  return existingCommentsLength > 0 && storedCount !== undefined ? lastSyncedAt : undefined;
}

// ============================================================================
// Browser Utilities (via SDK)
// ============================================================================

import {
  openBrowser,
  closeBrowser,
  returnToEditor,
  type BrowserHandle,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// Authentication Helpers
// ============================================================================

/**
 * Build the locale-aware login-success toast message.
 *
 * Uses the Matters profile language stored in config (populated by
 * `affirmBindingFromProfile` → `saveConfig`) to match the moss shell's three
 * locales (en / zh-hans / zh-hant). The `language` field from the Matters API
 * uses underscore format ("zh_hans", "zh_hant"); we normalize to dash format.
 *
 * Mirrors the `matters.login_success` key added to ui-strings.ts for shell use.
 *
 * @param userName - Matters username (e.g. "@guo"), empty string if unknown
 * @param language - Matters profile language (e.g. "zh_hans"), may be undefined
 */
function mattersLoginSuccessMessage(userName: string, language?: string): string {
  const suffix = userName ? ` · @${userName}` : "";
  // Matters API uses underscore locales ("zh_hans"); normalize to dashes so
  // the startsWith checks below cover both forms.
  const lang = (language ?? "").toLowerCase().replace("_", "-");
  if (lang.startsWith("zh-hant")) {
    return `已連接 Matters${suffix}`;
  }
  if (lang.startsWith("zh")) {
    return `已连接 Matters${suffix}`;
  }
  return `Connected to Matters${suffix}`;
}

/**
 * Session-expired nudge. Always logs — every trigger gets the diagnostic
 * line — but the TOAST only surfaces when a user is actually present to
 * read it (`isUserPresent(trigger)`): a background rebuild's expired
 * session must not interrupt the user with a toast while they're not even
 * looking at Matters (moss#open-feedback-design, 2026-09-15). Throttled
 * once per expiry event via a nudgedAt stamp in auth.json (engine-
 * independent: module state may reset per build under the off-webview
 * runtime). Every suppressed occurrence still logs.
 */
async function notifySessionExpired(trigger: string | undefined): Promise<void> {
  console.warn("⚠️ Matters session expired; drafts and syndication paused until re-login");
  if (!isUserPresent(trigger)) return;
  if (await shouldNudgeSessionExpired()) {
    await showToast({
      message: "Matters session expired. Log in to resume drafts and syndication.",
      variant: "warning",
      persistent: true,
    });
  }
}

/**
 * Wait for access token by polling for cookie.
 *
 * Polls until the token is found OR the browser window is closed by the user.
 * There is NO wall-clock timeout — the user may take as long as they need.
 * The poll exits only on:
 *   - Token found (returns true)
 *   - Browser panel closed by user (returns false)
 *   - Plugin context lost (returns false)
 *
 * @param browserHandle - Handle from openBrowser() to detect window closure
 * @param initialDelayMs - Short pause before first poll (default: 1s). Gives
 *   the login page time to start loading before the first cookie check, without
 *   delaying a fast local login. The old 20 s default caused fast logins to be
 *   missed (Phase 2 B2 fix: reduced from 20000 to 1000).
 * @param pollIntervalMs - Time between checks (default: 2s)
 * @returns true if token found, false if window closed or context lost
 */
async function waitForToken(
  browserHandle: BrowserHandle,
  initialDelayMs = 1000,
  pollIntervalMs = 2000,
): Promise<boolean> {
  console.log(`⏳ Waiting ${initialDelayMs / 1000}s before first token check...`);
  await sleep(initialDelayMs);

  let windowClosed = false;

  // Listen for window close — this is the ONLY exit condition besides finding
  // the token. There is no maxWaitMs ceiling (Phase 2 B2: removed).
  browserHandle.closed.then(() => {
    windowClosed = true;
  });

  let pollCount = 0;
  while (true) {
    // Exit immediately if window was closed
    if (windowClosed) {
      console.log("🚪 Browser window closed by user");
      return false;
    }

    pollCount++;
    clearTokenCache();
    // During login flow, capture the freshly-set cookie (captureLogin checks the
    // global WebKit store) — it also persists the token to project storage.
    const token = await captureLogin();

    // Exit if context was lost (SDK returns undefined)
    if (token === undefined) {
      console.log("⚠️ Plugin context lost, stopping auth check");
      return false;
    }

    if (token) {
      console.info(`🔑 Token found after ${pollCount} poll(s)!`);
      return true;
    }

    // Throttled poll log: emit once every 30 s (~15 polls at 2 s interval)
    // instead of every 2 s to reduce log spam.
    if (pollCount % 15 === 0) {
      const elapsed = Math.round((pollCount * pollIntervalMs) / 1000);
      console.log(`⏳ Still waiting for token (${elapsed}s elapsed, poll #${pollCount})...`);
    }

    await sleep(pollIntervalMs);
  }
}

/**
 * Prompt user to login to Matters.town
 */
// ============================================================================
// Test-harness escape hatch
// ============================================================================
//
// `MOSS_MATTERS_TEST_PROFILE` lets the onboarding e2e harness bypass the
// real Matters auth flow entirely. When set, the plugin:
//
//  1. (API layer) flips `apiConfig.queryMode = "user"` and sets
//     `apiConfig.testUserName = <profile>`, switching all GraphQL traffic
//     through `graphqlQueryPublic` (no cookies, no token cache).
//
//  2. (UI layer) skips `promptLogin()` outright. The auth webview never
//     opens — without this, the harness still observes the matters.news/
//     login page load and can't assert "import starts immediately".
//
// Both flips are required for end-to-end harness coverage; an API-only
// flip leaves the auth webview visible. The env var is read via the
// allow-listed `get_plugin_env_var` Tauri command (the plugin runtime
// has no direct `process.env` access). Default test profile is `@guo`.
//
// Production behavior is unchanged when the env var is unset — every
// call site degrades to the legacy auth flow.

let testProfileCache: string | null | undefined;

/**
 * Resolve the Matters test profile. Memoized — env vars don't change
 * mid-session, so we read once at first call. Returns `null` (not
 * `undefined`) when explicitly unset so consumers can distinguish
 * "not configured" from "not yet checked".
 *
 * Strips a leading `@` if present so the harness can pass either
 * `@guo` or `guo` and get the same result. `apiConfig.testUserName`
 * stores the bare username.
 */
async function getMattersTestProfile(): Promise<string | null> {
  if (testProfileCache !== undefined) return testProfileCache;
  const raw = await getPluginEnvVar("MOSS_MATTERS_TEST_PROFILE");
  if (!raw) {
    testProfileCache = null;
    return null;
  }
  const trimmed = raw.startsWith("@") ? raw.slice(1) : raw;
  testProfileCache = trimmed;
  console.log(`🧪 Matters: MOSS_MATTERS_TEST_PROFILE=${raw} → public-fetch mode (@${trimmed})`);
  return trimmed;
}

/**
 * Apply the test-profile escape hatch to `apiConfig`. No-op when the env
 * var is unset, so safe to call unconditionally. Returns the profile
 * name if the escape hatch was applied, `null` otherwise — callers use
 * the return value to decide whether to skip auth UI.
 */
async function applyTestProfileEscapeHatch(): Promise<string | null> {
  const profile = await getMattersTestProfile();
  if (!profile) return null;
  apiConfig.queryMode = "user";
  apiConfig.testUserName = profile;
  return profile;
}

/**
 * Persist the reason the last sync FAILED into config.json so the settings panel
 * can surface it even when it was closed at failure time (most syncs are
 * background). Cleared on the next successful sync. Best-effort — a config-write
 * failure must not mask the original sync error.
 */
async function persistSyncError(reason: string): Promise<void> {
  try {
    const cfg = await getConfig();
    await saveConfig({
      ...cfg,
      lastSyncError: reason,
      lastSyncErrorAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`Failed to persist lastSyncError: ${e}`);
  }
}

/**
 * Bind the current folder to the just-authenticated Matters account. Login is
 * the single authoritative binding event (per-folder isolation spec): this runs
 * on EVERY successful login, so all three promptLogin call sites re-bind without
 * touching the call sites. Best-effort — a profile-fetch failure must not fail
 * an otherwise-successful login.
 */
async function affirmBindingFromProfile(): Promise<void> {
  try {
    const profile = await fetchUserProfile();
    // A first login captured the token before anyone knew whose it was; now we
    // do, so it moves under the account's own key (credential.ts keys the
    // app-global store by account, not by folder).
    await bindStoredToken(profile.userName);
    const config = await getConfig();
    if (config.boundUserName !== profile.userName || config.userName !== profile.userName) {
      // Persist the profile language too, so the login-success toast localizes
      // correctly on the FIRST login (before the process hook's Phase-5 save).
      await saveConfig({
        ...config,
        boundUserName: profile.userName,
        userName: profile.userName,
        language: profile.language,
      });
      console.log(`🔗 Bound this folder to @${profile.userName} via login`);
    }
  } catch (e) {
    console.warn(`⚠️ Failed to affirm Matters binding after login: ${e}`);
  }
}

async function promptLogin(): Promise<boolean> {
  // UI-layer escape hatch: when MOSS_MATTERS_TEST_PROFILE is set, skip
  // the login webview entirely and pretend authentication succeeded.
  // The API layer (apiConfig.queryMode = "user") already routes all
  // queries through the public path, so there is nothing to authenticate.
  const testProfile = await getMattersTestProfile();
  if (testProfile) {
    console.log(`🧪 Matters: skipping login UI (test profile @${testProfile})`);
    return true;
  }

  // Force-fresh login (per-folder isolation): clear THIS folder's stored token
  // AND the matters-domain cookies before opening the webview, so (a) the login
  // page shows a real credential screen (no lingering server session) and (b)
  // captureLogin can only capture a freshly-logged-in token — never a stale
  // auth.json token (it reads the stored token before the cookie).
  await beginFreshLogin();

  console.info(`🔐 Opening ${getDomain()} login page (${loginUrl()})...`);

  try {
    const browser = await openBrowser(loginUrl());

    console.info(`🌐 Browser opened. Please log in to ${getDomain()}.`);

    // Phase 2 B2: no maxWaitMs ceiling — poll until token found or user closes.
    // initialDelayMs reduced from 20 s to 1 s so a fast login is not missed.
    const authenticated = await waitForToken(browser);

    if (authenticated) {
      console.info("✅ Login successful, closing browser...");
      // Login is the authoritative binding event: bind THIS folder to the
      // account just authenticated (covers all three promptLogin call sites).
      await affirmBindingFromProfile();
      // Show a success toast so the user gets confirmation that login worked
      // and sync is about to start (Phase 2 B2: today there is NO feedback).
      // We use the Matters profile language stored by affirmBindingFromProfile
      // to pick the locale-appropriate message.
      try {
        const loginConfig = await getConfig();
        const loginUserName = loginConfig.userName ?? loginConfig.boundUserName ?? "";
        await showToast({
          message: mattersLoginSuccessMessage(loginUserName, loginConfig.language),
          variant: "success",
        });
      } catch {
        // Toast failure must not fail the login flow
      }
      try {
        await closeBrowser();
      } catch {
        // Browser might already be closed
      }
      return true;
    } else {
      console.warn("⏱️  Login timeout or window closed. Closing browser...");
      try {
        await closeBrowser();
      } catch {
        // Ignore close errors
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ Login flow failed: ${error}`);
    try {
      await closeBrowser();
    } catch {
      // Ignore close errors
    }
    return false;
  }
}

// ============================================================================
// Hook Implementations
// ============================================================================

/**
 * Standalone login export — invoked by the `connect_account` Tauri command
 * outside any build hook.
 *
 * Creates its own PanelTask and immediately signals `task.awaiting()` so the
 * Rust inactivity watchdog is permanently suppressed for the lifetime of this
 * call (a human login can take arbitrarily long). The login attempt ends on:
 *   - Success (token captured) → task.succeeded + success toast
 *   - User closes the panel  → task.succeeded("dismissed") — no error badge
 *   - Unexpected error       → task.failed (logged, never silent)
 *
 * The underlying login flow (beginFreshLogin → openBrowser → waitForToken →
 * affirmBindingFromProfile → success toast) lives in `promptLogin()` and is
 * shared with the `process` hook's call sites — no duplication.
 *
 * Phase 4a (B1): "Extract login from the hook".
 * Design: docs/archive/2026-06-23-matters-login-lifecycle-and-minimal-browser-design.md §B1
 */
export async function login(context: ProcessContext): Promise<HookResult> {
  clearTokenCache();
  await initializeDomain();

  // Under the test-profile escape hatch, skip the real login entirely.
  const testProfile = await getMattersTestProfile();
  if (testProfile) {
    console.log(`🧪 Matters: skipping login UI (test profile @${testProfile})`);
    return { success: true, message: "Login skipped (test profile)" };
  }

  const task = await startTask("Connect to Matters", {
    trigger: context.trigger ?? "settings_manual",
    hasProgress: false,
    cancellable: false,
  });

  // Immediately signal Awaiting so the Rust inactivity watchdog is suppressed
  // for the entire duration of the login (a human login can take arbitrarily
  // long — the watchdog must never kill this hook). Phase 2 fix ensures the
  // watchdog checks the *executing* hook name ("login"), matching this signal.
  await task.awaiting("Connect to Matters", "", "cancel");

  try {
    console.info("🔐 Matters: standalone login started");
    const loginSuccess = await promptLogin();
    if (loginSuccess) {
      await task.succeeded("Connected to Matters");
      return { success: true, message: "Connected to Matters" };
    } else {
      // User closed the panel — not an error, just dismissed.
      await task.succeeded("Login dismissed");
      // Return to the editor so the user isn't left with an empty panel.
      void returnToEditor().catch(() => { /* best-effort */ });
      return { success: true, message: "Login dismissed by user" };
    }
  } catch (error) {
    const message = `Login failed: ${error}`;
    console.error(`❌ Matters: standalone login error: ${error}`);
    await task.failed(message, true);
    return { success: false, message };
  }
}

/**
 * process hook - Check authentication and sync articles from Matters
 *
 * This capability pre-processes content before generation.
 */
export async function process(context: ProcessContext): Promise<HookResult> {
  setCurrentHookName("process");

  // Auto-Import Posts off: this build has no reason to touch Matters at
  // all — no binding check, no auth routing, no task. A setting the user
  // chose is not an event of this build, so it gets no panel row (not even
  // a bare "Matters auto-import off" line next to "Publish failed").
  // Checked before any of clearTokenCache/initializeDomain/startTask so the
  // deletion is real: no task means no receipt to word carefully. The
  // standalone `login()` export (Connect to Matters in Settings) and the
  // copy hooks are unaffected — none reads this setting.
  const syncOnBuild = context.config?.sync_on_build ?? true;
  if (!syncOnBuild) {
    console.log("ℹ️  Sync on build is disabled, skipping...");
    return { success: true, message: "Matters auto-import off" };
  }

  clearTokenCache();
  await initializeDomain();

  // T8a escape hatch: if MOSS_MATTERS_TEST_PROFILE is set, flip apiConfig
  // to public-fetch mode BEFORE any auth/binding logic runs. The promptLogin
  // helper also checks the env var and skips its UI — together these two
  // flips give the e2e harness a no-auth-webview import path. Idempotent;
  // no-op in production.
  const testProfile = await applyTestProfileEscapeHatch();

  // Start a PanelTask so the breadcrumb hairline animates during import.
  // trigger — moss owns this context (ADR-015): it stamps `context.trigger` when
  //   it invokes the hook. The onboarding card path → "onboarding_flow". Onboarding
  //   tasks take the default process hook, which places them on the workspace
  //   surface, not the ActionPanel. Every build/preview rebuild → "background"
  //   (quiet). The plugin must NOT guess this from its own
  //   state (e.g. the test-profile env var) — that conflated "test mode" with
  //   "user-initiated onboarding" and left the hairline dead in production.
  //   Absent (older moss) ⇒ "background", the safe quiet default.
  const task = await startTask("Importing from Matters", {
    trigger: context.trigger ?? "background",
    hasProgress: true,
    cancellable: false,
  });

  console.log("🔐 Matters: process hook started");

  try {
    // Binding guard: only sync if project is bound to a Matters account
    {
      const bindingConfig = await getConfig();
      // Under the test-profile escape hatch the project is "bound" to the
      // test user implicitly — skip the binding detection / login prompt
      // since the harness already picked the profile.
      if (testProfile) {
        if (bindingConfig.boundUserName !== testProfile) {
          await saveConfig({
            ...bindingConfig,
            boundUserName: testProfile,
            userName: testProfile,
          });
          console.log(`🧪 Matters: auto-bound to @${testProfile} (test profile)`);
        }
      } else if (!bindingConfig.boundUserName) {
        const detectedUser = await detectBoundUser();
        if (detectedUser) {
          // Auto-bind from existing articles
          await saveConfig({ ...bindingConfig, boundUserName: detectedUser, userName: detectedUser });
          await bindStoredToken(detectedUser);
          console.log(`🔗 Auto-bound to @${detectedUser} from existing articles`);
        } else {
          // Fresh project — binding requires login, which only a present
          // user can do. Background rebuilds exit quietly (spec §3.3:
          // background never opens a login window).
          if (!isUserPresent(context.trigger)) {
            console.log("🔗 Not bound and no user present; skipping sync quietly");
            await task.succeeded("No Matters account bound");
            return {
              success: true,
              message: "No Matters account bound. Skipping sync.",
            };
          }
          // Suspend the Rust 60s inactivity watchdog (task.awaiting sets the
          // hook as awaiting permanently until hook teardown — the watchdog
          // skips it while waiting for the user). Immediately follow with a
          // quiet progress label so the UI shows "Connect to Matters" rather
          // than the Awaiting amber pulse (spec: in-band login must not use
          // the Awaiting tone).
          await task.awaiting("Connect to Matters", "", "cancel");
          await task.progress(undefined, "Connect to Matters");
          const loginSuccess = await promptLogin();
          if (!loginSuccess) {
            // Terminate the task before returning, or it stays Running in the
            // registry forever. Not bound ⇒ nothing to import; a clean success.
            await task.succeeded("No Matters account bound");
            // Return to the editor so the user isn't left with an empty panel.
            void returnToEditor().catch(() => { /* best-effort */ });
            return {
              success: true,
              message: "No Matters account bound. Skipping sync.",
            };
          }
          // promptLogin() now affirms the binding (affirmBindingFromProfile) on
          // success — the folder is bound to the just-authenticated account.
        }
      }
    }

    // Phase 1: Authentication — tri-state session check + trigger routing.
    // Background must never open a login window (spec §3.3).
    await task.progress(overallProgress("authentication", 0, 1) / 100, "Checking authentication...");
    const sessionState = await getSessionState();
    const authConfig = await getConfig();
    // queryMode may be stale from a previous fallback run: public_fallback
    // flips it to "user" and module state persists across hook invocations
    // in the webview runtime. Reset to "viewer" here; the test profile owns
    // the flip when set (applied before this phase).
    if (!testProfile) {
      apiConfig.queryMode = "viewer";
    }
    const route = testProfile
      ? "proceed"
      : resolveAuthRoute(sessionState, context.trigger, Boolean(authConfig.userName));
    let isAuthenticated = sessionState === "valid";
    let usingUnauthenticatedMode = false;

    switch (route) {
      case "proceed":
        await task.progress(overallProgress("authentication", 1, 1) / 100, "Authenticated");
        console.log("✅ Matters: session usable, proceeding");
        break;

      case "public_fallback":
        console.log(`🔓 Session ${sessionState}, importing public articles for @${authConfig.userName}`);
        console.log("   Note: Drafts will not be available in unauthenticated mode");
        apiConfig.queryMode = "user";
        apiConfig.testUserName = authConfig.userName!;
        usingUnauthenticatedMode = true;
        isAuthenticated = false;
        if (sessionState === "expired") await notifySessionExpired(context.trigger);
        await task.progress(overallProgress("authentication", 1, 1) / 100, `Using saved user: @${authConfig.userName}`);
        break;

      case "prompt_login": {
        console.log(`🔐 Session ${sessionState}, prompting login (trigger: ${context.trigger})...`);
        // Suspend the Rust 60s inactivity watchdog before showing the login
        // panel (same rationale as the binding path above). Follow immediately
        // with a quiet progress label (spec: no Awaiting amber pulse for
        // in-panel login).
        await task.awaiting("Connect to Matters", "", "cancel");
        await task.progress(undefined, "Connect to Matters");
        const loginSuccess = await promptLogin();
        if (!loginSuccess) {
          await task.failed("Login failed or timeout", true);
          await reportError("Login failed or timeout", "authentication", true);
          // Return to the editor so the user isn't left with an empty panel.
          void returnToEditor().catch(() => { /* best-effort */ });
          return {
            success: false,
            message: "Login failed or timeout. Please try again.",
          };
        }
        isAuthenticated = true;
        await task.progress(overallProgress("authentication", 1, 1) / 100, "Authenticated");
        console.log("✅ Matters: Authenticated");
        break;
      }

      case "soft_fail": {
        // soft_fail is ONLY reached on background/non-user-present triggers
        // (resolveAuthRoute returns soft_fail only when !isUserPresent). A
        // background build showing a persistent error badge on every preview
        // rebuild would be noise. Report as success (a quiet "not connected"
        // / "session expired" receipt) so there is no badge. The auto-open
        // trigger (Phase 4b) and the settings
        // "Connect to Matters" affordance (Phase 4b) carry the actual prompt.
        //
        // 'expired' still logs (notifySessionExpired), but on this
        // background-only branch isUserPresent(trigger) is always false, so
        // the toast itself stays quiet too — the overall task is succeeded,
        // not failed.
        const message =
          sessionState === "expired"
            ? "session expired, log in again to import."
            : "not connected — log in to import.";
        if (sessionState === "expired") await notifySessionExpired(context.trigger);
        // Phase 4a B2: background "needs connection" → silent success (no
        // error badge on every rebuild). NOT task.failed().
        // The receipt renders bare in the panel — it must name Matters, and
        // it must reflect the real session state rather than always reading
        // "not connected": an expired login and a never-connected one are
        // different facts. This receipt is reachable only when Auto-Import
        // Posts is on (the setting is checked at the top of the hook,
        // before this whole auth phase runs) — it fires on every background
        // rebuild for a bound-but-unauthenticated project until the user
        // connects.
        await task.succeeded(sessionState === "expired" ? "Matters session expired" : "Matters not connected");
        return { success: true, message };
      }
    }

    // Get config for incremental sync
    const pluginConfig = await getConfig();
    const lastSyncedAt = pluginConfig.lastSyncedAt;
    if (lastSyncedAt) {
      console.log(`📅 Last synced at: ${lastSyncedAt}`);
    } else {
      console.log("📅 No previous sync - will fetch all articles");
    }

    // Phase 2: Fetch articles (with incremental sync)
    await task.progress(overallProgress("fetching_articles", 0, 1) / 100, "Fetching articles from Matters.town...");
    const { articles, userName } = await fetchAllArticlesSince(lastSyncedAt);
    await task.progress(overallProgress("fetching_articles", 1, 1) / 100, `Found ${articles.length} article(s) to sync`);
    console.log(`   Found ${articles.length} article(s) to sync`);

    // Phase 3: Fetch drafts
    await task.progress(overallProgress("fetching_drafts", 0, 1) / 100, "Fetching drafts from Matters.town...");
    const drafts = await fetchAllDraftsSince(lastSyncedAt);
    await task.progress(overallProgress("fetching_drafts", 1, 1) / 100, `Found ${drafts.length} draft(s)`);
    console.log(`   Found ${drafts.length} draft(s)`);

    // Phase 4: Fetch collections
    await task.progress(overallProgress("fetching_collections", 0, 1) / 100, "Fetching collections from Matters.town...");
    const allCollections = await fetchAllCollections();
    const knownCollectionIds = new Set(pluginConfig.knownCollectionIds || []);
    const newCollections = allCollections.filter(c => !knownCollectionIds.has(c.id));
    await task.progress(overallProgress("fetching_collections", 1, 1) / 100, `Found ${newCollections.length} new collection(s) (${allCollections.length} total)`);
    console.log(`   Found ${newCollections.length} new collection(s) (${allCollections.length} total)`);

    // Phase 5: Fetch user profile (for homepage and language detection)
    await task.progress(overallProgress("fetching_profile", 0, 1) / 100, "Fetching user profile...");
    const profile = await fetchUserProfile();
    await task.progress(overallProgress("fetching_profile", 1, 1) / 100, `Profile: ${profile.displayName}`);
    console.log(`   Profile: ${profile.displayName} (language: ${profile.language || "default"})`);

    // Save userName to config for future unauthenticated fallback (only when authenticated)
    if (isAuthenticated && !usingUnauthenticatedMode) {
      try {
        const existingConfig = await getConfig();
        if (existingConfig.userName !== profile.userName || existingConfig.language !== profile.language) {
          await saveConfig({
            ...existingConfig,
            userName: profile.userName,
            language: profile.language,
          });
          console.log(`   Saved username @${profile.userName} to config for future unauthenticated access`);
        }
      } catch (error) {
        // Non-fatal: just log the error
        console.warn(`   Failed to save config: ${error}`);
      }
    }

    // Phase 6: Sync to local files
    // Route sub-phase progress (per-item sync, per-image media download) to the
    // unified import task so the hairline advances THROUGH the long phases
    // instead of stalling. Takes the (phase, absolute-0-100, total=100) shape
    // the sub-phases emit and converts to the task's 0-1 fraction; fire-and-
    // forget so a slow IPC never blocks the import worker. Replaces the legacy
    // `reportProgress` SDK path, which the progress panel drops for `process`.
    const reportToTask: ProgressReporter = (_phase, current, total, message) => {
      void task.progress(total > 0 ? current / total : 0, message).catch(() => {});
    };

    const syncTotal = articles.length + drafts.length + allCollections.length + 1;
    await task.progress(overallProgress("syncing", 0, syncTotal) / 100, "Starting sync...");
    const { result: syncResult, articlePathMap, syncedCollectionIds } = await syncToLocalFiles(
      articles,
      drafts,
      allCollections,
      userName,
      context.config || {},
      profile,
      context.project_info.homepage_file,
      context.project_info.folder_name,
      reportToTask,
      knownCollectionIds,
    );

    // Build the NOUN-LED article summary ("12 articles already up to date"),
    // not a bare "12 unchanged". One headline fact for the progress surface.
    const summary = formatArticleSyncSummary({
      created: syncResult.created,
      updated: syncResult.updated,
      skipped: syncResult.skipped,
      failed: syncResult.errors.length,
    });
    await task.progress(overallProgress("syncing", syncTotal, syncTotal) / 100, `Sync complete: ${summary}`);
    console.log(`✅ Sync complete: ${summary}`);

    // Phase 7: Post-sync processing (run SEQUENTIALLY to avoid race conditions)
    // Both operations read/write the same markdown files, so they must not run in parallel.
    // Order: Media download first (updates image references), then link rewriting
    await downloadMediaAndUpdate(reportToTask);
    await task.progress(overallProgress("rewriting_links", 0, 1) / 100, "Rewriting internal links...");
    const linkResult = await rewriteAllInternalLinks(articlePathMap, userName);
    await task.progress(overallProgress("rewriting_links", 1, 1) / 100, `Rewrote ${linkResult.linksRewritten} internal links`);

    // Permanently-failed image downloads are persisted to failed-media.json by
    // downloadMediaAndUpdate and surfaced in the Matters settings page as an
    // informational list. No per-URL advisory is filed here: dead CDN URLs are
    // non-actionable and repetitive; the settings page is the right surface for
    // an inventory the user can review at leisure.

    const linkSummary =
      linkResult.linksRewritten > 0
        ? `, ${linkResult.linksRewritten} internal links rewritten`
        : "";

    // Phase 8: Fetch social data (comments only)
    // First, ask Matters once for `commentCount` per article (one paginated
    // pass). For each local article, skip the per-article comments query
    // entirely when the remote count matches what we recorded last sync.
    // Inside the per-article fetch, the existing `knownIds` + `lastSyncedAt`
    // short-circuits still apply to bound page-level work.
    let socialSummary = "";
    const articlesForSocialFetch = await scanLocalArticles();
    console.log(`📊 Checking social data for ${articlesForSocialFetch.length} local articles`);

    // Build shortHash → uid map for the legacy reconcile (issue #793).
    // scanLocalArticles() returns both fields; a null uid means the file
    // hasn't been built yet — those entries stay keyed by shortHash.
    const shortHashToUid = new Map<string, string>();
    for (const a of articlesForSocialFetch) {
      if (a.uid) shortHashToUid.set(a.shortHash, a.uid);
    }

    // One-time migration: if .moss/social/matters.json (legacy path) still
    // exists, merge it into .moss/data/social/matters.json and retire it.
    // loadSocialData() loads from the new canonical path; reconcile is called
    // on the initial load result so the merge happens before any fetch below.
    //
    // We call reconcile here (after scanLocalArticles) because the uid↔shortHash
    // mapping is needed to remap legacy shortHash-keyed entries to uid keys.
    {
      const preReconcile = await loadSocialData();
      const migrated = await reconcileLegacySocialData(preReconcile, shortHashToUid);
      if (migrated) {
        console.log("[matters] Legacy social data reconciled — reloading canonical store");
      }
    }

    if (articlesForSocialFetch.length > 0) {
      await task.progress(overallProgress("fetching_social", 0, articlesForSocialFetch.length) / 100, "Checking for new comments...");

      // One paginated query that returns {shortHash, commentCount} for the
      // user's whole library. ~4 queries per 200 articles vs. the previous
      // 200+ per-article queries. If this fails (network, etc.) we fall back
      // to checking every article so we don't silently drop new comments.
      let remoteCounts: Map<string, number> | null = null;
      try {
        remoteCounts = await fetchAllArticleCommentCounts();
        console.log(`📊 Got commentCount for ${remoteCounts.size} remote articles`);
      } catch (error) {
        console.warn(`   commentCount discovery failed (${error}); falling back to per-article fetch`);
      }

      const socialData = await loadSocialData();
      let totalComments = 0;
      let fetched = 0;
      let skipped = 0;
      // saveSocialData runs once per article (see the comment at the call
      // site below); a single bad run can fail every one of those saves, and
      // logging each at ERROR floods the build log without adding
      // information after the first. Count failures here and report once,
      // after the loop, with the last error as the representative sample.
      let socialSaveFailures = 0;
      let lastSocialSaveError: unknown;

      for (let i = 0; i < articlesForSocialFetch.length; i++) {
        const article = articlesForSocialFetch[i];
        await task.progress(
          overallProgress("fetching_social", i + 1, articlesForSocialFetch.length) / 100,
          `Social data: ${article.title}`
        );

        try {
          // Compute social key: uid when available, fall back to path
          const socialKey = article.uid || article.path;
          if (!article.uid) {
            console.warn(`   Article "${article.title}" has no uid, falling back to path as social data key`);
          }

          // Skip the comments fetch when the remote count exactly matches
          // what we saw last sync. See shouldSkipSocialFetch (above) for the
          // full predicate rationale and known soft-correctness gap.
          const remoteCount = remoteCounts?.get(article.shortHash);
          const storedCount = socialData.articles[socialKey]?.lastKnownCommentCount;

          // Pass known comment IDs for early-exit pagination optimization
          const existingComments = socialData.articles[socialKey]?.comments || [];
          if (shouldSkipSocialFetch(remoteCount, storedCount, existingComments.length)) {
            skipped++;
            continue;
          }

          const knownIds = new Set(existingComments.map(c => c.id));
          // See resolveSinceTimestamp (above) for the full rationale.
          const sinceTimestamp = resolveSinceTimestamp(existingComments.length, storedCount, lastSyncedAt);
          const comments = await fetchArticleComments(article.shortHash, knownIds, sinceTimestamp);

          mergeSocialData(socialData, socialKey, comments, [], [], remoteCount);

          totalComments += comments.length;
          fetched++;

          // Save after each article to avoid losing data if later fetches hang.
          // Its own failure is tracked separately from a fetch failure (below)
          // so it can be reported once, after the loop, instead of per article.
          try {
            await saveSocialData(socialData);
          } catch (saveError) {
            socialSaveFailures++;
            lastSocialSaveError = saveError;
          }
        } catch (error) {
          console.warn(`   Failed to fetch social data for ${article.title}: ${error}`);
        }
      }

      // Only announce comments when there ARE new ones — "0 new comments" is
      // noise that bloated the receipt and pushed the real outcome past the
      // truncation edge.
      if (totalComments > 0) {
        socialSummary = `, ${totalComments} new comment${totalComments === 1 ? "" : "s"}`;
      }
      console.log(`✅ Social data: ${fetched} fetched, ${skipped} skipped (no change), ${totalComments} new comments`);
      if (socialSaveFailures > 0) {
        console.error(
          `[matters] saveSocialData failed ${socialSaveFailures}/${fetched} time(s) this build — comments were fetched but not persisted. Last error: ${lastSocialSaveError}`
        );
      }
    }

    // Phase 9: Update lastSyncedAt timestamp
    const syncEndTime = new Date().toISOString();
    try {
      const currentConfig = await getConfig();
      await saveConfig({
        ...currentConfig,
        lastSyncedAt: syncEndTime,
        // Union, never overwrite: a collection missing from one remote fetch
        // keeps its identity, and a collection whose creation failed this run
        // (absent from syncedCollectionIds) is retried next run instead of
        // being gated forever.
        knownCollectionIds: nextKnownCollectionIds(
          currentConfig.knownCollectionIds,
          syncedCollectionIds,
        ),
        // Clear any prior failure now that a sync has succeeded, so the settings
        // panel stops showing a stale "Last sync failed" once things recover.
        lastSyncError: undefined,
        lastSyncErrorAt: undefined,
      });
      console.log(`📅 Updated lastSyncedAt to ${syncEndTime}`);
    } catch (error) {
      console.warn(`Failed to save lastSyncedAt: ${error}`);
    }

    // Only core sync errors are critical; media/link errors are non-critical (nice-to-have)
    // This allows partial success (e.g., all articles synced but some images failed to download)
    const criticalErrors = syncResult.errors;
    const finalMessage = `Synced from Matters: ${summary}${linkSummary}${socialSummary}`;

    // Honest receipt for EVERY unauthenticated-mode run (spec §3.3),
    // state-aware: expired session vs never-logged-in route differently.
    // Leading ". " closes the unpunctuated summary before it (otherwise
    // the receipt reads "no changes Matters session expired; ...").
    const unauthNote = usingUnauthenticatedMode
      ? sessionState === "expired"
        ? ". Matters session expired; log in to resume drafts and syndication."
        : ". Not logged in; log in to also import drafts."
      : "";

    if (criticalErrors.length === 0) {
      await task.succeeded(`${summary}${linkSummary}${socialSummary}${unauthNote}`);
    } else {
      await task.failed(`${criticalErrors.length} sync error(s)`, true);
      await persistSyncError(`${criticalErrors.length} sync error(s)`);
    }

    return {
      success: criticalErrors.length === 0,
      message: finalMessage,
    };
  } catch (error) {
    if (error instanceof MattersAuthError) {
      // Pre-flight passed but the server revoked the token mid-run (rare).
      // graphqlQuery already stamped invalidatedAt, so the NEXT run routes
      // through the expired-session table; here we fail with honest copy.
      const message = "session expired, log in again to import.";
      await notifySessionExpired(context.trigger);
      await task.failed(message, true);
      await persistSyncError(message);
      console.error("❌ Matters: sync aborted, session rejected by server");
      return { success: false, message };
    }
    const cause = error instanceof Error ? error.message : String(error);
    // recoverable=true → NeedsAction severity → no persistent blocking toast
    // (the PanelTask badge is the self-reported failure surface for login-capable
    // plugins; a separate Blocking toast would be a double-signal).
    await task.failed(`Sync failed: ${cause}`, true);
    await reportError(`Sync failed: ${cause}`, "process", true);
    await persistSyncError(`Sync failed: ${cause}`);
    console.error(`❌ Matters: Sync failed: ${cause}`);
    return {
      success: false,
      message: `Sync failed: ${cause}`,
    };
  }
}

export { publish_copy, find_copy, update_copy, delete_copy } from "./copies";
