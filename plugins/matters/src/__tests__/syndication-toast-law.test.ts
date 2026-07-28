/**
 * Law invariants for the Matters syndication toast migration.
 *
 * These tests assert that the syndication path respects the feedback
 * design system: chatty per-step toasts → L1 PanelTask signals;
 * only one terminal L3 ack per run; errors/waits never auto-fade.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ArticleInfo, SyndicateContext } from "../types";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockShowToast = vi.fn().mockResolvedValue(undefined);
const mockDismissToast = vi.fn().mockResolvedValue(undefined);
const mockTaskProgress = vi.fn().mockResolvedValue(undefined);
const mockTaskAwaiting = vi.fn().mockResolvedValue(undefined);
const mockTaskAdvise = vi.fn().mockResolvedValue(undefined);
const mockTaskSucceeded = vi.fn().mockResolvedValue(undefined);
const mockTaskFailed = vi.fn().mockResolvedValue(undefined);
const mockTaskCancelled = vi.fn().mockResolvedValue(undefined);
const mockStartTask = vi.fn().mockResolvedValue({
  id: "42",
  progress: mockTaskProgress,
  awaiting: mockTaskAwaiting,
  advise: mockTaskAdvise,
  succeeded: mockTaskSucceeded,
  failed: mockTaskFailed,
  cancelled: mockTaskCancelled,
});

// mockOpenBrowser is reset per test to control whether the "browser" ever
// closes. For tests where fetchDraft returns published, we use a never-
// resolving handle (the publish poll exits via draft.article). For tests
// where fetchDraft stays unpublished (timeout path), we use an immediately-
// resolving handle so the browser-close branch exits the poll loop before it
// runs for the full 600s of Date.now()-based wall-clock time (sleep is mocked
// to no-op, making a tight busy loop that OOMs otherwise).
const mockOpenBrowser = vi.fn().mockResolvedValue({ closed: new Promise<void>(() => {}) });

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  httpGet: vi.fn(),
  fetchUrl: vi.fn(),
  downloadAsset: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: (...args: unknown[]) => mockShowToast(...args),
  dismissToast: (...args: unknown[]) => mockDismissToast(...args),
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn().mockResolvedValue("{}"),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn().mockResolvedValue(false),
  // REQUIRED: syndicate() calls applyTestProfileEscapeHatch() which calls
  // getPluginEnvVar('MOSS_MATTERS_TEST_PROFILE'). Without this mock the
  // test throws 'getPluginEnvVar is not a function' before reaching any
  // toast assertion.
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  startTask: (...args: unknown[]) => mockStartTask(...args),
  // REQUIRED: utils.ts calls setMessageContext at module load time.
  // Without this mock the worker crashes on import before any test runs.
  setMessageContext: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  reportComplete: vi.fn().mockResolvedValue(undefined),
  emitEvent: vi.fn().mockResolvedValue(undefined),
  // R7: waitForPublishOrClose calls onEvent('browser-url-changed').
  // Without this mock the rewritten function throws on import.
  // Returns a no-op unlisten function; the URL path is never exercised in
  // these law tests (browser-close / poll are the drivers here).
  onEvent: vi.fn().mockResolvedValue(vi.fn()),
  // clearPluginCookies — called by promptLogin() before opening the browser.
  clearPluginCookies: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config", () => ({
  getConfig: vi.fn().mockResolvedValue({ userName: "guo" }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../credential", () => ({
  clearTokenCache: vi.fn(),
  loadStoredToken: vi.fn().mockResolvedValue(null),
  saveStoredToken: vi.fn().mockResolvedValue(undefined),
  clearStoredToken: vi.fn().mockResolvedValue(undefined),
  getSessionState: vi.fn().mockResolvedValue("valid"),
  shouldNudgeSessionExpired: vi.fn().mockResolvedValue(false),
  markSessionInvalidated: vi.fn().mockResolvedValue(undefined),
  authHeaderToken: vi.fn().mockResolvedValue("tok"),
  captureLogin: vi.fn().mockResolvedValue("tok"),
  prepareWebviewAuth: vi.fn().mockResolvedValue(undefined),
  beginFreshLogin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api", () => ({
  createDraft: vi.fn().mockResolvedValue({
    id: "d1",
    title: "Post",
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    publishState: "unpublished",
    article: { id: "a1", shortHash: "abc", slug: "post" }, // immediately published
  }),
  fetchDraft: vi.fn().mockResolvedValue({
    id: "d1",
    title: "Post",
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    publishState: "published",
    article: { id: "a1", shortHash: "abc", slug: "post" },
  }),
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUnsyncedArticle(overrides: Partial<ArticleInfo> = {}): ArticleInfo {
  return {
    source_path: "posts/test.md",
    title: "Test Article",
    content: "# Test\n\nBody.",
    frontmatter: {},           // no `syndicated:` key → will be queued
    url_path: "posts/test/",
    tags: [],
    ...overrides,
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

function restartMockTask() {
  mockStartTask.mockResolvedValue({
    id: "42",
    progress: mockTaskProgress,
    awaiting: mockTaskAwaiting,
    advise: mockTaskAdvise,
    succeeded: mockTaskSucceeded,
    failed: mockTaskFailed,
    cancelled: mockTaskCancelled,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

import { syndicate } from "../main";
import { fetchDraft } from "../api";
import { getSessionState } from "../credential";

/**
 * Shared "happy path" setup: fetchDraft returns published draft.
 * Used by every describe block that tests the published/success path.
 *
 * CRITICAL: vi.clearAllMocks() in beforeEach does NOT reset mock implementations
 * set by mockResolvedValue() — only mock call history. Any describe block that
 * changes fetchDraft to "unpublished" (Law 2 timeout tests) must explicitly
 * restore it here to avoid leaking the unpublished mock into later tests.
 * Without this reset, "Law 3" tests would get an unpublished fetchDraft mock
 * combined with a never-resolving openBrowser.closed promise, causing a
 * tight waitForPublishOrClose busy-loop that runs for 600 real seconds and OOMs.
 */
