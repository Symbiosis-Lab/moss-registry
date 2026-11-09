/**
 * Matters.town plugin: imports a Matters account's articles into the folder,
 * and posts copies of the site's posts to Matters through moss's syndication
 * contract (moments for short posts, drafts for articles).
 * Requires authentication via webview (domain: matters.town)
 */

import type {
  ProcessContext,
  HookResult,
  MattersDraftWithArticle,
  PutDraftInput,
} from "./types";
import {
  reportError,
  setCurrentHookName,
  sleep,
  formatArticleSyncSummary,
} from "./utils";
import { startTask, type CopyJob, type CopyOutcome } from "@symbiosis-lab/moss-api";
import {
  fetchAllArticlesSince,
  fetchAllDraftsSince,
  fetchAllCollections,
  fetchUserProfile,
  fetchArticleComments,
  fetchAllArticleCommentCounts,
  fetchAllArticles,
  fetchAllDrafts,
  createDraft,
  fetchDraft,
  putMoment,
  uploadAssetMultipart,
  apiConfig,
  MattersAuthError,
  MattersRefusal,
} from "./api";
import {
  clearTokenCache,
  getSessionState,
  shouldNudgeSessionExpired,
  captureLogin,
  beginFreshLogin,
  bindStoredToken,
  prepareWebviewAuth,
} from "./credential";
import { resolveAuthRoute, isUserPresent } from "./auth-route";
import { syncToLocalFiles, scanLocalArticles, detectBoundUser, nextKnownCollectionIds } from "./sync";
import { downloadMediaAndUpdate, rewriteAllInternalLinks } from "./downloader";
import { getConfig, saveConfig } from "./config";
import { overallProgress, type ProgressReporter } from "./progress";
import { loadSocialData, saveSocialData, mergeSocialData, reconcileLegacySocialData } from "./social";
import {
  readSiteFile,
  showToast,
  getPluginEnvVar,
  emitEvent,
  onEvent,
} from "@symbiosis-lab/moss-api";
import {
  initializeDomain,
  getDomain,
  loginUrl,
  draftUrl,
  articleUrl,
  momentUrl,
} from "./domain";
import { looksLikePublishedArticleUrl } from "./url-detect";

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

/**
 * `keepPanelLoading`: on success, return the panel to its loading state
 * (`openBrowser()` with no URL) instead of closing it, so the caller can keep
 * the same panel up until its next page navigates in place.
 */
