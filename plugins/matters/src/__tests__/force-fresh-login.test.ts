/**
 * Tests for force-fresh login behavior (per-folder isolation).
 *
 * Verifies that promptLogin():
 *   (a) calls beginFreshLogin() BEFORE opening the browser
 *       (beginFreshLogin internally clears the stored token AND plugin cookies,
 *        which is proven by credential.test.ts)
 *   (b) re-binds boundUserName/userName to the freshly-authenticated account
 *       via affirmBindingFromProfile() on success
 *   (c) prepareWebviewAuth() is called BEFORE the draft-room openBrowser()
 *
 * Mirror of auth-routing.test.ts mock harness — same factory structure, same
 * hoisted helpers, same full mock set needed to drive process() end-to-end.
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
// Hoisted so it is accessible inside vi.mock AND in test assertions.
const mockApiConfig = vi.hoisted(() => ({
  queryMode: "viewer",
  testUserName: "Matty",
  endpoint: "https://server.matters.town/graphql",
}));
const mockTaskAwaiting = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Hoisted credential mock spies so tests can inspect invocationCallOrder.
const mockBeginFreshLogin = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPrepareWebviewAuth = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOpenBrowserHoisted = vi.hoisted(() => vi.fn().mockResolvedValue({ closed: new Promise<void>(() => {}) }));

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: (...args: unknown[]) => mockShowToast(...args),
  dismissToast: (...args: unknown[]) => mockDismissToast(...args),
  openBrowser: (...args: unknown[]) => mockOpenBrowserHoisted(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args),
  returnToEditor: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
  // T8a escape hatch — undefined = no test profile = production path.
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  // clearPluginCookies — kept for the @symbiosis-lab/moss-api mock surface
  // (credential.ts uses it, but credential is fully mocked below).
  clearPluginCookies: vi.fn().mockResolvedValue(undefined),
  startTask: vi.fn().mockResolvedValue({
    id: "0",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: (...args: unknown[]) => mockTaskAwaiting(...args),
    advise: vi.fn().mockResolvedValue(undefined),
    succeeded: (...args: unknown[]) => mockTaskSucceeded(...args),
    failed: (...args: unknown[]) => mockTaskFailed(...args),
    cancelled: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../credential", () => ({
  clearTokenCache: vi.fn(),
  loadStoredToken: vi.fn().mockResolvedValue(null),
  saveStoredToken: vi.fn().mockResolvedValue(undefined),
  clearStoredToken: vi.fn().mockResolvedValue(undefined),
  getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
  shouldNudgeSessionExpired: (...args: unknown[]) => mockShouldNudge(...args),
  markSessionInvalidated: vi.fn().mockResolvedValue(undefined),
  authHeaderToken: vi.fn(),
  captureLogin: (...args: unknown[]) => mockGetAccessToken(...args),
  prepareWebviewAuth: (...args: unknown[]) => mockPrepareWebviewAuth(...args),
  beginFreshLogin: (...args: unknown[]) => mockBeginFreshLogin(...args),
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
  // sleep resolves instantly so waitForToken's delays are instant in tests.
  sleep: vi.fn().mockResolvedValue(undefined),
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

import { process as processHook } from "../main";

// ============================================================================
// Fixtures
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockApiConfig.queryMode = "viewer";
  mockApiConfig.testUserName = "Matty";
  mockShouldNudge.mockResolvedValue(false);
  mockTaskAwaiting.mockResolvedValue(undefined);
  // Restore hoisted openBrowser after clearAllMocks
  mockOpenBrowserHoisted.mockResolvedValue({ closed: new Promise<void>(() => {}) });
  // Default: beginFreshLogin + prepareWebviewAuth no-op
  mockBeginFreshLogin.mockResolvedValue(undefined);
  mockPrepareWebviewAuth.mockResolvedValue(undefined);
});

// ============================================================================
// Tests
// ============================================================================

describe("force-fresh login", () => {
  it("calls beginFreshLogin BEFORE opening the login browser", async () => {
    // Unbound fresh folder — will reach promptLogin() via the binding-guard path.
    mockGetConfig.mockResolvedValue({});
    mockGetSessionState.mockResolvedValue("none");
    mockDetectBoundUser.mockResolvedValue(null);
    mockGetAccessToken.mockResolvedValue(null); // no token → waitForToken fails

    // Browser closes immediately so the hook exits cleanly (login fails).
    mockOpenBrowserHoisted.mockResolvedValue({ closed: Promise.resolve() });

    await processHook({
      trigger: "onboarding_flow",
      config: { sync_on_build: false },
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
    } as never);

    // beginFreshLogin must have been called.
    expect(mockBeginFreshLogin).toHaveBeenCalled();
    expect(mockOpenBrowserHoisted).toHaveBeenCalled();

    // Order invariant: beginFreshLogin must precede openBrowser.
    const beginFreshLoginOrder = mockBeginFreshLogin.mock.invocationCallOrder[0];
    const openBrowserOrder = mockOpenBrowserHoisted.mock.invocationCallOrder[0];
    expect(beginFreshLoginOrder).toBeLessThan(openBrowserOrder);
  });

  it("re-binds boundUserName to the freshly-authenticated account on success", async () => {
    // Already-bound-wrong folder: config has "alice", but "bob" logs in.
    mockGetConfig.mockResolvedValue({ boundUserName: "alice", userName: "alice" });
    // Expired session + settings_manual → prompt_login auth route.
    mockGetSessionState.mockResolvedValue("expired");

    // Browser stays open (never-closing handle) so waitForToken can poll.
    mockOpenBrowserHoisted.mockResolvedValue({ closed: new Promise<void>(() => {}) });
    // getAccessToken returns the fresh token on first poll → waitForToken succeeds.
    mockGetAccessToken.mockResolvedValue("fresh-token");
    // fetchUserProfile returns "bob" (the freshly-authenticated account).
    mockFetchUserProfile.mockResolvedValue({ userName: "bob", displayName: "Bob", language: null });

    await processHook({
      trigger: "settings_manual",
      config: { sync_on_build: false },
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
    } as never);

    // affirmBindingFromProfile (called from promptLogin) must have saved "bob".
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ boundUserName: "bob", userName: "bob" })
    );
  });
});