function resetFetchDraftToPublished() {
  vi.mocked(fetchDraft).mockResolvedValue({
    id: "d1",
    title: "Post",
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    publishState: "published",
    article: { id: "a1", shortHash: "abc", slug: "post" },
  } as never);
}

/**
 * vi.clearAllMocks() clears call history but NOT mockResolvedValue
 * implementations, so a "Law 2 login-required" test that sets
 * getSessionState → 'expired' leaks that into any later describe block that
 * assumes the default 'valid' session. The "Law 3 — exactly ONE showToast"
 * assertion is the canary: a leaked 'expired' adds a login-required toast and
 * the count becomes 2. Reset defensively in every block that relies on the
 * default valid session, mirroring resetFetchDraftToPublished().
 */
function resetGetSessionStateToValid() {
  vi.mocked(getSessionState).mockResolvedValue("valid" as never);
}

describe("Law 1 — no chatty per-step toasts during syndication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartMockTask();
    resetFetchDraftToPublished();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does NOT emit 'Starting Matters syndication...' toast (line 894 deleted)", async () => {
    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);
    const startingMsg = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("Starting Matters syndication"),
    );
    expect(startingMsg).toBeUndefined();
  });

  it("does NOT emit 'Creating draft:' toast per article (line 1080 deleted)", async () => {
    const ctx = makeSyndicateContext([
      makeUnsyncedArticle({ title: "Alpha" }),
      makeUnsyncedArticle({ title: "Beta", source_path: "posts/beta.md", url_path: "posts/beta/" }),
    ]);
    await syndicate(ctx);
    const creatingCalls = mockShowToast.mock.calls.filter(
      ([opts]: [{ message: string }]) => opts.message?.startsWith("Creating draft:"),
    );
    expect(creatingCalls).toHaveLength(0);
  });

  it("does NOT emit 'Draft created!' toast per article (line 1186 replaced by task.awaiting)", async () => {
    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);
    const draftCreatedCalls = mockShowToast.mock.calls.filter(
      ([opts]: [{ message: string }]) => opts.message?.includes("Draft created"),
    );
    expect(draftCreatedCalls).toHaveLength(0);
  });

  it("does NOT emit 'Published to Matters!' per article (N → 1 terminal ack)", async () => {
    const ctx = makeSyndicateContext([
      makeUnsyncedArticle({ title: "Alpha" }),
      makeUnsyncedArticle({ title: "Beta", source_path: "posts/beta.md", url_path: "posts/beta/" }),
    ]);
    await syndicate(ctx);
    const publishedCalls = mockShowToast.mock.calls.filter(
      ([opts]: [{ message: string }]) => opts.message === "Published to Matters!",
    );
    expect(publishedCalls).toHaveLength(0);
  });
});