async function promptLogin(options: { keepPanelLoading?: boolean } = {}): Promise<boolean> {
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
      if (options.keepPanelLoading) {
        await openBrowser();
      } else {
        try {
          await closeBrowser();
        } catch {
          // Browser might already be closed
        }
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

// ============================================================================
// Copies: moss's syndication contract
// ============================================================================

type Cause = NonNullable<CopyOutcome["refused"]>["cause"];

function refusal(cause: Cause, message: string): HookResult {
  return { success: false, message, copy: { refused: { cause, message } } };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A request Matters answered with a refusal created nothing, so moss may send
 * again; any other failure leaves unknown whether it did, and is thrown so moss
 * never makes the copy twice.
 */
function refusedOrThrow(error: unknown): HookResult {
  if (error instanceof MattersAuthError) return refusal("auth", "the Matters session expired; sign in again");
  if (error instanceof MattersRefusal) return refusal(error.status === 429 ? "rate" : "content", error.message);
  throw error;
}

const SIGN_IN = "connect Matters first: sign in from the plugin's settings";

/** Post one copy: a short post as a moment, an article as a draft the author publishes in Matters' editor. */
export async function publish_copy(job: CopyJob): Promise<HookResult> {
  setCurrentHookName("publish_copy");
  try {
    clearTokenCache();
    await initializeDomain();
  } catch (error) {
    return refusal("network", errorText(error));
  }
  if ((job.form === "short" || job.form === "teaser") && job.parts?.[0]) return postMoment(job.parts[0]);
  if (job.form === "long" && job.article?.html.trim()) return draftArticle(job, job.article);
  return refusal("content", "Matters takes a moment or an article with a body");
}

/**
 * Whether a copy is on Matters: a handed-off draft by its id, published or
 * still waiting; else, after an interrupted send, an article or draft of the
 * same title that links to the post.
 */
export async function find_copy(job: CopyJob): Promise<HookResult> {
  setCurrentHookName("find_copy");
  try {
    clearTokenCache();
    await initializeDomain();
    const draftId = job.previous?.id;
    if (draftId) {
      const draft = await fetchDraft(draftId);
      // A draft the author deleted is no copy: moss sends it again.
      if (!draft) return { success: true, copy: null };
      return { success: true, copy: draft.article ? copyOf(draft.article, await viewerName()) : waiting(draft.id) };
    }
    if (job.form !== "long" || !job.article) return { success: false, message: "Matters cannot look a moment up" };
    const { articles, userName } = await fetchAllArticles();
    const article = articles.find((a) => a.title === job.article!.title && a.content.includes(job.post.url));
    if (article) return { success: true, copy: copyOf(article, userName) };
    const draft = await unpublishedDraftOf(job.post.url, job.article.title);
    return { success: true, copy: draft ? waiting(draft) : null };
  } catch (error) {
    return { success: false, message: errorText(error) };
  }
}

async function postMoment(part: { text: string; links: string[] }): Promise<HookResult> {
  try {
    if ((await getSessionState()) !== "valid") return refusal("auth", SIGN_IN);
    const moment = await putMoment(momentHtml(part.text, part.links));
    return { success: true, copy: { id: moment.id, url: momentUrl(moment.shortHash) } };
  } catch (error) {
    return refusedOrThrow(error);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A moment's HTML: paragraphs, line breaks, and each address as a link. */
export function momentHtml(text: string, links: string[]): string {
  let html = "";
  let from = 0;
  for (const link of links) {
    const at = text.indexOf(link, from);
    if (at < 0) continue;
    html += escapeHtml(text.slice(from, at)) + `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`;
    from = at + link.length;
  }
  html += escapeHtml(text.slice(from));
  return html
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function waiting(draftId: string): CopyOutcome {
  return { handoff: { text: "", open_url: draftUrl(draftId), id: draftId } };
}

/**
 * Put the article into a Matters draft and, where the panel can show it (the
 * app; a terminal cannot), open it for the author and wait while they publish
 * it. Closed without publishing, or with no panel, the draft is handed to the
 * author, and moss's later `find_copy` adopts it once published.
 */
async function draftArticle(job: CopyJob, article: NonNullable<CopyJob["article"]>): Promise<HookResult> {
  const shown = await openBrowser().then(
    () => true,
    () => false,
  );
  try {
    let draft: MattersDraftWithArticle;
    let userName: string;
    try {
      if ((await getSessionState()) !== "valid" && !(shown && (await promptLogin({ keepPanelLoading: true })))) {
        return refusal("auth", SIGN_IN);
      }
      userName = await viewerName();
      draft = await putArticleDraft(job, article);
    } catch (error) {
      return refusedOrThrow(error);
    }
    // The draft exists from here on, so nothing below may answer "refused": a
    // resend would make a second one. Whatever fails, it waits for the author.
    const handoff: HookResult = { success: true, copy: waiting(draft.id) };
    if (!shown) return handoff;
    try {
      // The draft room authenticates by cookie, so it gets THIS folder's account.
      await prepareWebviewAuth();
      const browser = await openBrowser(draftUrl(draft.id));
      const task = await startTask("Publish on Matters", { hook: "syndicate", trigger: "manual_one", hasProgress: false, cancellable: false });
      // Awaiting suspends moss's inactivity watchdog for as long as the author writes.
      await task.awaiting("publish the draft", "Matters editor", "cancel");
      // A publish in the same moment as the close can lose the race, so ask once more.
      const published = (await waitForPublishOrClose(draft.id, browser)) ?? (await fetchDraft(draft.id))?.article ?? null;
      await task.succeeded();
      if (published) return { success: true, copy: copyOf(published, userName) };
    } catch (error) {
      console.warn(`    ⚠️ Matters editor: ${errorText(error)}; the draft waits for the author`);
    }
    return handoff;
  } finally {
    if (shown) await closeBrowser().catch(() => {});
  }
}

async function viewerName(): Promise<string> {
  return (await getConfig()).userName ?? (await fetchUserProfile()).userName;
}

function copyOf(article: { shortHash: string; slug: string }, userName: string): { id: string; url: string } {
  return { id: article.shortHash, url: articleUrl(userName, article.slug, article.shortHash) };
}

/**
 * An unpublished draft of this post: the same title, and a link to the post,
 * which every draft this plugin makes carries. A resend reuses it rather than
 * adding another, and leaves a draft of the author's own alone.
 */
async function unpublishedDraftOf(postUrl: string, title: string): Promise<string | undefined> {
  for (const draft of (await fetchAllDrafts()).filter((d) => d.title === title && d.content?.includes(postUrl))) {
    const state = await fetchDraft(draft.id);
    if (state && !state.article && state.publishState === "unpublished") return draft.id;
  }
  return undefined;
}

/**
 * The article as a Matters draft: its body rewritten for Matters' sanitizer,
 * links and media made absolute, then cover and media uploaded as bytes, since
 * Matters cannot reliably fetch them from the site. An upload that fails
 * leaves the site's address in place.
 */
async function putArticleDraft(job: CopyJob, article: NonNullable<CopyJob["article"]>): Promise<MattersDraftWithArticle> {
  const canonicalUrl = job.post.url;
  let content = normalizeHtmlForMatters(stripArticleTitleH1(article.html, article.title));
  if (job.config.add_canonical_link ?? true) {
    content = addCanonicalLinkToContent(content, canonicalUrl, job.post.lang ?? undefined);
  }
  content = wrapAudioForMatters(absolutizeRelativeHrefs(content, canonicalUrl), canonicalUrl);

  const input: PutDraftInput = {
    title: article.title,
    content,
    tags: job.post.tags ?? [],
    ...(article.description ? { summary: article.description } : {}),
  };
  const existing = job.previous?.id ?? (await unpublishedDraftOf(canonicalUrl, article.title));
  let draft: MattersDraftWithArticle;
  try {
    draft = await createDraft(existing ? { ...input, id: existing } : input);
  } catch (error) {
    if (!existing) throw error;
    console.warn(`    ⚠️ Draft ${existing} could not be reused, creating a new one: ${error}`);
    draft = await createDraft(input);
  }

  const coverPath = article.cover ? siteRelativePathFromSrc(article.cover, canonicalUrl) : null;
  if (coverPath) {
    try {
      const filename = coverPath.split("/").pop() || "cover";
      const cover = await uploadAssetMultipart(await readSiteFile(coverPath), filename, imageMimeForPath(coverPath), "cover", draft.id);
      await createDraft({ id: draft.id, title: draft.title, cover: cover.id });
    } catch (error) {
      console.warn(`    ⚠️ Cover upload failed, continuing without cover: ${error}`);
    }
  }
  try {
    const rewritten = await uploadAndReplaceLocalAudio(await uploadAndReplaceLocalImages(content, canonicalUrl, draft.id), canonicalUrl, draft.id);
    if (rewritten !== content) await createDraft({ id: draft.id, title: draft.title, content: rewritten });
  } catch (error) {
    console.warn(`    ⚠️ Asset upload failed, the draft keeps the site's addresses: ${error}`);
  }
  return draft;
}

/**
 * Wait for the draft to be published or the panel to be closed: a 5 s poll,
 * the panel's close, and a navigation to an article page (a trigger only; the
 * API is the truth) race, and exactly one settles. There is no time limit: the
 * caller's awaiting signal keeps moss's watchdog off while the author writes.
 *
 * @internal exported for unit tests only
 */
export async function waitForPublishOrClose(
  draftId: string,
  browserHandle?: BrowserHandle
): Promise<{ shortHash: string; slug: string } | null> {
  const pollIntervalMs = 5000;

  return new Promise<{ shortHash: string; slug: string } | null>((resolve) => {
    let settled = false;
    let unlistenUrl: (() => void) | undefined;

    function settle(value: { shortHash: string; slug: string } | null): void {
      if (settled) return;
      settled = true;
      // A listener left behind would fire again for the next article.
      if (unlistenUrl) unlistenUrl();

      if (value) {
        // Hold the "Published to Matters" bar in view briefly before the panel closes.
        (async () => {
          try {
            await emitEvent("matters-room-published");
          } catch (err) {
            console.warn(`    ⚠️ Failed to emit matters-room-published: ${err}`);
          }
          await sleep(800);
          closeBrowser().catch(() => { /* already closed */ });
          resolve(value);
        })();
      } else {
        resolve(value);
      }
    }

    (async () => {
      while (!settled) {
        await sleep(pollIntervalMs);
        if (settled) break;
        try {
          const draft = await fetchDraft(draftId);
          if (draft?.article) {
            settle({ shortHash: draft.article.shortHash, slug: draft.article.slug });
          }
        } catch (err) {
          console.warn(`    ⚠️ Error checking draft status: ${err}`);
        }
      }
    })();

    if (browserHandle) {
      browserHandle.closed.then(() => settle(null));
    }

    onEvent<{ url: string }>("browser-url-changed", async (payload) => {
      if (settled || !looksLikePublishedArticleUrl(payload.url)) return;
      try {
        const draft = await fetchDraft(draftId);
        if (draft?.article) {
          settle({ shortHash: draft.article.shortHash, slug: draft.article.slug });
        }
      } catch (err) {
        console.warn(`    ⚠️ URL-triggered verify failed: ${err}`);
      }
    }).then((fn) => {
      unlistenUrl = fn;
    }).catch((err) => {
      // No event bridge (a test, say): the poll still settles it.
      console.warn(`    ⚠️ Could not register browser-url-changed listener: ${err}`);
    });
  });
}

/**
 * Strip moss's auto-injected article-title `<h1 class="moss-article-title">`
 * when its plain text equals the article's title. matters.town has its own
 * title field on the draft, so leaving the h1 in the body content produces a
 * visible duplicate ("Title" rendered as the heading + "Title" rendered as
 * the matters page H1 above it).
 *
 * Tolerates other `<h1>` tags in the body — only removes the moss-class one,
 * and only when its content matches. Authors who genuinely want a leading H1
 * with the same text as the title can opt out by removing the moss class.
 *
 * Exported for unit testing.
 */
export function stripArticleTitleH1(html: string, articleTitle: string): string {
  // Match <h1 ...class="...moss-article-title..."...>INNER</h1>
  const re = /<h1\b[^>]*class="[^"]*\bmoss-article-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/gi;
  return html.replace(re, (full, inner: string) => {
    // Compare plain text — strip tags and collapse whitespace on both sides.
    const innerText = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const titleText = articleTitle.replace(/\s+/g, " ").trim();
    return innerText === titleText ? "" : full;
  });
}

/**
 * Absolutize relative `href` values on `<a>` elements against `baseUrl`.
 *
 * matters.town's editor preserves whatever URL we pass in the draft HTML.
 * Relative hrefs (e.g. `../../scale-compare.html`) end up resolved by the
 * matters editor against `https://matters.town/...`, breaking every internal
 * link from the original site. Resolve against the article's own canonical
 * URL so links retain their original meaning when viewed inside matters.
 *
 * - Skips absolute URLs (http://, https://, mailto:, data:, etc.)
 * - Skips fragment-only links (`#section`) — those reference the matters
 *   draft's own headings and should stay intra-document.
 * - Skips hrefs we can't resolve (logs and leaves them alone).
 *
 * Exported for unit testing.
 */
/**
 * Resolve a single URL against `baseUrl`, returning it UNCHANGED when it is
 * already absolute (has a scheme), scheme-relative (`//host`), a fragment
 * (`#x`), or cannot be parsed. Shared by `absolutizeRelativeHrefs` (links) and
 * `wrapAudioForMatters` (audio `<source>` srcs) so both resolve article-relative
 * references against the article's canonical URL the same way.
 */
function absolutizeUrl(url: string, baseUrl: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) {
    return url;
  }
  try {
    return new URL(url, baseUrl).href;
  } catch (error) {
    console.warn(`    ⚠️ Could not resolve URL ${url} against ${baseUrl}: ${error}`);
    return url;
  }
}

export function absolutizeRelativeHrefs(html: string, baseUrl: string): string {
  // Linear: scan each <a> tag, then rewrite its href within the short tag
  // string. One regex with [^>]*? … [^>]* around href= backtracks polynomially
  // on hostile input (CodeQL js/polynomial-redos); splitting the scan from the
  // attribute read removes the ambiguity. The function replacer keeps any `$`
  // in the URL literal.
  return html.replace(/<a\b[^>]*>/gi, (tag) =>
    tag.replace(/(\shref=")([^"]+)(")/i, (m, pre: string, href: string, post: string) => {
      const absolute = absolutizeUrl(href, baseUrl);
      return absolute === href ? m : `${pre}${absolute}${post}`;
    }),
  );
}

/**
 * Strip moss's heading-anchor permalinks from headings.
 *
 * moss appends an empty `<a class="moss-heading-anchor" href="#…"></a>` to
 * every heading for web navigation; the `#` a reader sees is drawn by CSS
 * (`::after`), not text. It syndicates as an empty link — and before the glyph
 * moved into CSS it syndicated as "1.#", a stray linked `#`, because matters'
 * sanitizer kept the anchor's text. Neither is content, so we remove the whole
 * anchor before syndication and this keeps working either way.
 * Verified 2026-06-16 against `server.matters.icu`.
 *
 * Exported for unit testing.
 */
export function stripHeadingAnchors(html: string): string {
  return html.replace(
    /<a\b[^>]*\bclass="[^"]*\bmoss-heading-anchor\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    "",
  );
}

export function normalizeHtmlForMatters(html: string): string {
  let result = html;

  // Step 0: Remove moss heading-anchor permalinks (web-only chrome whose `#`
  // would otherwise leak into matters' heading text). See stripHeadingAnchors.
  result = stripHeadingAnchors(result);

  // Step 0.5: Reshape moss math into the shapes matters' sanitizer keeps.
  // MUST run before Step 3 (`wrapImagesForMatters`) so that any future
  // math-as-figure emission is already shaped and Step E's bare-<img>
  // auto-wrap cannot reach inside it. See transformMathForMatters.
  result = transformMathForMatters(result).html;

  // Step 0.6: matters' sanitizer allows no `<svg>` element and unwraps it to
  // its children — and `<path>` has no text, so an inline SVG silently
  // DISAPPEARS while syndication still reports success. Nothing moss emits
  // today puts an SVG in article body HTML; if that ever changes (P2 typeset
  // math is the expected source), the loss must not be silent.
  if (/<svg\b/i.test(result)) {
    console.warn(
      "    ⚠️ Article body contains <svg>, which matters' sanitizer deletes " +
        "silently (the element is unwrapped and <path> has no text). The " +
        "syndicated copy will be missing that content.",
    );
  }

  // Step 1: Collapse h4, h5, h6 → h3 (process these BEFORE h1 to avoid double-shifting)
  result = result.replace(/<(\/?)h[456](\s[^>]*)?>/gi, (_match, slash, attrs) => {
    return `<${slash}h3${attrs || ""}>`;
  });

  // Step 2: Downgrade h1 → h2
  result = result.replace(/<(\/?)h1(\s[^>]*)?>/gi, (_match, slash, attrs) => {
    return `<${slash}h2${attrs || ""}>`;
  });

  // Step 3: Wrap images in matters' required <figure class="image"> shell.
  result = wrapImagesForMatters(result);

  return result;
}

/**
 * A paragraph open tag, with or without attributes.
 *
 * Every "is this element ALONE in its paragraph?" hoist below must use this,
 * never a literal `<p>`: `job.article.html` is the build's `html_content`,
 * not the shipped page, so every top-level paragraph arrives as
 * `<p data-source-line="N">` and a literal `<p>` pattern matches nothing.
 */
const PARAGRAPH_OPEN = "<p(?:\\s[^>]*)?>";

/**
 * Convert every moss image-emission pattern into matters' required shape:
 * `<figure class="image"><img src="..."><figcaption>...</figcaption></figure>`.
 *
 * Matters' server-side sanitizer is strict (smoke-tested 2026-05-27 against
 * `server.matters.icu`):
 *
 *   - `<img>` outside a `<figure class="image">` → STRIPPED
 *   - `<figure class="moss-image">` → STRIPPED (along with contents)
 *   - `<figure>` (no class) → STRIPPED
 *   - `<figure class="image">` without a `<figcaption>` child → causes a
 *     server error ("Cannot read properties of undefined (reading 'firstChild')")
 *   - `<figure class="image">` with `<figcaption>` (empty is fine) → KEPT
 *   - `<picture>` inside `<figure class="image">` → kept on POST, server
 *     normalizes to bare `<img>` on read
 *
 * So we restore the wrap the matters plugin used to apply pre-Phase-2A,
 * but adapted for moss's new emission patterns (`<picture>` wrappers and
 * `<figure class="moss-image">` shells).
 *
 * Exported for unit testing.
 */
export function wrapImagesForMatters(html: string): string {
  let result = html;

  // Step A: Rename `<figure class="moss-image">` → `<figure class="image">`,
  // adding an empty `<figcaption>` if the body doesn't already have one.
  result = result.replace(
    /<figure\b[^>]*\bclass="[^"]*\bmoss-image\b[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi,
    (_full, body) => {
      const hasFigcap = /<figcaption\b/i.test(body);
      const bodyWithCap = hasFigcap ? body : `${body}<figcaption></figcaption>`;
      return `<figure class="image">${bodyWithCap}</figure>`;
    },
  );

  // Helper: is `offset` inside an open `<figure>` or `<picture>` in `src`?
  // Looks back 400 chars (longer than any plausible single element start) for
  // an unclosed tag.
  const isInside = (src: string, offset: number, tag: "figure" | "picture"): boolean => {
    const preceding = src.substring(Math.max(0, offset - 400), offset);
    const openIdx = preceding.lastIndexOf(`<${tag}`);
    const closeIdx = preceding.lastIndexOf(`</${tag}`);
    return openIdx > closeIdx;
  };

  // Step B: `<p>` containing only a `<picture>` → hoist to a figure wrap.
  // A `<figure>` inside a `<p>` is invalid HTML and matters' parser splits the
  // `<p>` around it, producing stray empty `<p></p>` siblings. Hoist first.
  // The open tag must allow attributes — see PARAGRAPH_OPEN.
  result = result.replace(
    new RegExp(`${PARAGRAPH_OPEN}\\s*(<picture\\b[^>]*>[\\s\\S]*?</picture>)\\s*</p>`, "gi"),
    (_full, picture: string) => `<figure class="image">${picture}<figcaption></figcaption></figure>`,
  );

  // Step C: Wrap remaining standalone `<picture>` blocks (not already inside
  // a `<figure>`). matters normalizes the picture down to just the `<img>` on
  // storage, but the wrap is what saves the image from being stripped.
  result = result.replace(
    /<picture\b[^>]*>[\s\S]*?<\/picture>/gi,
    (full, offset: number) => {
      if (isInside(result, offset, "figure")) return full;
      return `<figure class="image">${full}<figcaption></figcaption></figure>`;
    },
  );

  // Step D: `<p>` containing only an `<img>` → same hoist as Step B.
  result = result.replace(
    new RegExp(`${PARAGRAPH_OPEN}\\s*(<img\\b[^>]*>)\\s*</p>`, "gi"),
    (_full, img: string) => `<figure class="image">${img}<figcaption></figcaption></figure>`,
  );

  // Step E: Remaining bare `<img>` tags (not already inside a `<figure>` or
  // `<picture>`). After Step D this is rare — usually an inline image mixed
  // with text. We wrap regardless; matters would strip it otherwise.
  result = result.replace(/<img\b[^>]*>/gi, (imgTag, offset: number) => {
    if (isInside(result, offset, "figure")) return imgTag;
    if (isInside(result, offset, "picture")) return imgTag;
    return `<figure class="image">${imgTag}<figcaption></figcaption></figure>`;
  });

  return result;
}

/** What `transformMathForMatters` did, for the syndication summary. */
export interface MathTransformStats {
  html: string;
  /** Inline spans unwrapped to their LaTeX source text. */
  inline: number;
  /** Display equations hoisted into `<pre><code>`. */
  display: number;
  /** Display equations that could NOT be hoisted (mixed with prose in a `<p>`). */
  displayInline: number;
  /** `%` comments dropped so a newline collapse cannot let one eat the formula. */
  commentsStripped: number;
  /**
   * P2 typeset `<svg class="moss-math">` equations degraded to their LaTeX
   * source (Pass 0). matters cannot render SVG, so the source — carried in the
   * SVG's `<title>` / `aria-label` (ADR-030's a11y carrier) — is what the
   * reader sees instead of a blank. These then flow through the inline/display
   * source passes like P1's own emission.
   */
  mathSvg: number;
  /**
   * `<svg>` elements STILL PRESENT in the output — always a contract violation.
   *
   * matters' sanitizer allows no `<svg>`: the element is unwrapped to its
   * children, `<path>` has no text, so the equation VANISHES while syndication
   * reports success. Pass 0 converts every `<svg class="moss-math">` to its
   * LaTeX source, so a math equation never counts here; any survivor is an
   * `<svg>` we could NOT recover a source for (a non-math SVG, or a math SVG
   * with no `<title>`/`aria-label`). This counter is the tripwire that makes
   * such an arrival loud instead of a silent deletion.
   */
  svgDetected: number;
}

/**
 * Reshape moss's P1 math emission into the only shapes matters' sanitizer keeps.
 *
 * moss P1 renders math as its own LaTeX SOURCE WITH DELIMITERS, wrapped in
 * `<code class="moss-math" data-moss-math="inline|display">` with the TeX
 * HTML-escaped. Real `moss build` output:
 *
 *   <code class="moss-math" data-moss-math="inline">$E = mc^2$</code>
 *   <p><code class="moss-math" data-moss-math="display">$$ o_t = x $$</code></p>
 *   <code class="moss-math" data-moss-math="inline">$a &lt; b \&amp; c &gt; d$</code>
 *
 * Matters' write paths run `normalizeArticleHTML(sanitizeHTML(content))`
 * (matters-server putDraft/publishArticle/editArticle). Behaviour below was
 * established by running the REAL `@matters/matters-editor` transformers bundle over each
 * candidate shape:
 *
 *   - `class` is emptied (only /^language-./ on `code` survives) and `data-*`
 *     is stripped, so `moss-math` / `data-moss-math` NEVER reach matters.
 *   - The TipTap round-trip has CodeBlock but NO inline Code mark, so a bare
 *     `<code>` element is DELETED, promoting its text into the parent. Today
 *     `<code class="moss-math">$E=mc^2$</code>` already arrives as plain
 *     `$E=mc^2$` — which the transform keeps deliberately.
 *   - Newlines OUTSIDE `<pre>` are COLLAPSED to single spaces. Verified:
 *     `<p>$$\na % note\nb\n$$</p>` → `<p>$$ a % note b $$</p>`. The newline
 *     that terminated the LaTeX comment is gone, so `b` is now commented out —
 *     a silently WRONG but valid-looking formula.
 *   - `<pre><code>…</code></pre>` survives VERBATIM, newlines and leading
 *     indentation intact. It is the ONLY whitespace-preserving container in
 *     matters' pipeline.
 *   - A `<pre>` left inside a `<p>` is split out, leaving stray `<p></p>`
 *     siblings — same hazard `wrapAudioForMatters` Pass 1 hoists around.
 *   - `<svg>` is in NEITHER matters' tagNames additions NOR hast-util-sanitize's
 *     defaults. Non-allowed elements are UNWRAPPED TO THEIR CHILDREN, and
 *     `<path>` has no text. Verified: `<p>x <svg …><path …/></svg> y</p>` →
 *     `<p>x y</p>` — the equation VANISHES and syndication reports success.
 *     So P2's typeset `<svg class="moss-math">` cannot be shipped as-is. matters
 *     has no SVG projection (PNG-upload is a FUTURE step); the correct P2
 *     fallback is the LaTeX SOURCE, which the SVG carries in its `<title>` /
 *     `aria-label` (ADR-030's a11y carrier). Pass 0 recovers that source and
 *     reshapes the equation into the very same `<code class="moss-math">` shape
 *     P1 emits, so a matters reader sees `$tex$` / `$$tex$$`, never a blank.
 *
 * Passes, in order:
 *   0. `<svg class="moss-math">` (P2 typeset math) → its LaTeX source, taken
 *      from the SVG `<title>` (preferred; element-escaped like `<code>` text)
 *      or `aria-label`, re-wrapped as `<code class="moss-math" data-moss-math>`
 *      so passes 1–3 handle it identically to P1's own emission. This is the
 *      only new P2 pass; everything below is shape-agnostic afterwards.
 *   1. Display alone in its paragraph → `<pre><code>`, hoisted out of the `<p>`.
 *      This keeps multi-line align/cases line structure. `%` comments are
 *      dropped here too — see the pass-1 comment for why the `<pre>` is not a
 *      guarantee we own.
 *   2. Display NOT alone (mixed with prose) → unwrap to text, then pass 4.
 *   3. Inline → unwrap to text, then pass 4.
 *   4. For pass-2/3 output, where newline collapse is unavoidable: collapse
 *      newlines to single spaces (after the same `%` strip).
 *
 * The `svgDetected` tripwire is measured on the OUTPUT, after Pass 0: a math
 * SVG never reaches it (converted to source), so a survivor is a genuine
 * silent-deletion hazard (non-math SVG, or a math SVG missing its source
 * carrier) rather than a false alarm on P2's expected emission.
 *
 * Every paragraph pattern uses `PARAGRAPH_OPEN`, never a literal `<p>`: the
 * input is `article-map.json`'s `html_content`, where every top-level paragraph
 * carries `data-source-line`. See that constant's docblock.
 *
 * Exported for unit testing.
 */
export function transformMathForMatters(html: string): MathTransformStats {
  const mathOpen = '<code\\b[^>]*\\bclass="[^"]*\\bmoss-math\\b[^"]*"[^>]*\\bdata-moss-math="';
  let inline = 0;
  let display = 0;
  let displayInline = 0;
  let commentsStripped = 0;
  let mathSvg = 0;

  /**
   * Drop `%` comments — a `%` NOT preceded by a backslash runs to end of line.
   * Lossless for the formula; leaving one in lets it eat real math the moment
   * anything downstream collapses the newline that terminates it.
   */
  const stripTexComments = (tex: string): string =>
    tex.replace(/(^|[^\\])%[^\n]*/g, (_full, prefix: string) => {
      commentsStripped++;
      return prefix;
    });

  /**
   * Make a fragment safe for a newline-collapsing container: drop `%` comments
   * and flatten the remaining newlines to single spaces.
   */
  const flattenForProse = (tex: string): string =>
    stripTexComments(tex)
      .replace(/\s*\n\s*/g, " ")
      .trim();

  /** Guarantee the source carries its `$`/`$$` delimiters (P1 emits them; a P2
   * `aria-label` might not). Idempotent when they are already present. */
  const ensureDelimiters = (src: string, isDisplay: boolean): string => {
    const trimmed = src.trim();
    if (isDisplay) return trimmed.startsWith("$$") ? src : `$$${src}$$`;
    return trimmed.startsWith("$") ? src : `$${src}$`;
  };

  let result = html;

  // Pass 0: P2 typeset math. moss P2 renders `$tex$` as an inline
  // `<svg class="moss-math" … aria-label="<tex>"><title><tex></title>…</svg>`
  // (ADR-030). matters' sanitizer has no SVG projection — it unwraps the
  // element to its childless `<path>`s and the equation VANISHES with
  // syndication still reporting success. matters cannot render SVG and
  // PNG-upload is a future step, so the correct fallback is the LaTeX SOURCE
  // the SVG already carries. Recover it (prefer the `<title>`, which is
  // element-escaped exactly like `<code>` text; else `aria-label`) and reshape
  // the equation into the SAME `<code class="moss-math">` shape P1 emits, so
  // passes 1–3 below degrade it to `$tex$` / `$$tex$$` identically. A math SVG
  // that survives Pass 0 (no recoverable source) is left in place so the
  // output `svgDetected` tripwire counts it instead of it silently vanishing.
  const svgMathElement = /<svg\b([^>]*\bclass="[^"]*\bmoss-math\b[^"]*"[^>]*)>([\s\S]*?)<\/svg>/gi;
  result = result.replace(svgMathElement, (full, attrs: string, inner: string) => {
    const fromTitle = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const fromAria = attrs.match(/\baria-label="([^"]*)"/i)?.[1];
    const src = fromTitle ?? fromAria;
    if (src == null || src.trim() === "") return full;
    let kind = (attrs.match(/\bdata-moss-math="(inline|display)"/i)?.[1] ?? "").toLowerCase();
    if (kind !== "inline" && kind !== "display") {
      kind = src.trim().startsWith("$$") ? "display" : "inline";
    }
    mathSvg++;
    return `<code class="moss-math" data-moss-math="${kind}">${ensureDelimiters(src, kind === "display")}</code>`;
  });

  // Pass 1: display math alone in its paragraph → hoist to <pre><code>.
  // Content is already HTML-escaped by moss, which is exactly what <pre><code>
  // wants, so the newlines are copied through and the line structure survives.
  //
  // The `%` comments are dropped even here, where <pre> would preserve the
  // newline that ends them. Hoisting is not a guarantee we control: matters'
  // TipTap schema decides which parents may hold a codeBlock, and where it
  // refuses one (a blockquote is the case moss actually emits — it emits a BARE
  // `<p>` inside `<blockquote data-source-line=…>`, so this pass fires) the
  // <pre> is normalized back down to a <p> and the newline collapse happens
  // after we are done. A comment that survives that collapse eats the rest of
  // the equation and publishes a valid-looking but WRONG formula. Dropping the
  // comment is lossless for the formula, so pay it unconditionally rather than
  // stake correctness on a downstream schema we cannot test against.
  result = result.replace(
    new RegExp(
      `${PARAGRAPH_OPEN}\\s*(?:${mathOpen}display"[^>]*>)([\\s\\S]*?)</code>\\s*</p>`,
      "gi",
    ),
    (_full, tex: string) => {
      display++;
      return `<pre><code>${stripTexComments(tex)}</code></pre>`;
    },
  );

  // Pass 2: display math NOT alone in its paragraph (mixed with prose). It
  // cannot be hoisted without tearing the sentence apart, so it degrades to
  // text and takes the newline-collapse treatment.
  result = result.replace(
    new RegExp(`${mathOpen}display"[^>]*>([\\s\\S]*?)</code>`, "gi"),
    (_full, tex: string) => {
      displayInline++;
      return flattenForProse(tex);
    },
  );

  // Pass 3: inline math → its LaTeX source text. matters deletes the <code>
  // element anyway; doing it here makes the outcome ours and testable.
  result = result.replace(
    new RegExp(`${mathOpen}inline"[^>]*>([\\s\\S]*?)</code>`, "gi"),
    (_full, tex: string) => {
      inline++;
      return flattenForProse(tex);
    },
  );

  // Tripwire, measured on the OUTPUT so Pass 0's conversions never trip it: a
  // surviving `<svg>` is one we could not degrade to source and matters WILL
  // delete it silently. Loud here so the loss is never invisible.
  const svgDetected = (result.match(/<svg\b/gi) ?? []).length;
  if (svgDetected > 0) {
    console.error(
      `    ❌ ${svgDetected} <svg> element(s) survived into the syndication body. ` +
        `matters' sanitizer DELETES <svg> (unwrapped to children; <path> has no ` +
        `text), so this content will vanish from the published article with no ` +
        `error. A typeset math <svg class="moss-math"> is degraded to its LaTeX ` +
        `source automatically; a survivor means the source carrier ` +
        `(<title>/aria-label) was missing or the <svg> is not moss math.`,
    );
  }

  return { html: result, inline, display, displayInline, commentsStripped, mathSvg, svgDetected };
}

/**
 * Convert moss's audio embed into matters' required `<figure class="audio">`
 * shape and absolutize the `<source>` URL against the article URL.
 *
 * moss emits a bare:
 *   <audio class="moss-embed moss-embed-audio" controls preload="metadata">
 *     <source src="REL" type="MIME">Your browser does not support…</audio>
 *
 * matters' server-side sanitizer STRIPS that entirely (the `<audio>` vanishes
 * and the fallback text leaks out as a stray `<p>`). The only audio shape it
 * keeps — verified against `server.matters.icu` — is:
 *   <figure class="audio"><audio controls><source src="URL" type="MIME"></audio>
 *     <figcaption></figcaption></figure>
 * with three hard requirements found empirically:
 *   1. the URL MUST be on a `<source>` child — a `src` on `<audio>` is dropped;
 *   2. a `<figcaption>` child is REQUIRED (its absence is a server error,
 *      "Cannot read properties of undefined (reading 'firstChild')"); empty OK;
 *   3. matters keeps an EXTERNAL `<source src>` verbatim and its player streams
 *      from it, so the absolutized deployed URL is a valid src on its own. This
 *      is the FALLBACK: `uploadAndReplaceLocalAudio` (post-draft) then uploads
 *      the audio bytes via `embedaudio` and swaps in the durable matters CDN URL
 *      on success. (matters' `embedaudio` rejects url-upload, hence byte-upload.)
 *
 * moss does not yet emit audio captions, so the `<figcaption>` is always empty.
 *
 * Exported for unit testing.
 */
export function wrapAudioForMatters(html: string, baseUrl: string): string {
  // moss audio is identified by the `moss-embed-audio` class. Capture the inner
  // markup (the `<source>` + fallback text) so we can extract the source.
  const audioPattern =
    '<audio\\b[^>]*\\bclass="[^"]*\\bmoss-embed-audio\\b[^"]*"[^>]*>([\\s\\S]*?)</audio>';

  const buildFigure = (inner: string): string => {
    const srcMatch = inner.match(/<source\b[^>]*\bsrc="([^"]*)"[^>]*>/i);
    const src = srcMatch ? srcMatch[1] : "";
    const typeMatch = inner.match(/<source\b[^>]*\btype="([^"]*)"[^>]*>/i);
    const type = typeMatch ? typeMatch[1] : undefined;

    const absSrc = absolutizeUrl(src, baseUrl);
    const sourceTag = type
      ? `<source src="${absSrc}" type="${type}">`
      : `<source src="${absSrc}">`;
    // Empty figcaption is mandatory (see requirement 2 above). The `<audio>`
    // fallback text node is intentionally dropped.
    return `<figure class="audio"><audio controls>${sourceTag}</audio><figcaption></figcaption></figure>`;
  };

  let result = html;
  // Pass 1: hoist `<p>…audio…</p>` out of the paragraph — a `<figure>` inside a
  // `<p>` is invalid HTML and matters splits the `<p>`, leaving stray empties.
  result = result.replace(
    new RegExp(`${PARAGRAPH_OPEN}\\s*(?:${audioPattern})\\s*</p>`, "gi"),
    (_full, inner: string) => buildFigure(inner),
  );
  // Pass 2: any remaining standalone moss audio.
  result = result.replace(
    new RegExp(audioPattern, "gi"),
    (_full, inner: string) => buildFigure(inner),
  );
  return result;
}

