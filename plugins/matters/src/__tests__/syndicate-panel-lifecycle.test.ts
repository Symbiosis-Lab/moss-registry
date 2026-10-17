/**
 * The Matters panel stays up from the start of syndicate until the draft
 * navigates it: loading first, then the login page, back to loading on
 * success, then the draft. Asserted through the openBrowser / closeBrowser
 * call order, which is all the plugin does to the panel.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openBrowser, closeBrowser } from "@symbiosis-lab/moss-api";
import type { ArticleInfo, ProcessContext, SyndicateContext } from "../types";

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  httpGet: vi.fn(),
  fetchUrl: vi.fn(),
  downloadAsset: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: vi.fn().mockResolvedValue(undefined),
  dismissToast: vi.fn().mockResolvedValue(undefined),
  openBrowser: vi.fn().mockResolvedValue({ closed: new Promise<void>(() => {}) }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn().mockResolvedValue("{}"),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn().mockResolvedValue(false),
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  startTask: vi.fn().mockResolvedValue({
    id: "42",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: vi.fn().mockResolvedValue(undefined),
    advise: vi.fn().mockResolvedValue(undefined),
    succeeded: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
    cancelled: vi.fn().mockResolvedValue(undefined),
  }),
  setMessageContext: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  emitEvent: vi.fn().mockResolvedValue(undefined),
  onEvent: vi.fn().mockResolvedValue(vi.fn()),
  clearPluginCookies: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config", () => ({
  getConfig: vi.fn().mockResolvedValue({ userName: "guo" }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../credential", () => ({
  clearTokenCache: vi.fn(),
  bindStoredToken: vi.fn().mockResolvedValue(undefined),
  getSessionState: vi.fn().mockResolvedValue("valid"),
  shouldNudgeSessionExpired: vi.fn().mockResolvedValue(false),
  markSessionInvalidated: vi.fn().mockResolvedValue(undefined),
  authHeaderToken: vi.fn().mockResolvedValue("tok"),
  captureLogin: vi.fn().mockResolvedValue("tok"),
  prepareWebviewAuth: vi.fn().mockResolvedValue(undefined),
  beginFreshLogin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api", () => ({
  createDraft: vi.fn(),
  fetchDraft: vi.fn(),
  uploadCoverByUrl: vi.fn().mockResolvedValue("asset-1"),
  uploadEmbedByUrl: vi.fn().mockResolvedValue("https://cdn/img.jpg"),
  fetchUserProfile: vi.fn().mockResolvedValue({ userName: "guo", displayName: "Guo" }),
  fetchAllArticlesSince: vi.fn().mockResolvedValue({ articles: [], userName: "guo" }),
  fetchAllDraftsSince: vi.fn().mockResolvedValue([]),
  fetchAllCollections: vi.fn().mockResolvedValue([]),
  fetchArticleComments: vi.fn().mockResolvedValue({ comments: [], donations: [], appreciations: [] }),
  fetchAllArticleCommentCounts: vi.fn().mockResolvedValue([]),
  MattersAuthError: class MattersAuthError extends Error {},
  apiConfig: { queryMode: "viewer", testUserName: "Matty", endpoint: "https://server.matters.town/graphql" },
}));

vi.mock("../domain", () => ({
  initializeDomain: vi.fn().mockResolvedValue(undefined),
  getDomain: vi.fn().mockReturnValue("matters.town"),
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  draftUrl: vi.fn().mockImplementation((id: string) => `https://matters.town/drafts/${id}`),
  articleUrl: vi.fn().mockImplementation((_u: string, slug: string, hash: string) => `https://matters.town/@guo/${slug}-${hash}`),
  isMattersUrl: vi.fn().mockImplementation((url: string) => url.includes("matters.town")),
}));

vi.mock("../sync", () => ({
  detectBoundUser: vi.fn().mockResolvedValue({ userName: "guo" }),
  syncToLocalFiles: vi.fn().mockResolvedValue({ result: { created: 0, updated: 0, skipped: 0, errors: [] }, articlePathMap: new Map() }),
  scanLocalArticles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../utils", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../converter", () => ({
  parseFrontmatter: vi.fn().mockReturnValue(null),
  regenerateFrontmatter: vi.fn().mockReturnValue(""),
}));

vi.mock("../progress", () => ({
  overallProgress: vi.fn().mockReturnValue(50),
}));

vi.mock("../social", () => ({
  loadSocialData: vi.fn().mockResolvedValue({ articles: {} }),
  saveSocialData: vi.fn().mockResolvedValue(undefined),
  mergeSocialData: vi.fn().mockReturnValue({ articles: {} }),
  reconcileLegacySocialData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../downloader", () => ({
  downloadMediaAndUpdate: vi.fn().mockResolvedValue(undefined),
  rewriteAllInternalLinks: vi.fn().mockResolvedValue({ linksRewritten: 0 }),
}));

vi.mock("../auth-route", () => ({
  resolveAuthRoute: vi.fn().mockResolvedValue({ kind: "skip" }),
  isUserPresent: vi.fn().mockResolvedValue(true),
}));

import { login, syndicate } from "../main";
import { createDraft, fetchDraft } from "../api";
import { captureLogin, getSessionState } from "../credential";

function makeUnsyncedArticle(): ArticleInfo {
  return {
    source_path: "posts/test.md",
    title: "Test Article",
    content: "# Test\n\nBody.",
    frontmatter: {},
    url_path: "posts/test/",
    tags: [],
  };
}

function makeSyndicateContext(articles: ArticleInfo[]): SyndicateContext {
  return {
    deployment: { url: "https://example.com", deployed_at: "2026-06-14T00:00:00Z" },
    articles,
    config: {},
    project_info: { folder_name: "test", homepage_file: null, lang: "en" },
  } as unknown as SyndicateContext;
}

const LOGIN_URL = "https://matters.town/login";
const DRAFT_URL = "https://matters.town/drafts/d1";

/** The url each openBrowser call carried, null for a loading open. */
function openedUrls(): (string | null)[] {
  return vi.mocked(openBrowser).mock.calls.map(([url]) => url ?? null);
}