describe("Law 1 — task.awaiting() replaces 'Draft created!' toast, fires AFTER browser opens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartMockTask();
    resetFetchDraftToPublished();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls task.awaiting with 'publish the draft' directive and 'cancel' escape", async () => {
    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);
    expect(mockTaskAwaiting).toHaveBeenCalledWith(
      "publish the draft",
      "Matters editor",
      "cancel",
    );
  });
});

describe("Law 2 — draft-timeout becomes a NeedsAction advisory with a link (not a toast)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartMockTask();
    // For the "timeout" path: fetchDraft returns NOT published.
    // The poll loop in waitForPublishOrClose would run for 600 real seconds
    // (sleep is no-op so Date.now() advances in real time) — that OOMs.
    // Fix: make the browser "close" immediately so the browserClosed branch
    // exits the loop after the first sleep. The article then returns null
    // (browser-close path) which lands us at the same draft-saved code path
    // as a wall-clock timeout.
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore default (never-resolving) for other test groups.
    mockOpenBrowser.mockResolvedValue({ closed: new Promise<void>(() => {}) });
  });

  it("does NOT emit 'Draft saved - publish when ready' toast on timeout", async () => {
    const { fetchDraft } = await import("../api");
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    const ctx = makeSyndicateContext([makeUnsyncedArticle({ source_path: "posts/alpha.md" })]);
    await syndicate(ctx);

    const timeoutToast = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("Draft saved"),
    );
    expect(timeoutToast).toBeUndefined();
  });

  it("files a NeedsAction task advisory with Link action on timeout", async () => {
    const { fetchDraft } = await import("../api");
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    const ctx = makeSyndicateContext([makeUnsyncedArticle({ source_path: "posts/alpha.md" })]);
    await syndicate(ctx);

    // advise() accumulates on the handle; it flushes at task.succeeded() after
    // the loop, not at the per-article return. The SDK buffers advisories.
    const adviseCalls = mockTaskAdvise.mock.calls;
    const timeoutAdvisory = adviseCalls.find(
      ([adv]: [{ severity: string; action: unknown }]) =>
        adv.severity === "NeedsAction" &&
        typeof (adv.action as { Link?: unknown })?.Link === "object",
    );
    expect(timeoutAdvisory).toBeDefined();
    const adv = timeoutAdvisory![0] as {
      scope: string;
      severity: string;
      what: string;
      action: { Link: { href: string; label: string } };
    };
    expect(adv.scope).toBe("Remote");
    expect(adv.what).toContain("Draft saved");
    expect(adv.action.Link.href).toContain("matters.town/drafts");
    expect(adv.action.Link.label).toBe("Open draft");
  });

  it("Law 2b — #808: timed-out/closed draft (published=0, draftsCreated=1) fires NO success toast and task.succeeded receives 0", async () => {
    // Regression guard for #808: a draft that was created but never published
    // (user closed the browser / timed out) must NOT count as a syndication
    // success. syndicatedCount MUST be 0, not 1.
    const { fetchDraft } = await import("../api");
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    const ctx = makeSyndicateContext([makeUnsyncedArticle({ source_path: "posts/alpha.md" })]);
    await syndicate(ctx);

    // No success toast should fire when nothing was actually published.
    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Syndicated \d+ article/) }),
    );
    // task.succeeded is still called (the run itself succeeded), but MUST
    // receive 0 — not the draftsCreated count. Calling with (undefined, 0)
    // means "completed with zero syndicated", which is correct.
    expect(mockTaskSucceeded).toHaveBeenCalledWith(undefined, 0);
    // The NeedsAction advisory IS still filed (existing Law 2 assertions above cover this).
  });

  it("Law 2c — #808 mixed-batch: 1 published + 1 timed-out → toast 'Syndicated 1 article', task.succeeded receives 1", async () => {
    // Two articles: article-1 is published (fetchDraft poll returns article non-null),
    // article-2 times out (browser closes before the poll can confirm, article null).
    // Expected: syndicatedCount = 1, toast matches /Syndicated 1 article/ (NOT "Syndicated 2").
    //
    // NOTE on waitForPublishOrClose mechanics: when `closed` is already resolved,
    // the browser-close branch fires AFTER the first `sleep()` (via microtask), so
    // `fetchDraft` is never called inside the poll loop — the function returns null.
    // For article-1 to register as published, `closed` must NOT resolve before
    // `fetchDraft` is polled → use a never-resolving promise so the poll runs once.
    // For article-2 (timeout path) `closed` resolves immediately → loop exits null.
    const { fetchDraft } = await import("../api");
    vi.mocked(fetchDraft)
      .mockResolvedValueOnce({
        id: "d1",
        title: "Post One",
        content: "",
        createdAt: "2026-01-01T00:00:00Z",
        publishState: "published",
        article: { id: "a1", shortHash: "abc", slug: "post-one" },
      } as never)
      .mockResolvedValueOnce({
        id: "d2",
        title: "Post Two",
        content: "",
        createdAt: "2026-01-01T00:00:00Z",
        publishState: "unpublished",
        article: null,
      } as never);

    // Article-1: never-resolving closed → poll fires → fetchDraft[0] returns published.
    // Article-2: immediately-resolving closed → browser-close branch exits → null.
    mockOpenBrowser
      .mockResolvedValueOnce({ closed: new Promise<void>(() => {}) })
      .mockResolvedValueOnce({ closed: Promise.resolve() });

    const ctx = makeSyndicateContext([
      makeUnsyncedArticle({ title: "Post One", source_path: "posts/post-one.md", url_path: "posts/post-one/" }),
      makeUnsyncedArticle({ title: "Post Two", source_path: "posts/post-two.md", url_path: "posts/post-two/" }),
    ]);
    await syndicate(ctx);

    // Must fire exactly one success toast matching "Syndicated 1 article" (not "2 articles").
    const successToastCalls = mockShowToast.mock.calls.filter(
      ([opts]: [{ variant?: string }]) => opts.variant === "success",
    );
    expect(successToastCalls).toHaveLength(1);
    const [[opts]] = successToastCalls as [[{ message: string; variant: string }]];
    expect(opts.message).toMatch(/Syndicated 1 article/);
    expect(opts.message).not.toMatch(/Syndicated 2/);

    // task.succeeded must receive exactly 1.
    expect(mockTaskSucceeded).toHaveBeenCalledWith(undefined, 1);
  });

  it("prepareWebviewAuth is called BEFORE the draft-room openBrowser on the unpublished-draft path", async () => {
    // Drive the unpublished-draft → browser-close path so openBrowser(draftPageUrl) is reached.
    // createDraft returns unpublished (no article); browser closes immediately.
    const { fetchDraft: fd, createDraft } = await import("../api");
    vi.mocked(createDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);
    vi.mocked(fd).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);
    // Browser closes immediately → waitForPublishOrClose exits null.
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });

    const { prepareWebviewAuth } = await import("../credential");

    const ctx = makeSyndicateContext([makeUnsyncedArticle({ source_path: "posts/alpha.md" })]);
    await syndicate(ctx);

    // prepareWebviewAuth must have been called and must precede openBrowser(draftPageUrl).
    expect(vi.mocked(prepareWebviewAuth)).toHaveBeenCalled();
    expect(mockOpenBrowser).toHaveBeenCalled();

    const prepareOrder = vi.mocked(prepareWebviewAuth).mock.invocationCallOrder[0];
    // The last openBrowser call is the draft-room one (first invocation index).
    const openBrowserOrder = mockOpenBrowser.mock.invocationCallOrder.at(-1)!;
    expect(prepareOrder).toBeLessThan(openBrowserOrder);
  });
});