/** Append a link back to the original, in Chinese when `lang` starts with "zh". */
export function addCanonicalLinkToContent(html: string, canonicalUrl: string, lang?: string): string {
  const linkText = lang?.startsWith("zh") ? "原文链接" : "Original link";
  return html + `<hr><p><a href="${canonicalUrl}">${linkText}</a></p>`;
}

/** Map an image file extension to the MIME type sent on upload. */
export function imageMimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/** Map an audio file extension to the MIME type sent on upload (mirrors moss-core). */
export function audioMimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/mp4";
    case "opus":
      return "audio/opus";
    default:
      return "application/octet-stream";
  }
}

/**
 * Resolve an asset `src` (as it appears in the rendered article HTML — a
 * site-absolute `/image/x.jpg`, an article-relative `../assets/x.jpg`, or an
 * already-absolutized same-origin URL) to a path relative to the deployed site
 * root, suitable for `readSiteFile`.
 *
 * Returns `null` for `data:` URIs and for any URL whose origin differs from the
 * site (e.g. an external CDN or an already-uploaded matters URL) — those are
 * not local build artifacts and must be left untouched.
 *
 * Exported for unit testing.
 */
export function siteRelativePathFromSrc(src: string, baseUrl: string): string | null {
  if (/^data:/i.test(src)) return null;
  let resolved: URL;
  let base: URL;
  try {
    resolved = new URL(src, baseUrl);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (resolved.origin !== base.origin) return null;
  // pathname is percent-encoded; decode for the filesystem read.
  const path = decodeURIComponent(resolved.pathname.replace(/^\//, ""));
  return path || null;
}

/**
 * Upload local images to Matters and replace their `<img src>` with the
 * returned matters CDN URL.
 *
 * Bytes are read from the LOCAL build output (`readSiteFile`) and uploaded
 * directly via multipart — matters' server cannot reliably fetch images by URL
 * from a deployed site (Caddy/moss-seta hosts return `UNABLE_TO_UPLOAD_FROM_URL`).
 *
 * - Skips external (other-origin) and `data:` srcs.
 * - Deduplicates: same src is uploaded once.
 * - Graceful fallback: on read/upload failure the src is rewritten to the
 *   absolutized deployed URL (matters keeps an external `<img src>` and the
 *   reader's browser loads it from the live site), so the image still displays
 *   instead of breaking.
 *
 * @param content - HTML content containing img tags
 * @param baseUrl - The article's canonical URL (e.g. "https://example.com/posts/foo/"),
 *   used both to resolve relative srcs and as the origin for site-local detection.
 * @param entityId - Draft ID the embeds attach to (matters requires it).
 * @returns HTML with local image srcs replaced by matters CDN (or absolutized) URLs
 */
export async function uploadAndReplaceLocalImages(
  content: string,
  baseUrl: string,
  entityId: string,
): Promise<string> {
  // Linear tag scan + per-tag src read — avoids the polynomial backtracking of
  // two [^>]* around src= (CodeQL js/polynomial-redos). `\ssrc="` matches the
  // real src attribute (whitespace-anchored), not a data-src tail.
  const imgTagRegex = /<img\b[^>]*>/gi;
  const srcs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = imgTagRegex.exec(content)) !== null) {
    const srcMatch = /\ssrc="([^"]+)"/i.exec(match[0]);
    if (srcMatch && !/^data:/i.test(srcMatch[1])) srcs.add(srcMatch[1]);
  }
  if (srcs.size === 0) return content;

  const replacements = new Map<string, string>();
  for (const src of srcs) {
    const sitePath = siteRelativePathFromSrc(src, baseUrl);
    let fallbackUrl: string | undefined;
    try {
      fallbackUrl = new URL(src, baseUrl).href;
    } catch {
      fallbackUrl = undefined;
    }

    if (!sitePath) {
      // External / cross-origin asset: at most absolutize so it isn't a broken
      // relative path; never try to upload it.
      if (fallbackUrl && fallbackUrl !== src) replacements.set(src, fallbackUrl);
      continue;
    }

    try {
      const base64 = await readSiteFile(sitePath);
      const filename = sitePath.split("/").pop() || "image";
      const asset = await uploadAssetMultipart(base64, filename, imageMimeForPath(sitePath), "embed", entityId);
      replacements.set(src, asset.path);
      console.log(`    🖼️ Image uploaded (bytes): ${src} → ${asset.path}`);
    } catch (error) {
      const fb = fallbackUrl ?? src;
      replacements.set(src, fb);
      console.warn(`    ⚠️ Image byte-upload failed for ${src}, using site URL ${fb}: ${error}`);
    }
  }

  return applySrcReplacements(content, replacements);
}

