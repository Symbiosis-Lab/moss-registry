/**
 * Tests for trigger-aware auth routing in the process hook (and, from T6,
 * the syndicate session gate + mid-sync auth failure handling).
 *
 * Mock prelude copied from binding-guard.test.ts with the deltas the full
 * pipeline needs. Both files now run sync_on_build: true — the setting only
 * ever short-circuits at the very top of process(), before any task exists
 * (see the "sync_on_build" describe block below) — so binding-guard.test.ts
 * carries the same full-pipeline mocks for the tests that fall through past
 * its binding guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn().mockResolvedValue(undefined);
const mockDetectBoundUser = vi.fn();
const mockGetAccessToken = vi.fn();
const mockFetchUserProfile = vi.fn();
const mockOpenBrowser = vi.fn();
const mockCloseBrowser = vi.fn().mockResolvedValue(undefined);
const mockGetSessionState = vi.fn();
const mockShouldNudge = vi.fn();
const mockFetchAllArticlesSince = vi.fn().mockResolvedValue({ articles: [], userName: "testuser" });
const mockShowToast = vi.fn().mockResolvedValue(undefined);
const mockDismissToast = vi.fn().mockResolvedValue(undefined);
const mockTaskFailed = vi.fn().mockResolvedValue(undefined);
const mockTaskSucceeded = vi.fn().mockResolvedValue(undefined);
// vi.hoisted: the ../api factory passes this object through by VALUE
// (`apiConfig: mockApiConfig`), which evaluates at factory time — a plain
// top-level const would hit the vi.mock hoisting TDZ.
const mockApiConfig = vi.hoisted(() => ({
  queryMode: "viewer",
  testUserName: "Matty",
  endpoint: "https://server.matters.town/graphql",
}));
// Hoisted so it's accessible inside vi.mock AND in test assertions.
// Task 2 watchdog fix: verify task.awaiting() is called BEFORE promptLogin().
const mockTaskAwaiting = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTaskCancelled = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
// Hoisted so "no task was ever created" (auto-import-off, no-articles-to-
// syndicate) is assertable directly, not just inferred from the terminal
// mocks staying uncalled.
const mockStartTask = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: (...args: unknown[]) => mockShowToast(...args),
  dismissToast: (...args: unknown[]) => mockDismissToast(...args),
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args),
  returnToEditor: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
  // T8a escape hatch — undefined return = no test profile = production
  // path (which is what these routing tests exercise).
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  // clearPluginCookies — called by promptLogin() before opening the browser.
  clearPluginCookies: vi.fn().mockResolvedValue(undefined),
  // startTask mock — returns a TaskHandle whose terminal transitions are
  // captured so tests can assert on the receipt copy. Routed through the
  // hoisted mockStartTask so tests can also assert a task was never created
  // (auto-import-off, no-articles-to-syndicate — deletion-shaped: no task,
  // no receipt).
  // mockTaskAwaiting is hoisted so tests can assert call-order vs openBrowser.
  startTask: (...args: unknown[]) => mockStartTask(...args),
}));

vi.mock("../config", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../sync", () => ({
  detectBoundUser: (...args: unknown[]) => mockDetectBoundUser(...args),
  syncToLocalFiles: vi.fn().mockResolvedValue({
    result: { created: 0, updated: 0, skipped: 0, errors: [] },
    articlePathMap: new Map(),
  }),
  scanLocalArticles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../credential", () => ({
  clearTokenCache: vi.fn(),
  bindStoredToken: vi.fn().mockResolvedValue(undefined),
  getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
  shouldNudgeSessionExpired: (...args: unknown[]) => mockShouldNudge(...args),
  markSessionInvalidated: vi.fn().mockResolvedValue(undefined),
  authHeaderToken: vi.fn(),
  captureLogin: (...args: unknown[]) => mockGetAccessToken(...args),
  prepareWebviewAuth: vi.fn().mockResolvedValue(undefined),
  beginFreshLogin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api", () => ({
  fetchAllArticlesSince: (...args: unknown[]) => mockFetchAllArticlesSince(...args),
  fetchAllDraftsSince: vi.fn().mockResolvedValue([]),
  fetchAllCollections: vi.fn().mockResolvedValue([]),
  fetchUserProfile: (...args: unknown[]) => mockFetchUserProfile(...args),
  fetchArticleComments: vi.fn().mockResolvedValue({ comments: [], donations: [], appreciations: [] }),
  fetchAllArticleCommentCounts: vi.fn().mockResolvedValue(new Map()),
  apiConfig: mockApiConfig,
  MattersAuthError: class MattersAuthError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "MattersAuthError";
      this.code = code;
    }
  },
}));

vi.mock("../domain", () => ({
  initializeDomain: vi.fn().mockResolvedValue("matters.town"),
  getDomain: vi.fn().mockReturnValue("matters.town"),
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  articleUrl: vi.fn(),
  isMattersUrl: vi.fn(),
}));

vi.mock("../utils", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
  // Pure receipt formatter — stubbed (these tests assert routing + the unauth
  // note, not the summary text; the real impl is covered by utils.test.ts).
  // A fixed factory is used here on purpose: importing the real ../utils runs
  // its top-level setMessageContext() side effect, which has no host in tests.
  formatArticleSyncSummary: vi.fn(() => "articles synced"),
}));

vi.mock("../progress", () => ({
  overallProgress: vi.fn().mockReturnValue(0),
}));

vi.mock("../converter", () => ({
  parseFrontmatter: vi.fn(),
  regenerateFrontmatter: vi.fn(),
}));

vi.mock("../downloader", () => ({
  downloadMediaAndUpdate: vi.fn().mockResolvedValue({ imagesDownloaded: 0, imagesSkipped: 0, errors: [] }),
  rewriteAllInternalLinks: vi.fn().mockResolvedValue({ linksRewritten: 0 }),
}));

vi.mock("../social", () => ({
  loadSocialData: vi.fn().mockResolvedValue({}),
  saveSocialData: vi.fn().mockResolvedValue(undefined),
  mergeSocialData: vi.fn().mockReturnValue({}),
  reconcileLegacySocialData: vi.fn().mockResolvedValue(false),
}));

import { process as processHook, syndicate, login as loginHook } from "../main";
// Resolves to the class in our ../api mock, so instanceof matches what
// main.ts (which imports from the same mocked module) catches.
import { MattersAuthError } from "../api";
// The ../domain mock's isMattersUrl is a bare vi.fn() (undefined by default,
// i.e. "not yet syndicated") — the no-op syndicate tests below need to flip
// it per case.
import { isMattersUrl } from "../domain";

// ============================================================================
// Fixtures
// ============================================================================

/** Passing-guard config fixture: boundUserName set so the guard is satisfied. */
const BOUND_CONFIG = { boundUserName: "guo", userName: "guo" };