describe("Law 3 — one terminal L3 ack after the loop (not per article)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartMockTask();
    resetFetchDraftToPublished(); // MUST reset: Law 2 timeout tests set fetchDraft to unpublished
    resetGetSessionStateToValid(); // MUST reset: Law 2 login tests set getSessionState to 'expired' (would add a 2nd toast)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits exactly ONE showToast call per syndication run (the terminal ack)", async () => {
    const ctx = makeSyndicateContext([
      makeUnsyncedArticle({ title: "Alpha" }),
      makeUnsyncedArticle({ title: "Beta", source_path: "posts/beta.md", url_path: "posts/beta/" }),
    ]);
    await syndicate(ctx);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [[opts]] = mockShowToast.mock.calls as [[{ message: string; variant: string; persistent?: boolean; actions?: Array<{url: string}> }]];
    expect(opts.message).toMatch(/Syndicated.*Matters/);
    expect(opts.variant).toBe("success");
  });

  it("terminal ack is persistent (explicit persistent:true, never a finite duration)", async () => {
    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);
    const [[opts]] = mockShowToast.mock.calls as [[{ persistent?: boolean }]];
    // Must explicitly set persistent:true — do not rely on 'no duration' as a proxy
    expect(opts.persistent).toBe(true);
  });

  it("terminal ack includes a 'View profile' action link", async () => {
    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);
    const [[opts]] = mockShowToast.mock.calls as [[{ actions?: Array<{url: string; label: string}> }]];
    expect(opts.actions).toBeDefined();
    expect(opts.actions![0].url).toContain("matters.town");
    expect(opts.actions![0].label).toMatch(/[Pp]rofile|[Vv]iew/);
  });
});

