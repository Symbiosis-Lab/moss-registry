/**
 * Tests for the process hook binding guard.
 *
 * The binding guard prevents the Matters plugin from syncing articles
 * into projects that haven't been explicitly connected to a Matters account.
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
// vi.hoisted: the ../api factory passes this object through by VALUE
// (`apiConfig: mockApiConfig`), which evaluates at factory time — a plain
// top-level const would hit the vi.mock hoisting TDZ. Shared and MUTATED
// across tests (public_fallback flips it), so beforeEach resets it.
const mockApiConfig = vi.hoisted(() => ({
  queryMode: "viewer",
  testUserName: "Matty",
  endpoint: "https://server.matters.town/graphql",
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: vi.fn().mockResolvedValue(undefined),
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args),
  returnToEditor: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
  // T8a escape hatch — undefined return = no test profile = production
  // path (which is what these binding-guard tests exercise).
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  // clearPluginCookies — called by promptLogin() before opening the browser.
  clearPluginCookies: vi.fn().mockResolvedValue(undefined),
  // startTask mock — returns a no-op TaskHandle so process hook can drive
  // the PanelTask lifecycle without a real Tauri context.
  startTask: vi.fn().mockResolvedValue({
    id: "0",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: vi.fn().mockResolvedValue(undefined),
    succeeded: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
    cancelled: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../config", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../sync", () => ({
  detectBoundUser: (...args: unknown[]) => mockDetectBoundUser(...args),
  syncToLocalFiles: vi.fn().mockResolvedValue({ result: { created: 0, updated: 0, skipped: 0 }, articlePathMap: new Map() }),
  scanLocalArticles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../credential", () => ({
  clearTokenCache: vi.fn(),
  loadStoredToken: vi.fn().mockResolvedValue(null),
  saveStoredToken: vi.fn().mockResolvedValue(undefined),
  clearStoredToken: vi.fn().mockResolvedValue(undefined),
  getSessionState: vi.fn().mockResolvedValue("none"),
  shouldNudgeSessionExpired: vi.fn().mockResolvedValue(false),
  markSessionInvalidated: vi.fn().mockResolvedValue(undefined),
  authHeaderToken: vi.fn(),
  captureLogin: (...args: unknown[]) => mockGetAccessToken(...args),
  prepareWebviewAuth: vi.fn().mockResolvedValue(undefined),
  beginFreshLogin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api", () => ({
  fetchAllArticlesSince: vi.fn().mockResolvedValue({ articles: [], userName: "testuser" }),
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
}));

vi.mock("../progress", () => ({
  overallProgress: vi.fn().mockReturnValue(0),
}));

vi.mock("../converter", () => ({
  parseFrontmatter: vi.fn(),
  regenerateFrontmatter: vi.fn(),
}));

vi.mock("../downloader", () => ({
  downloadMediaAndUpdate: vi.fn().mockResolvedValue(undefined),
  rewriteAllInternalLinks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../social", () => ({
  loadSocialData: vi.fn().mockResolvedValue({}),
  saveSocialData: vi.fn().mockResolvedValue(undefined),
  mergeSocialData: vi.fn().mockReturnValue({}),
}));

import { process } from "../main";

// ============================================================================
// Tests
// ============================================================================

describe("process hook binding guard", () => {
  // sync_on_build: false so process() returns early after auth, letting us test
  // only the binding guard logic without needing full sync mocking
  const baseContext = {
    project_path: "/test-project",
    moss_dir: "/test-project/.moss",
    config: { sync_on_build: false },
    project_info: { homepage_file: null, lang: "en" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiConfig.queryMode = "viewer";
    mockApiConfig.testUserName = "Matty";
  });

  it("proceeds normally when boundUserName is already set", async () => {
    mockGetConfig.mockResolvedValue({ boundUserName: "alice", userName: "alice" });
    mockGetAccessToken.mockResolvedValue("test-token");
    mockFetchUserProfile.mockResolvedValue({
      userName: "alice",
      displayName: "Alice",
      language: "en",
    });

    const result = await process(baseContext);

    expect(result.success).toBe(true);
    // detectBoundUser should NOT be called — boundUserName was already in config
    expect(mockDetectBoundUser).not.toHaveBeenCalled();
  });

  it("auto-binds when existing Matters articles are found", async () => {
    // First call: no boundUserName. Second call (after save): with boundUserName
    mockGetConfig
      .mockResolvedValueOnce({}) // binding guard check
      .mockResolvedValue({ boundUserName: "bob", userName: "bob" }); // subsequent calls
    mockDetectBoundUser.mockResolvedValue("bob");
    mockGetAccessToken.mockResolvedValue("test-token");
    mockFetchUserProfile.mockResolvedValue({
      userName: "bob",
      displayName: "Bob",
      language: "en",
    });

    const result = await process(baseContext);

    expect(result.success).toBe(true);
    // Should have saved both boundUserName and userName
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ boundUserName: "bob", userName: "bob" })
    );
    // Should NOT have opened the login browser
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("skips sync gracefully when user closes login window on unbound project", async () => {
    mockGetConfig.mockResolvedValue({}); // no boundUserName
    mockDetectBoundUser.mockResolvedValue(null); // no existing articles
    // openBrowser returns a handle whose .closed resolves immediately (user closed window)
    mockOpenBrowser.mockResolvedValue({
      closed: Promise.resolve(),
    });
    mockGetAccessToken.mockResolvedValue(null); // no token

    // A present-user trigger is required to reach promptLogin at all — the
    // background gate exits before it (spec §3.3). Without this trigger the
    // window-close mocks above are dead setup and the path is uncovered.
    const result = await process({ ...baseContext, trigger: "onboarding_flow" });

    expect(result.success).toBe(true);
    expect(result.message).toContain("No Matters account bound");
    // The login window must actually have been opened (guards against the
    // trigger gate silently short-circuiting this test again).
    expect(mockOpenBrowser).toHaveBeenCalled();
    // Should NOT have saved any config
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it("binds after successful login on fresh project", async () => {
    mockGetConfig
      .mockResolvedValueOnce({}) // binding guard check
      .mockResolvedValueOnce({}) // affirmBindingFromProfile inside promptLogin
      .mockResolvedValue({ boundUserName: "carol", userName: "carol" }); // after binding
    mockDetectBoundUser.mockResolvedValue(null); // no existing articles
    // openBrowser returns handle; token appears after login
    mockOpenBrowser.mockResolvedValue({
      closed: new Promise(() => {}), // never closes
    });
    // First getAccessToken call returns null (pre-login), then returns token
    mockGetAccessToken
      .mockResolvedValueOnce(null) // initial check in waitForToken
      .mockResolvedValueOnce("new-token") // found after login
      .mockResolvedValue("new-token"); // subsequent checks
    mockFetchUserProfile.mockResolvedValue({
      userName: "carol",
      displayName: "Carol",
      language: "en",
    });

    // Login-to-bind requires a present user since the trigger gate (spec
    // §3.3): background/absent triggers exit quietly instead of prompting.
    const result = await process({ ...baseContext, trigger: "onboarding_flow" });

    expect(result.success).toBe(true);
    // affirmBindingFromProfile (called from promptLogin) saves the binding.
    // The condition fires because getConfig returns {} (no boundUserName yet)
    // while fetchUserProfile returns "carol".
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ boundUserName: "carol" })
    );
  });
});