function makeContext(trigger: string | undefined) {
  // Mirror binding-guard.test.ts's context fixture; only trigger varies.
  return {
    trigger,
    config: { sync_on_build: true },
    project_info: { folder_name: "test", homepage_file: null, lang: "en" },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiConfig.queryMode = "viewer";
  mockApiConfig.testUserName = "Matty";
  mockGetConfig.mockResolvedValue({ ...BOUND_CONFIG, userName: "guo" });
  mockShouldNudge.mockResolvedValue(true);
  mockFetchUserProfile.mockResolvedValue({ userName: "guo", displayName: "Guo", language: "en" });
  // Restore awaiting behavior after clearAllMocks (Task 2 watchdog fix).
  mockTaskAwaiting.mockResolvedValue(undefined);
  mockTaskCancelled.mockResolvedValue(undefined);
  // Restore startTask's resolved TaskHandle after clearAllMocks.
  mockStartTask.mockResolvedValue({
    id: "0",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: (...args: unknown[]) => mockTaskAwaiting(...args),
    advise: vi.fn().mockResolvedValue(undefined),
    succeeded: (...args: unknown[]) => mockTaskSucceeded(...args),
    failed: (...args: unknown[]) => mockTaskFailed(...args),
    cancelled: (...args: unknown[]) => mockTaskCancelled(...args),
  });
});

// ============================================================================
// Tests
// ============================================================================