describe("Law 2 — login-required toast is persistent and dismissed after successful login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartMockTask();
    resetFetchDraftToPublished(); // MUST reset: Law 2 timeout tests set fetchDraft to unpublished
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login-required showToast uses persistent:true (not duration:5000)", async () => {
    // Trigger the login-required path: session is not valid
    vi.mocked(getSessionState).mockResolvedValue("expired" as never);
    // promptLogin succeeds (login success path)
    // We'll let the mock login succeed by stubbing promptLogin's browser path:
    // openBrowser mock already returns a resolved handle; getAccessToken mock
    // returns a token, which is the promptLogin success signal.

    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);

    const loginRequiredCall = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("login required"),
    );
    expect(loginRequiredCall).toBeDefined();
    const [opts] = loginRequiredCall! as [{ duration?: number; persistent?: boolean; id?: string }];
    expect(opts.duration).toBeUndefined();
    expect(opts.persistent).toBe(true);
    expect(opts.id).toBe("matters-login-required");
  });

  it("dismisses login-required toast after successful login", async () => {
    vi.mocked(getSessionState).mockResolvedValue("expired" as never);

    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);

    // After successful login, dismissToast must be called with the toast id
    expect(mockDismissToast).toHaveBeenCalledWith("matters-login-required");
  });
});

describe("Law 2 — session-expired toast is persistent (not duration: 8000)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartMockTask();
    resetFetchDraftToPublished();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("session-expired showToast has persistent:true, no duration field", async () => {
    // Drive the expired path via a MattersAuthError in the per-article loop.
    // notifySessionExpired() is called from the outer catch when shouldNudge=true.
    const { MattersAuthError, createDraft } = await import("../api");
    const { shouldNudgeSessionExpired } = await import("../credential");
    vi.mocked(shouldNudgeSessionExpired).mockResolvedValue(true);
    vi.mocked(createDraft).mockRejectedValue(
      new (MattersAuthError as new (code: string, msg: string) => Error)("TOKEN_INVALID", "rejected"),
    );

    const ctx = makeSyndicateContext([makeUnsyncedArticle()]);
    await syndicate(ctx);

    const expiredCall = mockShowToast.mock.calls.find(
      ([opts]: [{ message: string }]) => opts.message?.includes("session expired"),
    );
    expect(expiredCall).toBeDefined();
    const [opts] = expiredCall! as [{ duration?: number; persistent?: boolean }];
    // Law 2: must NOT have a finite duration
    expect(opts.duration).toBeUndefined();
    // Law 2: MUST be persistent
    expect(opts.persistent).toBe(true);
  });
});