/**
 * Upload local audio to Matters and replace the `<source src>` inside
 * `<figure class="audio">` with the returned matters CDN URL.
 *
 * Mirrors {@link uploadAndReplaceLocalImages} but for `type:"embedaudio"`. At
 * this point the `<source src>` is already the absolutized deployed URL (set by
 * `wrapAudioForMatters`), which is the fallback: on success it becomes the
 * durable matters CDN URL; on failure it stays as the streamed site URL.
 *
 * Scoped to `<source src>` INSIDE `<figure class="audio">` so a hand-authored
 * raw-HTML `<video><source src>` block elsewhere is never mistaken for audio.
 * (`<picture>` variants use `srcset`, not `src`, so they wouldn't match anyway.)
 *
 * @returns HTML with local audio srcs replaced by matters CDN URLs where possible
 */
export async function uploadAndReplaceLocalAudio(
  content: string,
  baseUrl: string,
  entityId: string,
): Promise<string> {
  const figureAudioRegex = /<figure\b[^>]*\bclass="audio"[^>]*>([\s\S]*?)<\/figure>/gi;
  // Linear tag scan + per-tag src read — avoids the polynomial backtracking of
  // two [^>]* around src= (CodeQL js/polynomial-redos).
  const sourceTagRegex = /<source\b[^>]*>/gi;
  const srcs = new Set<string>();
  let figure: RegExpExecArray | null;
  while ((figure = figureAudioRegex.exec(content)) !== null) {
    let tag: RegExpExecArray | null;
    while ((tag = sourceTagRegex.exec(figure[1])) !== null) {
      const srcMatch = /\ssrc="([^"]+)"/i.exec(tag[0]);
      if (srcMatch && !/^data:/i.test(srcMatch[1])) srcs.add(srcMatch[1]);
    }
  }
  if (srcs.size === 0) return content;

  const replacements = new Map<string, string>();
  for (const src of srcs) {
    const sitePath = siteRelativePathFromSrc(src, baseUrl);
    if (!sitePath) continue; // external/cross-origin — leave the streamed URL
    try {
      const base64 = await readSiteFile(sitePath);
      const filename = sitePath.split("/").pop() || "audio";
      const asset = await uploadAssetMultipart(base64, filename, audioMimeForPath(sitePath), "embedaudio", entityId);
      replacements.set(src, asset.path);
      console.log(`    🔊 Audio uploaded (bytes): ${src} → ${asset.path}`);
    } catch (error) {
      // Leave the absolutized deployed URL in place — matters streams from it.
      console.warn(`    ⚠️ Audio byte-upload failed for ${src}, keeping site URL: ${error}`);
    }
  }

  return applySrcReplacements(content, replacements);
}

/** Replace every `src="<original>"` occurrence with the mapped URL. */
function applySrcReplacements(content: string, replacements: Map<string, string>): string {
  let result = content;
  for (const [originalSrc, newUrl] of replacements) {
    const escaped = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`src="${escaped}"`, "g"), `src="${newUrl}"`);
  }
  return result;
}