describe("Matters panel stays up from syndicate start to the draft", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: { id: "a1", shortHash: "abc", slug: "post" },
    } as never);
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "published",
      article: { id: "a1", shortHash: "abc", slug: "post" },
    } as never);
    vi.mocked(getSessionState).mockResolvedValue("valid" as never);
    vi.mocked(captureLogin).mockResolvedValue("tok" as never);
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logged in: the loading panel opens before the first network call, then the draft navigates it", async () => {
    await syndicate(makeSyndicateContext([makeUnsyncedArticle()]));

    expect(openedUrls()).toEqual([null, DRAFT_URL]);
    const loadingOrder = vi.mocked(openBrowser).mock.invocationCallOrder[0];
    expect(loadingOrder).toBeLessThan(mockFetch.mock.invocationCallOrder[0]);
    const draftOrder = vi.mocked(openBrowser).mock.invocationCallOrder[1];
    const closesBeforeDraft = vi
      .mocked(closeBrowser)
      .mock.invocationCallOrder.filter((order) => order > loadingOrder && order < draftOrder);
    expect(closesBeforeDraft).toEqual([]);
  });

  it("logged out: loading, then the login page, then loading again on success, then the draft; no close in between", async () => {
    vi.mocked(getSessionState).mockResolvedValue("expired" as never);
    // The first token poll finds nothing; the second finds the token that login wrote.
    vi.mocked(captureLogin).mockResolvedValueOnce(null as never);

    await syndicate(makeSyndicateContext([makeUnsyncedArticle()]));

    expect(openedUrls()).toEqual([null, LOGIN_URL, null, DRAFT_URL]);
    const draftOrder = vi.mocked(openBrowser).mock.invocationCallOrder[3];
    const closesBeforeDraft = vi
      .mocked(closeBrowser)
      .mock.invocationCallOrder.filter((order) => order < draftOrder);
    expect(closesBeforeDraft).toEqual([]);
  });

  it("a second article reopens the loading panel before its first network call, after the first draft closed it", async () => {
    const second: ArticleInfo = {
      ...makeUnsyncedArticle(),
      title: "Second Article",
      source_path: "posts/second.md",
      url_path: "posts/second/",
    };

    await syndicate(makeSyndicateContext([makeUnsyncedArticle(), second]));

    expect(openedUrls()).toEqual([null, DRAFT_URL, null, DRAFT_URL]);
    const secondLoadingOrder = vi.mocked(openBrowser).mock.invocationCallOrder[2];
    const secondFetchOrder = mockFetch.mock.invocationCallOrder[1];
    expect(secondLoadingOrder).toBeLessThan(secondFetchOrder);
  });

  it("an error after the loading panel opened closes the panel exactly once and opens no draft", async () => {
    vi.mocked(createDraft).mockRejectedValueOnce(new Error("boom"));

    await syndicate(makeSyndicateContext([makeUnsyncedArticle()]));

    expect(openedUrls()).toEqual([null]);
    expect(vi.mocked(closeBrowser)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(closeBrowser).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(openBrowser).mock.invocationCallOrder[0],
    );
  });

  it("a non-syndicate login caller (the login hook) still closes the panel after login", async () => {
    vi.mocked(captureLogin).mockResolvedValueOnce(null as never);

    const result = await login({ trigger: "manual" } as unknown as ProcessContext);

    expect(result.success).toBe(true);
    expect(openedUrls()).toEqual([LOGIN_URL]);
    expect(vi.mocked(closeBrowser)).toHaveBeenCalledTimes(1);
  });
});
