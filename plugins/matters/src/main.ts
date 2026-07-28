/**
 * Matters.town Syndicator Plugin
 *
 * Syndicates articles to Matters.town after deployment.
 * Requires authentication via webview (domain: matters.town)
 */

import type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  ArticleInfo,
} from "./types";
import {
  reportError,
  setCurrentHookName,
  sleep,
  formatArticleSyncSummary,
} from "./utils";
import { startTask } from "@symbiosis-lab/moss-api";
import type { TaskHandle } from "@symbiosis-lab/moss-api";
import {
  fetchAllArticlesSince,
  fetchAllDraftsSince,
  fetchAllCollections,
  fetchUserProfile,
  fetchArticleComments,
  fetchAllArticleCommentCounts,
  createDraft,
  fetchDraft,
  uploadAssetMultipart,
  apiConfig,
  MattersAuthError,
} from "./api";
import {
  clearTokenCache,
  getSessionState,
  shouldNudgeSessionExpired,
  captureLogin,
  beginFreshLogin,
  prepareWebviewAuth,
} from "./credential";
import { resolveAuthRoute, isUserPresent } from "./auth-route";
import { syncToLocalFiles, scanLocalArticles, detectBoundUser, nextKnownCollectionIds } from "./sync";
import { downloadMediaAndUpdate, rewriteAllInternalLinks } from "./downloader";
import { getConfig, saveConfig } from "./config";
import { overallProgress, type ProgressReporter } from "./progress";
import { loadSocialData, saveSocialData, mergeSocialData, reconcileLegacySocialData } from "./social";
import {
  readFile,
  writeFile,
  readSiteFile,
  showToast,
  dismissToast,
  readPluginFile,
  writePluginFile,
  pluginFileExists,
  getPluginEnvVar,
  emitEvent,
  onEvent,
} from "@symbiosis-lab/moss-api";
import { parseFrontmatter, regenerateFrontmatter } from "./converter";
import {
  initializeDomain,
  getDomain,
  loginUrl,
  draftUrl,
  articleUrl,
  isMattersUrl,
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
// Draft Tracking
// ============================================================================

/**
 * Draft entry stored in drafts.json
 */
export interface DraftEntry {
  draftId: string;
  createdAt: string;
}

/**
 * Map of source_path -> draft entry
 */
export type DraftMap = Record<string, DraftEntry>;

const DRAFTS_FILE = "drafts.json";

/**
 * Read the draft tracking map from plugin storage.
 * Returns empty object if file not found or invalid.
 */
export async function getDraftMap(): Promise<DraftMap> {
  try {
    const exists = await pluginFileExists(DRAFTS_FILE);
    if (!exists) return {};
    const content = await readPluginFile(DRAFTS_FILE);
    return JSON.parse(content) as DraftMap;
  } catch {
    return {};
  }
}

/**
 * Write the draft tracking map to plugin storage.
 */
export async function saveDraftMap(map: DraftMap): Promise<void> {
  const content = JSON.stringify(map, null, 2);
  await writePluginFile(DRAFTS_FILE, content);
}

/**
 * Look up a tracked draft ID for a source path.
 * Returns undefined if no draft is tracked.
 */
export async function getDraftId(sourcePath: string): Promise<string | undefined> {
  const map = await getDraftMap();
  return map[sourcePath]?.draftId;
}

/**
 * Persist a draft ID for a source path.
 */
export async function saveDraftId(sourcePath: string, draftId: string): Promise<void> {
  const map = await getDraftMap();
  map[sourcePath] = {
    draftId,
    createdAt: new Date().toISOString(),
  };
  await saveDraftMap(map);
}

/**
 * Remove a tracked draft for a source path (e.g., after publish).
 */
export async function removeDraftId(sourcePath: string): Promise<void> {
  const map = await getDraftMap();
  delete map[sourcePath];
  await saveDraftMap(map);
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
 * Session-expired nudge. Throttled once per expiry event via a nudgedAt
 * stamp in auth.json (engine-independent: module state may reset per build
 * under the off-webview runtime). Every suppressed occurrence still logs.
 */
async function notifySessionExpired(): Promise<void> {
  console.warn("⚠️ Matters session expired; drafts and syndication paused until re-login");
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
// Test-harness escape hatch (T8a, 2026-05-28)
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
 * Design: docs/plans/2026-06-23-matters-login-lifecycle-and-minimal-browser-design.md §B1
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
    hook: "import",
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
  clearTokenCache();
  await initializeDomain();

  // T8a escape hatch: if MOSS_MATTERS_TEST_PROFILE is set, flip apiConfig
  // to public-fetch mode BEFORE any auth/binding logic runs. The promptLogin
  // helper also checks the env var and skips its UI — together these two
  // flips give the e2e harness a no-auth-webview import path. Idempotent;
  // no-op in production.
  const testProfile = await applyTestProfileEscapeHatch();

  // Start a PanelTask so the breadcrumb hairline animates during import.
  // hook = "import" — the process hook syncs articles from Matters (an import
  //   operation), not a transform/enhance.
  // trigger — moss owns this context (ADR-015): it stamps `context.trigger` when
  //   it invokes the hook. The onboarding card path → "onboarding_flow", which the
  //   router maps to (ActionPanel, Ambient) → the hairline; every build/preview
  //   rebuild → "background" (quiet). The plugin must NOT guess this from its own
  //   state (e.g. the test-profile env var) — that conflated "test mode" with
  //   "user-initiated onboarding" and left the hairline dead in production.
  //   Absent (older moss) ⇒ "background", the safe quiet default.
  const task = await startTask("Importing from Matters", {
    hook: "import",
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
        if (sessionState === "expired") await notifySessionExpired();
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
        // rebuild would be noise. Report as success ("not connected") so there
        // is no badge. The auto-open trigger (Phase 4b) and the settings
        // "Connect to Matters" affordance (Phase 4b) carry the actual prompt.
        //
        // 'expired' still nudges (a toast, not a badge) so the user sees the
        // notification, but the overall task is succeeded — not failed.
        const message =
          sessionState === "expired"
            ? "session expired, log in again to import."
            : "not connected — log in to import.";
        if (sessionState === "expired") await notifySessionExpired();
        // Phase 4a B2: background "needs connection" → silent success (no
        // error badge on every rebuild). NOT task.failed().
        await task.succeeded("not connected");
        return { success: true, message };
      }
    }

    // Check if sync is enabled
    const syncOnBuild = context.config?.sync_on_build ?? true;
    if (!syncOnBuild) {
      console.log("ℹ️  Sync on build is disabled, skipping...");
      // Terminate the task before returning (else it leaks as Running).
      // Sync intentionally off ⇒ a clean success, but only claim
      // "Authenticated" when the route actually proceeded with a usable
      // session; fallback/expired routes get the plain message.
      await task.succeeded("Sync disabled");
      return {
        success: true,
        message: route === "proceed" ? "Authenticated (sync disabled)" : "Sync disabled",
      };
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

          // Save after each article to avoid losing data if later fetches hang
          await saveSocialData(socialData);
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
      await notifySessionExpired();
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

/**
 * syndicate hook - Syndicate articles to Matters.town
 *
 * This capability publishes content to external platforms after deployment.
 * Articles are syndicated one at a time (sequentially) to allow user review.
 */
export async function syndicate(context: SyndicateContext): Promise<HookResult> {
  setCurrentHookName("syndicate");
  clearTokenCache();
  await initializeDomain();

  console.log("📡 Matters: Starting syndication...");

  // Drive a moss Job for the syndication run (Step 3 Phase 5 Task 5.3).
  // The verb/noun MEANING is declared in the manifest's `contributes.jobs`
  // ("Syndicated" · "posts"); moss normalizes the verb (R13) and renders the
  // receipt "Syndicated · N posts". A partial failure is PROPOSED as an
  // advisory via `task.advise(...)`; moss holds the severity gavel.
  // Syndication runs after deploy (no onboarding gesture), so the trigger is
  // "background" — the quiet Workspace+Ambient surface. moss does not stamp a
  // `trigger` on SyndicateContext (unlike ProcessContext), so we choose the
  // safe quiet default directly rather than reading a field that isn't there.
  const task = await startTask("Syndicate", {
    hook: "syndicate",
    trigger: "background",
    hasProgress: true,
    cancellable: false,
    // Reference the manifest's `contributes.jobs.syndicate` descriptor
    // ("Syndicated" · "posts"). moss normalizes the verb (R13) and, on the
    // terminal `succeeded(_, count)`, renders "Syndicated · N posts" from its
    // OWN verb + amount — we no longer hand it a pre-formatted string.
    job: "syndicate",
  });

  try {
    if (!context.deployment) {
      await task.failed("No deployment information available");
      return {
        success: false,
        message: "No deployment information available",
      };
    }

    const { url: siteUrl, deployed_at } = context.deployment;
    const { articles } = context;

    // Filter to only articles that don't already have a Matters syndication URL
    const articlesToSyndicate = articles.filter((article) => {
      const syndicated = (article.frontmatter.syndicated as string[] | undefined) || [];
      return !syndicated.some((url: string) => isMattersUrl(url));
    });

    if (articlesToSyndicate.length === 0) {
      console.log("ℹ️  No new articles to syndicate (all already syndicated to Matters)");
      await task.succeeded("No new articles to syndicate");
      return {
        success: true,
        message: "No new articles to syndicate",
      };
    }

    console.log(`📡 Syndicating ${articlesToSyndicate.length} article(s) to Matters.town`);
    console.log(`🌐 Deployed site: ${siteUrl}`);
    console.log(`📅 Deployed at: ${deployed_at}`);

    // Check the session. Syndication is user-initiated by construction
    // (every trigger site is inside the user-clicked publish flow) and
    // write-scoped: no public fallback exists, so any non-valid session
    // goes straight to login.
    const sessionState = await getSessionState();
    if (sessionState !== "valid") {
      console.log(`🔐 Session state: ${sessionState}, prompting login...`);
      // Law 2: login-required is a blocking auth state — must persist.
      // Law 4: dismiss the toast if login succeeds so a resolved warning
      //         doesn't linger alongside the terminal ack.
      await showToast({ message: "Matters login required", variant: "warning", persistent: true, id: "matters-login-required" });
      // Suspend the Rust 60s inactivity watchdog. Follow with a quiet progress
      // label (spec: no Awaiting amber pulse for in-panel login).
      await task.awaiting("Connect to Matters", "", "cancel");
      await task.progress(undefined, "Connect to Matters");
      const loginSuccess = await promptLogin();
      if (loginSuccess) {
        await dismissToast("matters-login-required");
      }
      if (!loginSuccess) {
        // Propose an actionable account advisory: the user must sign in to
        // finish. moss holds the gavel — a NeedsAction stays a quiet dot, an
        // actionable Blocking pops the panel; here we let moss decide.
        await task.advise({
          scope: "Account",
          severity: "NeedsAction",
          item: null,
          what: "Sign in to Matters to syndicate your posts",
          action: { InApp: { op: "SignIn", args: null, label: "Sign in" } },
        });
        await task.failed("Login required for syndication");
        return {
          success: false,
          message: "Login required for syndication",
        };
      }
    }

    // Get userName from config or profile
    const pluginConfig = await getConfig();
    let userName = pluginConfig.userName;
    if (!userName) {
      const profile = await fetchUserProfile();
      userName = profile.userName;
    }

    const config = context.config || {};
    const addCanonicalLink = config.add_canonical_link ?? true;
    const lang = context.project_info.lang ?? "en";

    // Syndicate articles sequentially (one at a time for user review)
    let published = 0;
    let draftsCreated = 0;
    const errors: string[] = [];

    const totalToSyndicate = articlesToSyndicate.length;
    let processed = 0;
    for (const article of articlesToSyndicate) {
      await task.progress(processed / totalToSyndicate, `Syndicating ${article.title}`);
      try {
        // Verify article is actually live at its deployed URL before syndicating.
        // Prevents publishing broken links (e.g., new article not yet deployed,
        // or GitHub Pages build failed).
        const live = await isArticleLive(siteUrl, article.url_path);
        if (!live) {
          console.log(`    ⏭ Skipping ${article.title} — not yet live at ${siteUrl}/${article.url_path}`);
          processed++;
          continue;
        }

        const result = await syndicateArticle(article, siteUrl, userName, {
          addCanonicalLink: addCanonicalLink as boolean,
          lang,
        }, task);

        if (result.publishedUrl) {
          published++;
        } else {
          draftsCreated++;
        }
      } catch (error) {
        if (error instanceof MattersAuthError) throw error; // session is dead: abort the run
        console.error(`    ✗ Failed to syndicate ${article.title}:`, error);
        errors.push(`${article.title}: ${error}`);
      }
      processed++;
    }

    const parts: string[] = [];
    if (published > 0) parts.push(`${published} published`);
    if (draftsCreated > 0) parts.push(`${draftsCreated} drafts created`);
    if (errors.length > 0) parts.push(`${errors.length} failed`);

    const summary = parts.join(", ");

    // A partial failure is PROPOSED as a per-run advisory (R13); moss clamps
    // it. ShippedDegraded ⇒ a quiet hairline dot (the run still succeeded).
    if (errors.length > 0) {
      await task.advise({
        scope: "Remote",
        severity: "ShippedDegraded",
        item: null,
        what: `${errors.length} post(s) could not be syndicated: ${errors[0]}`,
        action: "None",
      });
    }

    // Terminal: report the COUNT, not a pre-formatted string. moss owns the
    // receipt — it pairs the manifest's normalized verb ("Syndicated") with
    // this count + the declared noun ("posts") to render "Syndicated · N posts"
    // from its OWN value objects (Step 3 Phase 5, §8 + R13).
    // #808: a created-but-unpublished draft is NOT a syndication. Only an
    // API-confirmed publish (draft.article non-null) counts toward the success
    // receipt/toast. A draft saved for later is surfaced as a NeedsAction advisory.
    const syndicatedCount = published;

    if (errors.length > 0) {
      console.warn(`⚠️  Syndication complete: ${summary}`);
    } else {
      console.log(`✅ Syndication complete: ${summary}`);
    }
    await task.succeeded(undefined, syndicatedCount);

    // One terminal L3 shelf ack — the durable positive result (Law 3).
    // task.succeeded() already rendered "Syndicated · N posts" in L1;
    // this showToast({ variant: 'success' }) is the shelf record with the
    // "View profile" action link.
    // NOTE: showAck() is a frontend-only function (toast-manager.ts) and is
    // NOT exported from @symbiosis-lab/moss-api. Use showToast({ variant: 'success' }).
    if (syndicatedCount > 0) {
      const profileUrl = `https://${getDomain()}/@${userName}`;
      await showToast({
        message: `Syndicated ${syndicatedCount} article${syndicatedCount === 1 ? "" : "s"} to Matters`,
        variant: "success",
        persistent: true,
        actions: [{ label: "View profile", url: profileUrl }],
      });
    }

    return {
      success: true,
      message: `Syndication: ${summary}`,
    };
  } catch (error) {
    if (error instanceof MattersAuthError) {
      // Same contract as the process hook's catch: the server revoked the
      // token mid-run; fail the task with honest copy (recoverable=true —
      // a re-login fixes it) and nudge the session-expired surface.
      const message = "session expired, log in again to publish.";
      await notifySessionExpired();
      await task.failed(message, true);
      console.error("❌ Matters: syndication aborted, session rejected by server");
      return { success: false, message };
    }
    const cause = error instanceof Error ? error.message : String(error);
    console.error("❌ Matters: Syndication failed:", cause);
    await task.failed(`Syndication failed: ${cause}`);
    return {
      success: false,
      message: `Syndication failed: ${cause}`,
    };
  }
}

/**
 * Check if an article is live at its deployed URL.
 *
 * Sends a HEAD request to the derived URL. Returns true if the server
 * responds with a 2xx status, false otherwise (404, network error, etc.).
 *
 * Used before syndication to avoid publishing links to articles that
 * haven't been deployed yet (e.g., new articles during concurrent syndication).
 */
export async function isArticleLive(siteUrl: string, articleUrlPath: string): Promise<boolean> {
  const base = siteUrl.replace(/\/$/, "");
  const path = articleUrlPath.replace(/^\//, "");
  const fullUrl = `${base}/${path}`;
  try {
    const response = await fetch(fullUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Syndication Helpers
// ============================================================================

/**
 * Syndicate a single article to Matters.town
 *
 * Workflow:
 * 1. Upload cover image if present in frontmatter
 * 2. Create draft via API
 * 3. Open draft in browser for user to review
 * 4. Poll for publish state change
 * 5. On publish: close browser, update local frontmatter
 * 6. On timeout: close browser, leave draft for later
 *
 * Exported for unit testing.
 */
export async function syndicateArticle(
  article: ArticleInfo,
  siteUrl: string,
  userName: string,
  options: { addCanonicalLink: boolean; lang: string },
  task: TaskHandle,
): Promise<{ draftId: string; publishedUrl?: string }> {
  console.log(`  → Syndicating: ${article.title}`);

  const canonicalUrl = `${siteUrl.replace(/\/$/, "")}/${article.url_path.replace(/^\//, "")}`;

  // Step 1: Get content
  const { content: articleContent, isHtml } = getArticleContent(article);
  let content = articleContent;

  // Step 2: Normalize HTML (headings + image wrapping) — only for HTML content.
  // Strip moss's auto-injected article-title <h1> first (matters has its own
  // title field, so leaving the h1 in the body produces a visible duplicate
  // in the matters draft).
  if (isHtml) {
    content = stripArticleTitleH1(content, article.title);
    content = normalizeHtmlForMatters(content);
  }

  // Step 3: Add canonical link with lang
  if (options.addCanonicalLink) {
    content = addCanonicalLinkToContent(content, canonicalUrl, isHtml, options.lang);
  }

  // Step 4: Absolutize relative <a href> values against the article URL.
  // Without this, matters.town serves `<a href="../../foo.html">` from its own
  // domain and the link 404s. Same article-relative resolution rule as asset
  // srcs. Asset BYTE uploads happen post-draft (Step 8) — Matters'
  // singleFileUpload requires `entityId` for embeds, just as it does for cover.
  if (isHtml) {
    content = absolutizeRelativeHrefs(content, canonicalUrl);
    // Restructure moss audio embeds into matters' `<figure class="audio">` shape
    // and absolutize the `<source>` src to the deployed URL. That absolutized URL
    // is the FALLBACK — Step 8 then uploads the audio bytes and swaps in the
    // durable matters CDN URL on success. Without this wrap matters strips moss's
    // bare `<audio>` entirely. See wrapAudioForMatters.
    content = wrapAudioForMatters(content, canonicalUrl);
  }

  // Step 5: Check for existing tracked draft
  const existingDraftId = article.source_path ? await getDraftId(article.source_path) : undefined;
  if (existingDraftId) {
    console.log(`    📋 Found existing draft ID: ${existingDraftId}`);
  }

  // Step 6: Create/update draft via API (with optional summary from description)
  const summary = article.frontmatter.description as string | undefined;
  const draftInput = {
    title: article.title,
    content,
    tags: article.tags,
    ...(existingDraftId ? { id: existingDraftId } : {}),
    ...(summary ? { summary } : {}),
  };

  let draft;
  try {
    draft = await createDraft(draftInput);
  } catch (error) {
    if (existingDraftId) {
      // Stale draft ID — fall back to creating a new draft without id
      console.warn(`    ⚠️ Existing draft ${existingDraftId} failed, creating new draft: ${error}`);
      const { id: _removed, ...inputWithoutId } = draftInput;
      draft = await createDraft(inputWithoutId);
    } else {
      throw error;
    }
  }

  console.log(`    📝 Draft ${existingDraftId ? "updated" : "created"} with ID: ${draft.id}`);

  // Step 7: Upload cover if present in frontmatter (requires draft ID as entityId).
  // Cover paths are conventionally site-relative (e.g. `/og-image.png` or
  // `assets/covers/foo.jpg`). We read the BYTES from the local build output and
  // upload them directly — matters' server cannot reliably fetch covers by URL
  // from a deployed site (see uploadAssetMultipart).
  const coverPath = article.frontmatter.cover as string | undefined;
  if (coverPath) {
    try {
      const coverSitePath = decodeURIComponent(coverPath.replace(/^\//, ""));
      const base64 = await readSiteFile(coverSitePath);
      const filename = coverSitePath.split("/").pop() || "cover";
      const coverAsset = await uploadAssetMultipart(
        base64,
        filename,
        imageMimeForPath(coverSitePath),
        "cover",
        draft.id,
      );
      console.log(`    🖼️ Cover uploaded (bytes): ${coverAsset.id}`);
      // Update draft with cover
      await createDraft({ id: draft.id, title: draft.title, cover: coverAsset.id });
      console.log(`    🖼️ Draft updated with cover`);
    } catch (error) {
      console.warn(`    ⚠️ Cover upload failed, continuing without cover: ${error}`);
    }
  }

  // Step 8: Upload embedded body images and re-put the draft with CDN URLs.
  // Same `entityId` requirement as cover, so this also has to wait until the
  // draft exists. The first putDraft above sent the relative-src content; if
  // any uploads succeed, this overwrites the body with the CDN-rewritten one.
  //
  // Wrapped in try/catch to match the cover flow's "continue on failure"
  // semantics. Without this, a single re-put error (e.g. matters API 5xx)
  // would skip the toast/openBrowser path and leave the user looking at a
  // generic syndication failure instead of the still-usable draft.
  if (isHtml) {
    try {
      let rewritten = await uploadAndReplaceLocalImages(content, canonicalUrl, draft.id);
      // Upload audio bytes too (embedaudio). The figure.audio src is currently
      // the absolutized deployed URL (from wrapAudioForMatters); on success this
      // swaps it for the durable matters CDN URL, on failure it stays as the
      // streamed site URL.
      rewritten = await uploadAndReplaceLocalAudio(rewritten, canonicalUrl, draft.id);
      if (rewritten !== content) {
        await createDraft({ id: draft.id, title: draft.title, content: rewritten });
        console.log(`    🖼️ Draft updated with uploaded asset URLs`);
      }
    } catch (error) {
      console.warn(`    ⚠️ Asset upload step failed, draft body keeps original srcs: ${error}`);
    }
  }

  // Step 9: Open draft in browser for user review; then signal L1 "waiting for you"
  // Law 3: waitForPublishOrClose is textbook Awaiting semantics.
  // task.awaiting() fires AFTER openBrowser() so the amber dot appears when
  // the editor is already visible (semantically accurate: "waiting for you IN
  // Matters editor" — the editor is open when the wait starts).
  // task.awaiting() also suspends the Rust 60s inactivity watchdog, so a slow
  // user is never killed by inactivity while the browser is open.
  const draftPageUrl = draftUrl(draft.id);
  console.log(`    🌐 Opening draft for review: ${draftPageUrl}`);
  // Project THIS folder's token into the matters cookie so the draft-room
  // webview authenticates as the bound account (the cookie is the webview's
  // only credential — see credential.prepareWebviewAuth), not whoever logged
  // in last in the process-shared WebKit store.
  await prepareWebviewAuth();
  const browserHandle = await openBrowser(draftPageUrl);
  await task.awaiting("publish the draft", "Matters editor", "cancel");

  // Step 10: Poll for publish state change — resolves only on publish or browser close.
  // No wall-clock ceiling: the 60s Rust inactivity watchdog is suspended by the
  // task.awaiting() signal above, so the hook waits as long as the user needs.
  const publishedArticle = await waitForPublishOrClose(draft.id, browserHandle);

  if (publishedArticle) {
    // Step 11: Article was published - update local frontmatter
    const publishedUrl = articleUrl(userName, publishedArticle.slug, publishedArticle.shortHash);
    console.log(`    ✅ Published: ${publishedUrl}`);

    // Update the local markdown file's frontmatter
    if (article.source_path) {
      await updateFrontmatterSyndicated(article.source_path, publishedUrl);
      console.log(`    📝 Updated frontmatter with syndicated URL`);
    }

    // Remove draft from tracking (published successfully)
    if (article.source_path) {
      try {
        await removeDraftId(article.source_path);
      } catch (err) {
        console.warn(`    ⚠️ Failed to remove draft tracking: ${err}`);
      }
    }

    return { draftId: draft.id, publishedUrl };
  }

  // Step 12: Closed/timeout without publishing — signal the ship conductor.
  // Emit 'matters-room-skipped' so the conductor in the main shell can advance
  // the ring segment for matters as 'skipped' (not 'failed'). The tauri_bridge
  // special-cases this event to broadcast to all windows (not just the browser
  // panel), matching how 'email-room-skipped' reaches the conductor. Best-effort:
  // failure to emit must not abort the cleanup below.
  try {
    await emitEvent("matters-room-skipped");
  } catch (err) {
    console.warn(`    ⚠️ Failed to emit matters-room-skipped: ${err}`);
  }

  // R9: Post-settle reconciliation — close/skip won the race but the article
  // may have been published in the same window (e.g. user published → closed
  // fast enough for close to win). Avoid leaving a misleading "Draft saved"
  // advisory when the article is actually live. Best-effort: a network failure
  // here must not abort the cleanup.
  let latePublish: { shortHash: string; slug: string } | null = null;
  try {
    const reconcileDraft = await fetchDraft(draft.id);
    if (reconcileDraft?.article) {
      latePublish = {
        shortHash: reconcileDraft.article.shortHash,
        slug: reconcileDraft.article.slug,
      };
      console.log(`    🔄 R9 reconciliation: article was published despite close/timeout`);
    }
  } catch (err) {
    console.warn(`    ⚠️ R9 reconciliation check failed: ${err}`);
  }

  if (latePublish) {
    // Article is actually live — update frontmatter and return as published.
    const publishedUrl = articleUrl(userName, latePublish.slug, latePublish.shortHash);
    if (article.source_path) {
      await updateFrontmatterSyndicated(article.source_path, publishedUrl).catch((err) => {
        console.warn(`    ⚠️ R9: Failed to update frontmatter: ${err}`);
      });
      await removeDraftId(article.source_path).catch(() => {});
    }
    await task.advise({
      scope: "Remote",
      severity: "ShippedDegraded",
      item: article.title,
      what: "Article published on Matters — frontmatter will sync",
      action: { Link: { href: publishedUrl, label: "View article" } },
    });
    return { draftId: draft.id, publishedUrl };
  }

  // Save draft ID for reuse next time
  if (article.source_path) {
    try {
      await saveDraftId(article.source_path, draft.id);
      console.log(`    💾 Draft ID saved for reuse`);
    } catch (err) {
      console.warn(`    ⚠️ Failed to save draft tracking: ${err}`);
    }
  }
  console.log(`    ⏱️ Publish timeout/close — draft saved for later`);
  // Draft timed out or user closed without publish; leave an actionable advisory
  // in the pill popover (Law 2: actionable state must not auto-fade in 5s).
  // advise() accumulates on the handle and flushes when task.succeeded() is
  // called after the loop — this is correct SDK behavior, not a leak.
  await task.advise({
    scope: "Remote",
    severity: "NeedsAction",
    item: article.title,
    what: "Draft saved — publish it on Matters when ready",
    action: { Link: { href: draftUrl(draft.id), label: "Open draft" } },
  });
  return { draftId: draft.id };
}

/**
 * Wait for draft to be published or the browser to be closed.
 *
 * Rewritten (R6) from a `while`-loop into a single `new Promise` executor
 * with a shared `settle()` guard so exactly ONE resolution wins. Three racing
 * branches all call `settle`:
 *
 *   (a) Poll loop — sleep(5s) then fetchDraft; if draft.article → settle published.
 *       Uses the `sleep` utility so tests can mock it to a no-op.
 *   (b) browserHandle.closed → settle(null) [user closed the editor].
 *   (c) onEvent('browser-url-changed') — if URL looks like a published article,
 *       immediately call fetchDraft; if draft.article → settle published.
 *       The URL is a TRIGGER; the API is the source of truth.
 *
 * There is NO wall-clock ceiling. The wait terminates only when:
 *   - the article is confirmed published (a or c), or
 *   - the user closes the browser (b).
 * Crash recovery is handled by the 60s Rust inactivity watchdog, which is
 * suspended while the hook signals Awaiting (via task.awaiting() in the
 * caller) — so a slow user is never killed by inactivity.
 *
 * Cleanup (url-listener) is guaranteed on EVERY resolution path.
 * The poll loop exits naturally once `settled` is true. A leaked
 * `onEvent` listener double-fires on the next article — unlisten is mandatory.
 *
 * Returns { shortHash, slug } on confirmed publish; null on browser close.
 *
 * NOTE: Matters is currently the last channel. When multi-channel ordering
 * changes, "done detection finishes the ship" must be revisited.
 *
 * @internal exported for unit tests only
 */
export async function waitForPublishOrClose(
  draftId: string,
  browserHandle?: BrowserHandle
): Promise<{ shortHash: string; slug: string } | null> {
  console.log(`    ⏳ Waiting for publish (no wall-clock ceiling — resolves on publish or browser close)...`);

  const pollIntervalMs = 5000; // 5 seconds

  return new Promise<{ shortHash: string; slug: string } | null>((resolve) => {
    let settled = false;
    let unlistenUrl: (() => void) | undefined;

    function settle(value: { shortHash: string; slug: string } | null): void {
      if (settled) return;
      settled = true;

      // Cleanup: clear the URL listener so it does not fire again on a
      // subsequent article. The poll loop exits via the `settled` guard.
      if (unlistenUrl) unlistenUrl();

      if (value) {
        console.log(`    🎉 Publish detected!`);
        // R19 — Held confirmation beat: signal the shell bar first, hold
        // ~800ms so the "Published to Matters" bar is visible, THEN close
        // the browser. Prevents the "moss stole my tab" feeling. The 800ms
        // uses the same `sleep` helper as the poll loop so tests can mock it.
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

    // Branch (a): poll loop — uses sleep() so tests can mock it to a no-op.
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

    // Branch (b): browser close — user explicitly dismissed the editor.
    if (browserHandle) {
      browserHandle.closed.then(() => {
        console.log(`    🚪 Browser closed by user`);
        settle(null);
      });
    }

    // Branch (c): URL-triggered immediate verify (latency optimisation; API is truth)
    onEvent<{ url: string }>("browser-url-changed", async (payload) => {
      // guard the leaked-listener race: if we've already settled (e.g. unlisten not yet stored), do nothing
      if (settled) return;
      const url = payload.url;
      console.log("[matters] browser-url-changed", url);
      if (!looksLikePublishedArticleUrl(url)) return;
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
      // If onEvent fails (e.g. no Tauri runtime in test env), log and continue.
      // The API poll provides the correctness backstop regardless.
      console.warn(`    ⚠️ Could not register browser-url-changed listener: ${err}`);
    });

    // NOTE: There is intentionally no branch (d) wall-clock timeout.
    // The Rust inactivity watchdog (60s, awaiting-aware) is the sole crash guard.
    // A slow user writing their Matters draft is never killed by a deadline.
  });
}

/**
 * Update the syndicated field in article frontmatter
 */
async function updateFrontmatterSyndicated(
  filePath: string,
  publishedUrl: string
): Promise<void> {
  try {
    const content = await readFile(filePath);
    const parsed = parseFrontmatter(content);

    if (!parsed) {
      console.warn(`    ⚠️ Could not parse frontmatter for ${filePath}`);
      return;
    }

    // Add to syndicated array if not already present
    const syndicated = (parsed.frontmatter.syndicated as string[]) || [];
    if (!syndicated.includes(publishedUrl)) {
      syndicated.push(publishedUrl);
      parsed.frontmatter.syndicated = syndicated;
    }

    // Regenerate file with updated frontmatter
    const newContent = regenerateFrontmatter(parsed.frontmatter) + "\n\n" + parsed.body;
    await writeFile(filePath, newContent);
  } catch (error) {
    console.warn(`    ⚠️ Failed to update frontmatter: ${error}`);
  }
}

/**
 * Get the best content from an article for syndication.
 * Prefers rendered HTML (for platforms like Matters that expect HTML),
 * falls back to markdown content.
 */
export function getArticleContent(article: ArticleInfo): { content: string; isHtml: boolean } {
  if (article.html_content) {
    return { content: article.html_content, isHtml: true };
  }
  return { content: article.content, isHtml: false };
}

/**
 * Normalize HTML content for Matters.town compatibility.
 *
 * Matters only accepts h2 and h3 headings. This function:
 * - Downgrades h1 → h2
 * - Keeps h2 and h3 unchanged
 * - Collapses h4, h5, h6 → h3 (to prevent removal by Matters)
 *
 * Image wrapping is also matters-specific. Matters' server-side HTML
 * sanitizer strips any `<img>` not inside `<figure class="image">` with
 * a `<figcaption>` child, and also strips `<figure>` with any other
 * class (`moss-image`, plain `<figure>`, etc.). Smoke test against
 * `server.matters.icu` on 2026-05-27 confirmed this contract empirically
 * (see `.credentials/accounts.md` for the test wallet).
 *
 * Phase 2A of the unified-image-emission migration (2026-05-25) removed
 * the plugin's matters-shape wrap on the assumption moss's
 * `<figure class="moss-image">` output would round-trip through matters.
 * It does not — matters strips that wrap entirely. So we restore the
 * wrap, but as a matters-specific pre-upload transform (not a
 * regression of moss-core's emission). See `wrapImagesForMatters`.
 */
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
 * moss appends `<a class="moss-heading-anchor" href="#…"><span
 * aria-hidden="true">#</span></a>` to every heading for web navigation. On the
 * site the `#` is hover-only chrome (CSS), but matters' sanitizer keeps the
 * anchor's text, so headings syndicate as e.g. "1.#" (a stray, linked `#`).
 * The `#` is not content, so we remove the whole anchor before syndication.
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
 * never a literal `<p>`. The HTML these transforms receive is NOT the shipped
 * page HTML — it is `article-map.json`'s `html_content`, which
 * `load_articles_for_syndication` reads and `getArticleContent` hands to the
 * transform chain. `data-source-line` is stripped only by `ship_phase`'s
 * staging→site FILE copy, which never touches `article-map.json`. So in
 * production every top-level paragraph arrives as `<p data-source-line="N">`,
 * and a literal `<p>` pattern silently matches nothing.
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
 * HTML-escaped. Verified against real `moss build` output 2026-07-21:
 *
 *   <code class="moss-math" data-moss-math="inline">$E = mc^2$</code>
 *   <p><code class="moss-math" data-moss-math="display">$$ o_t = x $$</code></p>
 *   <code class="moss-math" data-moss-math="inline">$a &lt; b \&amp; c &gt; d$</code>
 *
 * Matters' write paths run `normalizeArticleHTML(sanitizeHTML(content))`
 * (matters-server putDraft/publishArticle/editArticle). Smoke-tested 2026-07-21
 * by running the REAL `@matters/matters-editor` transformers bundle over each
 * candidate shape:
 *
 *   - `class` is emptied (only /^language-./ on `code` survives) and `data-*`
 *     is stripped, so `moss-math` / `data-moss-math` NEVER reach matters.
 *   - The TipTap round-trip has CodeBlock but NO inline Code mark, so a bare
 *     `<code>` element is DELETED, promoting its text into the parent. Today
 *     `<code class="moss-math">$E=mc^2$</code>` already arrives as plain
 *     `$E=mc^2$` — accidentally correct, but unchosen and untested. We now
 *     make it deliberate.
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
 * keeps — verified 2026-06-16 against `server.matters.icu` — is:
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

/**
 * Add canonical link to article content
 *
 * @param lang - Language code; when starting with "zh", uses Chinese text
 */
export function addCanonicalLinkToContent(
  content: string,
  canonicalUrl: string,
  isHtml: boolean = false,
  lang?: string
): string {
  const isZh = lang?.startsWith("zh") ?? false;
  const linkText = isZh ? "原文链接" : "Original link";

  if (isHtml) {
    return content + `<hr><p><a href="${canonicalUrl}">${linkText}</a></p>`;
  }
  const canonicalNotice = `\n\n---\n\n[${linkText}](${canonicalUrl})\n`;
  return content + canonicalNotice;
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

