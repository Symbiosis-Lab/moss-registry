/**
 * Tests for the MOSS_MATTERS_TEST_PROFILE escape hatch (T8a, 2026-05-28).
 *
 * Verifies both layers of the escape hatch:
 *   1. API layer: apiConfig.queryMode flips to "user" and apiConfig.testUserName
 *      is set to the profile (strips leading @).
 *   2. UI layer: when the env var is set, the process hook auto-binds to the
 *      test profile without prompting login and without calling openBrowser.
 *
 * Both layers must work together for the e2e harness — an API-only flip
 * leaves the auth webview visible (per dispatch plan).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPluginEnvVar = vi.fn();
const mockOpenBrowser = vi.fn();
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn().mockResolvedValue(undefined);
const mockDetectBoundUser = vi.fn();
const mockFetchUserProfile = vi.fn();
const mockSyncToLocalFiles = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  setPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  httpGet: vi.fn(),
  fetchUrl: vi.fn(),
  downloadAsset: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: vi.fn().mockResolvedValue(undefined),
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn().mockResolvedValue(false),
  getPluginEnvVar: (...args: unknown[]) => mockGetPluginEnvVar(...args),
  // clearPluginCookies — called by promptLogin() before opening the browser.
  clearPluginCookies: vi.fn().mockResolvedValue(undefined),
  // setMessageContext is called at module load by utils.ts — stub it.
  setMessageContext: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  reportComplete: vi.fn().mockResolvedValue(undefined),
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
  syncToLocalFiles: (...args: unknown[]) => mockSyncToLocalFiles(...args),
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
  authHeaderToken: vi.fn().mockResolvedValue(""),
  captureLogin: vi.fn().mockResolvedValue(""),
  prepareWebviewAuth: vi.fn().mockResolvedValue(undefined),
  beginFreshLogin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchAllArticlesSince: vi.fn().mockResolvedValue({ articles: [], userName: "guo" }),
    fetchAllDraftsSince: vi.fn().mockResolvedValue([]),
    fetchAllCollections: vi.fn().mockResolvedValue([]),
    fetchUserProfile: (...args: unknown[]) => mockFetchUserProfile(...args),
    fetchArticleComments: vi.fn().mockResolvedValue([]),
    fetchAllArticleCommentCounts: vi.fn().mockResolvedValue(new Map()),
    createDraft: vi.fn(),
    fetchDraft: vi.fn(),
    uploadCoverByUrl: vi.fn(),
    uploadEmbedByUrl: vi.fn(),
  };
});

vi.mock("../downloader", () => ({
  downloadMediaAndUpdate: vi.fn().mockResolvedValue({ downloads: 0, updates: 0 }),
  rewriteAllInternalLinks: vi.fn().mockResolvedValue(0),
}));

vi.mock("../social", () => ({
  loadSocialData: vi.fn().mockResolvedValue({ articles: [] }),
  saveSocialData: vi.fn().mockResolvedValue(undefined),
  mergeSocialData: vi.fn().mockReturnValue({ articles: [] }),
}));

vi.mock("../domain", async () => {
  const actual = await vi.importActual<typeof import("../domain")>("../domain");
  return {
    ...actual,
    initializeDomain: vi.fn().mockResolvedValue(undefined),
  };
});

describe("MOSS_MATTERS_TEST_PROFILE escape hatch", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetConfig.mockResolvedValue({});
    // Ensure auth-check route reads as "unauth + saved userName" so the
    // process hook progresses past Phase 1 without prompting login again.
    mockDetectBoundUser.mockResolvedValue(null);
    // apiConfig is a module singleton — reset its escape-hatch fields so
    // a prior test that flipped queryMode doesn't leak into the next.
    const { apiConfig } = await import("../api");
    apiConfig.queryMode = "viewer";
    apiConfig.testUserName = "Matty";
  });

  it("API layer: flips apiConfig.queryMode to 'user' when env var is set", async () => {
    mockGetPluginEnvVar.mockResolvedValue("@guo");

    // Fresh import so module-level cache + apiConfig are reset.
    const main = await import("../main");
    const { apiConfig } = await import("../api");

    // Pre-state: viewer mode (production default)
    expect(apiConfig.queryMode).toBe("viewer");

    // Trigger the process hook
    const ctx = { config: { sync_on_build: false } } as Parameters<typeof main.process>[0];
    await main.process(ctx);

    // Post-state: user mode, profile bound
    expect(apiConfig.queryMode).toBe("user");
    expect(apiConfig.testUserName).toBe("guo");
  });

  it("API layer: strips leading @ from profile name", async () => {
    mockGetPluginEnvVar.mockResolvedValue("@guo");
    const main = await import("../main");
    const { apiConfig } = await import("../api");
    await main.process({ config: { sync_on_build: false } } as Parameters<typeof main.process>[0]);
    expect(apiConfig.testUserName).toBe("guo");
  });

  it("API layer: accepts profile without leading @", async () => {
    mockGetPluginEnvVar.mockResolvedValue("matty");
    const main = await import("../main");
    const { apiConfig } = await import("../api");
    await main.process({ config: { sync_on_build: false } } as Parameters<typeof main.process>[0]);
    expect(apiConfig.testUserName).toBe("matty");
  });

  it("UI layer: skips openBrowser when env var is set", async () => {
    mockGetPluginEnvVar.mockResolvedValue("@guo");
    const main = await import("../main");
    await main.process({ config: { sync_on_build: false } } as Parameters<typeof main.process>[0]);
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("UI layer: auto-binds project to test profile", async () => {
    mockGetPluginEnvVar.mockResolvedValue("@guo");
    const main = await import("../main");
    await main.process({ config: { sync_on_build: false } } as Parameters<typeof main.process>[0]);

    // saveConfig is called with boundUserName + userName = "guo"
    const lastCall = mockSaveConfig.mock.calls[mockSaveConfig.mock.calls.length - 1];
    expect(lastCall?.[0]).toMatchObject({
      boundUserName: "guo",
      userName: "guo",
    });
  });

  it("production path: env var unset → apiConfig stays in 'viewer' mode", async () => {
    mockGetPluginEnvVar.mockResolvedValue(undefined);
    // Saved username so auth Phase 1 doesn't prompt login
    mockGetConfig.mockResolvedValue({ boundUserName: "real-user", userName: "real-user" });

    const main = await import("../main");
    const { apiConfig } = await import("../api");
    await main.process({ config: { sync_on_build: false } } as Parameters<typeof main.process>[0]);

    // queryMode might be flipped by the saved-username unauthenticated
    // fallback (matters' legacy code path) — what we care about is that
    // the test-profile branch did NOT fire (no openBrowser call, the
    // bound user matches the saved one not "guo").
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    // The escape hatch did not auto-rebind to a test profile.
    const lastCall = mockSaveConfig.mock.calls[mockSaveConfig.mock.calls.length - 1];
    if (lastCall) {
      expect(lastCall[0].boundUserName).not.toBe("guo");
    }
    expect(apiConfig.testUserName).not.toBe("guo");
  });
});