describe("process hook auth routing", () => {
  it("expired + background + userName → public fallback, no login window, NO toast (background must not interrupt)", async () => {
    // open-feedback-design (2026-09-15): a background rebuild's expired
    // session must not toast — the report was exactly this, a "login
    // expired" toast popping while the app was still on the post-open
    // waiting screen. notifySessionExpired still logs (console.warn) and
    // the receipt stays honest; only the TOAST is gated on isUserPresent.
    mockGetSessionState.mockResolvedValue("expired");
    await processHook(makeContext("background"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(mockApiConfig.queryMode).toBe("user");
    expect(mockApiConfig.testUserName).toBe("guo");
    expect(mockShowToast).not.toHaveBeenCalled();
    // The receipt (not a toast) still tells the truth about the session.
    expect(String(mockTaskSucceeded.mock.calls[0][0])).toContain(". Matters session expired");
  });

  it("expired + background + NO userName → silent success (no error badge, no toast, on background rebuild)", async () => {
    // Phase 4a B2: soft_fail on a background build should NOT show an error
    // badge — it would recur on every rebuild for unlogged-but-Matters-installed
    // folders. The standalone connect_account command + the Phase 4b auto-open
    // trigger carry the actual prompt; background builds exit quietly — and
    // (2026-09-15) that now includes the session-expired toast too: soft_fail
    // is only ever reached on a non-user-present trigger.
    mockGetConfig.mockResolvedValue({ ...BOUND_CONFIG, userName: undefined });
    mockGetSessionState.mockResolvedValue("expired");
    const result = await processHook(makeContext("background"));
    // B2: background "needs connection" → task.succeeded (not task.failed).
    expect(result.success).toBe(true);
    expect(mockTaskFailed).not.toHaveBeenCalled();
    expect(mockTaskSucceeded).toHaveBeenCalled();
    // The receipt is shown bare in the panel (no plugin-name prefix, see the
    // sync_on_build:false test above) and must say WHICH state this is — an
    // expired session is a different fact from never having connected.
    expect(String(mockTaskSucceeded.mock.calls[0][0])).toBe("Matters session expired");
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("none + background + NO userName → silent success with a 'not connected' receipt naming Matters", async () => {
    // The other soft_fail state (never logged in, as opposed to expired
    // above) — pins that the receipt text tracks sessionState instead of
    // being hardcoded to one string regardless of which state was reached.
    mockGetConfig.mockResolvedValue({ ...BOUND_CONFIG, userName: undefined });
    mockGetSessionState.mockResolvedValue("none");
    const result = await processHook(makeContext("background"));
    expect(result.success).toBe(true);
    expect(mockTaskFailed).not.toHaveBeenCalled();
    expect(String(mockTaskSucceeded.mock.calls[0][0])).toBe("Matters not connected");
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("expired + settings_manual → opens the login window", async () => {
    mockGetSessionState.mockResolvedValue("expired");
    // Pre-closed handle: waitForToken's window-closed check exits the poll,
    // promptLogin returns false; we only assert the login UI was reached.
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    const result = await processHook(makeContext("settings_manual"));
    expect(mockOpenBrowser).toHaveBeenCalled();
    expect(result.success).toBe(false); // login did not complete in this stub
  });

  it("none + settings_manual + userName → public fallback with not-logged-in receipt (existing behavior, now honest)", async () => {
    mockGetSessionState.mockResolvedValue("none");
    const result = await processHook(makeContext("settings_manual"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(mockApiConfig.queryMode).toBe("user");
    expect(result.success).toBe(true);
    expect(String(mockTaskSucceeded.mock.calls[0][0])).toContain(". Not logged in");
    expect(mockShowToast).not.toHaveBeenCalled(); // no session event, no toast
  });

  it("valid + background → proceeds in viewer mode, no toast, no login", async () => {
    mockGetSessionState.mockResolvedValue("valid");
    const result = await processHook(makeContext("background"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockApiConfig.queryMode).toBe("viewer");
    expect(result.success).toBe(true);
  });

  it("queryMode reset: a fallback run does not leak public mode into the next run", async () => {
    // Module state persists across hook invocations in the webview runtime;
    // public_fallback flips queryMode to "user" and a later valid-session
    // run must start back in "viewer".
    mockGetSessionState.mockResolvedValue("expired");
    await processHook(makeContext("background"));
    expect(mockApiConfig.queryMode).toBe("user");
    mockGetSessionState.mockResolvedValue("valid");
    await processHook(makeContext("background"));
    expect(mockApiConfig.queryMode).toBe("viewer");
  });

  it("sync_on_build:false → no task, no receipt, regardless of session state (expired)", async () => {
    // Before the fix, an expired-session background rebuild still reached
    // the auth switch and stamped route-dependent copy into a receipt
    // ("Matters auto-import off" here vs. "Authenticated (…)" below) before
    // finally noticing sync_on_build was false. The setting is now checked
    // before any of that runs: no startTask, no getSessionState call, no
    // panel row at all — a setting the user chose is not a build event.
    mockGetSessionState.mockResolvedValue("expired");
    const ctx = {
      trigger: "background",
      config: { sync_on_build: false },
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
    } as never;
    const result = await processHook(ctx);
    expect(result).toEqual({ success: true, message: "Matters auto-import off" });
    expect(mockStartTask).not.toHaveBeenCalled();
    expect(mockTaskSucceeded).not.toHaveBeenCalled();
    expect(mockGetSessionState).not.toHaveBeenCalled();
  });

  it("sync_on_build:false → same silent no-op on a valid session (proceed route)", async () => {
    // Pins that the outcome no longer depends on the auth route at all —
    // the old "Authenticated (Matters auto-import off)" route-aware message
    // is gone because auth routing never runs when the setting is off.
    mockGetSessionState.mockResolvedValue("valid");
    const ctx = {
      trigger: "background",
      config: { sync_on_build: false },
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
    } as never;
    const result = await processHook(ctx);
    expect(result).toEqual({ success: true, message: "Matters auto-import off" });
    expect(mockStartTask).not.toHaveBeenCalled();
    expect(mockTaskSucceeded).not.toHaveBeenCalled();
    expect(mockGetSessionState).not.toHaveBeenCalled();
  });
});

describe("binding guard trigger gating", () => {
  it("unbound + background → quiet clean success, NO login window", async () => {
    mockGetConfig.mockResolvedValue({}); // no boundUserName
    mockDetectBoundUser.mockResolvedValue(null);
    const result = await processHook(makeContext("background"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain("No Matters account bound");
  });

  it("unbound + onboarding_flow → still prompts login (user is present)", async () => {
    mockGetConfig.mockResolvedValue({});
    mockDetectBoundUser.mockResolvedValue(null);
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    await processHook(makeContext("onboarding_flow"));
    expect(mockOpenBrowser).toHaveBeenCalled();
  });
});

describe("mid-sync auth failure (process)", () => {
  beforeEach(() => {
    mockGetSessionState.mockResolvedValue("valid"); // passes pre-flight...
  });

  it("MattersAuthError during fetch, background trigger → clean session-expired failure, NO toast", async () => {
    // ...then the server revokes mid-run, on an ordinary background rebuild —
    // this must not interrupt with a toast (open-feedback-design, 2026-09-15).
    mockFetchAllArticlesSince.mockRejectedValueOnce(
      new MattersAuthError("TOKEN_INVALID", "Matters rejected the session (TOKEN_INVALID)")
    );
    const result = await processHook(makeContext("background"));
    expect(result.success).toBe(false);
    const failedMsg = String(mockTaskFailed.mock.calls[0][0]);
    expect(failedMsg).toContain("session expired");
    expect(failedMsg).not.toContain("Error:");
    expect(failedMsg).not.toContain("500");
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("MattersAuthError during fetch, settings_manual trigger → the user IS present, toast surfaces", async () => {
    // Mid-run revocation is not gated by resolveAuthRoute (unlike
    // public_fallback/soft_fail, which can only ever be background here) —
    // this is the one process()-hook path where a user-present trigger can
    // actually reach notifySessionExpired, so it's the one that proves the
    // "surfaces when the user acts on Matters" half of the fix.
    mockFetchAllArticlesSince.mockRejectedValueOnce(
      new MattersAuthError("TOKEN_INVALID", "Matters rejected the session (TOKEN_INVALID)")
    );
    const result = await processHook(makeContext("settings_manual"));
    expect(result.success).toBe(false);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast.mock.calls[0][0].message).toContain("session expired");
    expect(mockShowToast.mock.calls[0][0].persistent).toBe(true);
  });

  it("MattersAuthError during fetch, settings_manual trigger, throttle says no → still no toast (logs only)", async () => {
    // The per-expiry-event throttle is a second, independent gate: even a
    // user-present trigger stays quiet once the nudge has already fired for
    // this expiry.
    mockShouldNudge.mockResolvedValue(false);
    mockFetchAllArticlesSince.mockRejectedValueOnce(
      new MattersAuthError("TOKEN_INVALID", "Matters rejected the session (TOKEN_INVALID)")
    );
    const result = await processHook(makeContext("settings_manual"));
    expect(result.success).toBe(false);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("non-auth error during fetch keeps the cause, de-nested (no 'Error:' prefix)", async () => {
    mockFetchAllArticlesSince.mockRejectedValueOnce(
      new Error("GraphQL request failed (502): upstream connect error")
    );
    const result = await processHook(makeContext("background"));
    expect(result.success).toBe(false);
    const failedMsg = String(mockTaskFailed.mock.calls[0][0]);
    expect(failedMsg).toContain("502");
    expect(failedMsg).not.toContain("Error:"); // the de-nesting is the change under test
  });
});

describe("syndicate session gate", () => {
  // One unsyndicated article so execution reaches the session gate: an
  // empty list early-returns "No new articles to syndicate" BEFORE the
  // gate. Both tests still exit before the per-article loop (login fails /
  // fetchUserProfile rejects), so isArticleLive is never reached.
  const SYNDICATE_CONTEXT = {
    deployment: { url: "https://example.com", deployed_at: "2026-06-10T00:00:00Z" },
    articles: [
      {
        title: "A post",
        content: "body",
        url_path: "posts/a-post.html",
        tags: [],
        frontmatter: {},
      },
    ],
    config: {},
    project_info: { folder_name: "test", homepage_file: null, lang: "en" },
    // syndicate_to_platforms' one production caller (Publish click) always
    // stamps this — mirror that shape rather than leaving it undefined.
    trigger: "manual_one",
  } as never;

  it("expired session → prompts login before syndicating", async () => {
    mockGetSessionState.mockResolvedValue("expired");
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    const result = await syndicate(SYNDICATE_CONTEXT);
    expect(mockOpenBrowser).toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Login required");
  });

  it("login-cancelled path does NOT emit 'Login cancelled' toast (task.failed() is the terminal signal)", async () => {
    // When promptLogin returns false (window closed immediately), the old code
    // emitted a 'Login cancelled' toast — that was deleted. Only the
    // 'Matters login required' persistent toast (Law 2) must fire; task.failed()
    // is the terminal failure signal. No 'Login cancelled' chatty toast.
    mockGetSessionState.mockResolvedValue("expired");
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() }); // closes immediately → loginSuccess=false
    await syndicate(SYNDICATE_CONTEXT);
    const cancelledToast = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("Login cancelled") || opts.message?.includes("cancelled"),
    );
    expect(cancelledToast).toBeUndefined();
    // The login-required toast still fires (Law 2: blocking state must persist)
    const loginRequiredToast = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("login required"),
    );
    expect(loginRequiredToast).toBeDefined();
  });

  it("syndicate() does NOT emit 'Starting Matters syndication...' toast (startTask() is the per-run signal)", async () => {
    // Law 1: one event one home. The startTask() call at the top of syndicate()
    // already registers the task in L1 — a simultaneous 'Starting...' toast
    // is a double-signal that was deleted. Verified absent in any syndicate path.
    mockGetSessionState.mockResolvedValue("expired");
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() }); // short-circuit to login path
    await syndicate(SYNDICATE_CONTEXT);
    const startingToast = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("Starting Matters syndication"),
    );
    expect(startingToast).toBeUndefined();
  });

  it("MattersAuthError outside the loop → session-expired publish copy, AND a toast (syndicate is always user-initiated)", async () => {
    mockGetSessionState.mockResolvedValue("valid");
    mockGetConfig.mockResolvedValue({ ...BOUND_CONFIG, userName: undefined }); // forces fetchUserProfile
    mockFetchUserProfile.mockRejectedValueOnce(
      new MattersAuthError("TOKEN_INVALID", "Matters rejected the session (TOKEN_INVALID)")
    );
    const result = await syndicate(SYNDICATE_CONTEXT);
    expect(result.success).toBe(false);
    expect(result.message).toContain("session expired, log in again to publish.");
    // Publish counts as user-present (trigger: "manual_one") — unlike a
    // background rebuild's expired session, this one surfaces.
    expect(mockShowToast).toHaveBeenCalled();
    const nudge = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("session expired"),
    );
    expect(nudge).toBeDefined();
  });

  // Task 2 watchdog fix: task.awaiting() must be called BEFORE promptLogin()
  // (which calls openBrowser) so the Rust inactivity watchdog knows the hook
  // is legitimately waiting for the user, not stalled.
  it("login-awaiting: task.awaiting() is called BEFORE openBrowser (promptLogin) during syndicate login", async () => {
    mockGetSessionState.mockResolvedValue("expired");
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() }); // closes immediately
    await syndicate(SYNDICATE_CONTEXT);

    // Spec: quiet label, no Awaiting pulse — awaiting is called with an empty
    // venue string so the UI shows the directive text as a quiet label rather
    // than "Waiting for you to [x] in [venue]". The core invariant (called
    // BEFORE openBrowser so the Rust watchdog marks the hook Awaiting) is
    // unchanged.
    expect(mockTaskAwaiting).toHaveBeenCalledWith("Connect to Matters", "", "cancel");
    expect(mockOpenBrowser).toHaveBeenCalled();

    // Order invariant: awaiting must precede openBrowser so the watchdog
    // marks the hook as Awaiting before the browser window opens.
    const awaitingOrder = mockTaskAwaiting.mock.invocationCallOrder[0];
    const openBrowserOrder = mockOpenBrowser.mock.invocationCallOrder[0];
    expect(awaitingOrder).toBeLessThan(openBrowserOrder);
  });
});

describe("syndicate: no-op runs", () => {
  // Same rubric as the auto-import-off fix in process(): a publish that
  // tells Matters nothing new is not an event of this run. When the plugin
  // can tell there's nothing to do before creating the task (every article
  // already syndicated), it doesn't. When it can't tell until after the
  // task exists and the loop has run, it still reports the honest count via
  // succeeded() — row suppression for a real, honest zero is
  // progress-panel.ts's job (progress-panel-job.test.ts), not this hook's.
  const baseArticle = {
    title: "A post",
    content: "body",
    url_path: "posts/a-post.html",
    tags: [],
  };

  it("every article already syndicated → no task, no receipt (nothing to create)", async () => {
    vi.mocked(isMattersUrl).mockReturnValue(true);
    const ctx = {
      deployment: { url: "https://example.com", deployed_at: "2026-06-10T00:00:00Z" },
      articles: [
        { ...baseArticle, frontmatter: { syndicated: ["https://matters.town/@guo/a-post-abc123"] } },
      ],
      config: {},
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
      trigger: "manual_one",
    } as never;

    const result = await syndicate(ctx);

    expect(result).toEqual({ success: true, message: "No new articles to syndicate" });
    expect(mockStartTask).not.toHaveBeenCalled();
    expect(mockTaskSucceeded).not.toHaveBeenCalled();
    expect(mockGetSessionState).not.toHaveBeenCalled();
  });

  it("candidate article not live yet → task is created (can't be avoided) but succeeds honestly with amount 0", async () => {
    // The task already exists by the time the run's outcome is known (the
    // per-article loop needs it for progress), so "don't create it" isn't
    // available here — unlike the case above. isArticleLive HEADs the
    // deployed URL via the global fetch; stub it not-OK so the article is
    // skipped, landing on published=0/draftsCreated=0/errors=0. Whether that
    // paints a panel row is progress-panel.ts's call (a Job with amount 0
    // and no advisory renders nothing); this hook's job is just to report
    // the real count via succeeded(), never cancelled() — cancelled() would
    // silently drop any advisory riding the same terminal call (moss-api:
    // advise() flushes on succeeded()/failed() only).
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response));
    vi.mocked(isMattersUrl).mockReturnValue(false);
    mockGetSessionState.mockResolvedValue("valid");
    const ctx = {
      deployment: { url: "https://example.com", deployed_at: "2026-06-10T00:00:00Z" },
      articles: [{ ...baseArticle, frontmatter: {} }],
      config: {},
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
      trigger: "manual_one",
    } as never;

    try {
      const result = await syndicate(ctx);

      expect(result.success).toBe(true);
      expect(mockStartTask).toHaveBeenCalled();
      expect(mockTaskSucceeded).toHaveBeenCalledWith(undefined, 0);
      expect(mockTaskCancelled).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("process hook login-awaiting (Task 2 watchdog fix)", () => {
  const UNBOUND_CONTEXT = {
    trigger: "onboarding_flow",
    config: { sync_on_build: true },
    project_info: { folder_name: "test", homepage_file: null, lang: "en" },
  } as never;

  beforeEach(() => {
    // Simulate an unbound project requiring login (fresh project path).
    mockGetConfig.mockResolvedValue({}); // no boundUserName
    mockDetectBoundUser.mockResolvedValue(null); // no existing articles
    // Browser closes immediately — login fails; tests only care about
    // the call order, not the success outcome.
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    mockGetAccessToken.mockResolvedValue(null);
    mockTaskAwaiting.mockResolvedValue(undefined);
  });

  // task.awaiting() must precede openBrowser (promptLogin) in the process
  // hook's fresh-bind path so the watchdog is aware the hook is Awaiting.
  it("login-awaiting: task.awaiting() is called BEFORE openBrowser (promptLogin) in fresh-bind login", async () => {
    await processHook(UNBOUND_CONTEXT);

    // Spec: quiet label — same empty venue, same order invariant (awaiting
    // before openBrowser so the Rust watchdog marks the hook Awaiting).
    expect(mockTaskAwaiting).toHaveBeenCalledWith("Connect to Matters", "", "cancel");
    expect(mockOpenBrowser).toHaveBeenCalled();

    const awaitingOrder = mockTaskAwaiting.mock.invocationCallOrder[0];
    const openBrowserOrder = mockOpenBrowser.mock.invocationCallOrder[0];
    expect(awaitingOrder).toBeLessThan(openBrowserOrder);
  });
});

// ============================================================================
// login export (Phase 4a B1 — standalone connect_account hook)
// ============================================================================

describe("login export (standalone connect_account hook)", () => {
  const baseLoginContext = {
    project_path: "/test-project",
    moss_dir: "/test-project/.moss",
    config: {},
    project_info: { homepage_file: null, lang: "en" },
    trigger: "settings_manual",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore awaiting so watchdog-suppression assertion works.
    mockTaskAwaiting.mockResolvedValue(undefined);
    mockGetConfig.mockResolvedValue({ userName: "guo", boundUserName: "guo" });
    mockFetchUserProfile.mockResolvedValue({ userName: "guo", displayName: "Guo", language: "en" });
  });

  it("creates a task, immediately calls task.awaiting() (watchdog suppression)", async () => {
    // Token appears on first poll — login succeeds fast.
    mockOpenBrowser.mockResolvedValue({ closed: new Promise(() => {}) });
    mockGetAccessToken.mockResolvedValue("tok");

    await loginHook(baseLoginContext as never);

    // task.awaiting() must be called before openBrowser so the Rust watchdog
    // marks the hook Awaiting before any long human-paced operation starts.
    expect(mockTaskAwaiting).toHaveBeenCalledWith("Connect to Matters", "", "cancel");
    expect(mockOpenBrowser).toHaveBeenCalled();
    const awaitOrder = mockTaskAwaiting.mock.invocationCallOrder[0];
    const openOrder = mockOpenBrowser.mock.invocationCallOrder[0];
    expect(awaitOrder).toBeLessThan(openOrder);
  });

  it("returns success and calls task.succeeded on successful login", async () => {
    mockOpenBrowser.mockResolvedValue({ closed: new Promise(() => {}) });
    mockGetAccessToken.mockResolvedValue("tok");

    const result = await loginHook(baseLoginContext as never);

    expect(result.success).toBe(true);
    expect(mockTaskSucceeded).toHaveBeenCalledWith("Connected to Matters");
    expect(mockTaskFailed).not.toHaveBeenCalled();
  });

  it("returns success (dismissed) and calls task.succeeded when user closes panel", async () => {
    // User closes the panel immediately — BrowserHandle.closed resolves.
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    mockGetAccessToken.mockResolvedValue(null); // no token found

    const result = await loginHook(baseLoginContext as never);

    // Closing is NOT an error — task.succeeded (not task.failed).
    expect(result.success).toBe(true);
    expect(mockTaskSucceeded).toHaveBeenCalledWith("Login dismissed");
    expect(mockTaskFailed).not.toHaveBeenCalled();
  });

  it("calls promptLogin (shared logic) — same openBrowser path as process hook", async () => {
    // This proves login() shares promptLogin() with the process hook (no
    // duplicated login-flow implementation). Both call openBrowser with
    // the same login URL from loginUrl().
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    mockGetAccessToken.mockResolvedValue(null);

    await loginHook(baseLoginContext as never);

    // beginFreshLogin + openBrowser are called by promptLogin() — evidence
    // the login export delegates to the shared flow, not a bespoke copy.
    const { beginFreshLogin } = await import("../credential");
    expect(beginFreshLogin).toHaveBeenCalled();
    expect(mockOpenBrowser).toHaveBeenCalledWith(expect.stringContaining("matters.town"));
  });
});
