/**
 * Task 2.3 — auto-detect tests for waitForPublishOrClose.
 *
 * These tests verify that a `browser-url-changed` event to a published-looking
 * URL triggers an immediate fetchDraft verify. The URL-triggered path resolves
 * the wait (poll is the fallback) — with `sleep` mocked, both paths are instant.
 *
 * Also verifies the negative case: a URL that doesn't look like a published
 * article (or an article URL the API does NOT confirm) must NOT resolve.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Capture the listener registered by onEvent so tests can invoke it directly
let capturedUrlListener: ((payload: { url: string }) => void) | null = null;

// The mock returns an unlisten function (vi.fn). We capture the registered
// callback so emitBrowserUrlChanged can invoke it in tests.
const mockUnlistenUrl = vi.fn();

const mockOnEvent = vi.fn().mockImplementation(
  (eventName: string, cb: (payload: { url: string }) => void) => {
    if (eventName === "browser-url-changed") {
      capturedUrlListener = cb;
    }
    return Promise.resolve(mockUnlistenUrl);
  }
);

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
  // Never-resolving browser handle by default (poll-driven path)
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
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  reportComplete: vi.fn().mockResolvedValue(undefined),
  emitEvent: vi.fn().mockResolvedValue(undefined),
  // R7: onEvent mock that captures the callback for emitBrowserUrlChanged
  onEvent: (...args: unknown[]) => mockOnEvent(...args),
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
    article: null,
  }),
  fetchDraft: vi.fn().mockResolvedValue({
    id: "d1",
    title: "Post",
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    publishState: "published",
    article: { id: "a1", shortHash: "a1b2c3", slug: "post" },
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

// ── Test helper ───────────────────────────────────────────────────────────────

/**
 * Simulates a browser-url-changed event reaching the plugin listener.
 * Invokes the captured callback and flushes microtasks so the async
 * fetchDraft inside the listener has time to resolve.
 */
async function emitBrowserUrlChanged(url: string): Promise<void> {
  if (!capturedUrlListener) {
    throw new Error("No URL listener registered — is waitForPublishOrClose wired up?");
  }
  capturedUrlListener({ url });
  // Flush pending microtasks (the fetchDraft await inside the listener)
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

import { waitForPublishOrClose } from "../main";
import { fetchDraft } from "../api";
import { emitEvent, closeBrowser } from "@symbiosis-lab/moss-api";

beforeEach(() => {
  vi.clearAllMocks();
  capturedUrlListener = null;
  // Restore default onEvent implementation after clearAllMocks wipes it
  mockOnEvent.mockImplementation(
    (eventName: string, cb: (payload: { url: string }) => void) => {
      if (eventName === "browser-url-changed") {
        capturedUrlListener = cb;
      }
      return Promise.resolve(mockUnlistenUrl);
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waitForPublishOrClose — URL auto-detect (Task 2.3)", () => {
  it("resolves with published article when browser-url-changed fires a published URL and API confirms", async () => {
    // API confirms the article was published
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "published",
      article: { id: "a1", shortHash: "a1b2c3", slug: "post" },
    } as never);

    // Start waiting. The URL-triggered path resolves the wait; the poll is the
    // fallback (both instant here because sleep is mocked).
    const browserHandle = { closed: new Promise<void>(() => {}) };
    const p = waitForPublishOrClose("d1", browserHandle);

    // Give the function time to register the onEvent listener
    await Promise.resolve();
    await Promise.resolve();

    // Trigger the URL change event with a valid published-article URL
    await emitBrowserUrlChanged("https://matters.town/@guo/post-a1b2c3");

    // URL-triggered path resolves the wait (poll is the fallback)
    await expect(p).resolves.toEqual({ shortHash: "a1b2c3", slug: "post" });
  });

  it("does NOT resolve when browser-url-changed fires a non-article URL", async () => {
    // API returns null (publish not confirmed)
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    // Browser closes immediately, so the close branch resolves the wait → null.
    const browserHandle = { closed: Promise.resolve() };
    const p = waitForPublishOrClose("d1", browserHandle);

    await Promise.resolve();
    await Promise.resolve();

    // Fire a non-article URL — should not resolve the promise
    await emitBrowserUrlChanged("https://matters.town/@guo/followers");

    // Resolves null (browser closed, URL didn't trigger a publish)
    await expect(p).resolves.toBeNull();
  });

  it("does NOT resolve when the API returns null even if the URL looks like a published article", async () => {
    // The URL LOOKS like an article but the API does NOT confirm it
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    // Browser closes immediately so we get a null (not stuck waiting)
    const browserHandle = { closed: Promise.resolve() };
    const p = waitForPublishOrClose("d1", browserHandle);

    await Promise.resolve();
    await Promise.resolve();

    // URL looks valid but API doesn't confirm → must NOT resolve as published
    await emitBrowserUrlChanged("https://matters.town/@guo/some-other-post-a1b2c3");

    await expect(p).resolves.toBeNull();
  });

  it("cleans up the URL listener (unlisten called) after resolution", async () => {
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "published",
      article: { id: "a1", shortHash: "a1b2c3", slug: "post" },
    } as never);

    const browserHandle = { closed: new Promise<void>(() => {}) };
    const p = waitForPublishOrClose("d1", browserHandle);

    await Promise.resolve();
    await Promise.resolve();
    await emitBrowserUrlChanged("https://matters.town/@guo/post-a1b2c3");
    await p;

    // The unlisten function returned by onEvent must have been called
    expect(mockUnlistenUrl).toHaveBeenCalled();
  });

  it("leaked-listener race: URL event fired after close-before-unlisten does NOT call fetchDraft again", async () => {
    // Arrange: API confirms unpublished (so only the close branch can settle null)
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    // browserHandle.closed is already-resolved → settle(null) fires synchronously
    // in the next microtask, before the onEvent .then() storing unlistenUrl runs.
    const browserHandle = { closed: Promise.resolve() };
    const p = waitForPublishOrClose("d1", browserHandle);

    // Drain microtasks so settle(null) fires (browser close branch)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Wait should already be resolved as null
    await expect(p).resolves.toBeNull();

    // Record how many times fetchDraft was called up to this point
    const callsBefore = vi.mocked(fetchDraft).mock.calls.length;

    // Now simulate the leaked listener firing (as if unlisten hadn't run yet)
    // capturedUrlListener may or may not be set depending on microtask ordering;
    // if it is set, the callback must short-circuit on `settled` and not call fetchDraft.
    if (capturedUrlListener) {
      capturedUrlListener({ url: "https://matters.town/@guo/post-a1b2c3" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    // fetchDraft must NOT have been called an additional time
    expect(vi.mocked(fetchDraft).mock.calls.length).toBe(callsBefore);
  });
});

// ── R19 — Held confirmation beat ──────────────────────────────────────────────

describe("R19 — matters-room-published emitted before closeBrowser on confirmed publish", () => {
  it("emits matters-room-published before calling closeBrowser on the confirmed-publish path", async () => {
    // API confirms the article was published
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "published",
      article: { id: "a1", shortHash: "a1b2c3", slug: "post" },
    } as never);

    // Track call order via an explicit ordering array
    const callOrder: string[] = [];
    vi.mocked(emitEvent).mockImplementation(async (name: string) => {
      callOrder.push(`emit:${name}`);
    });
    vi.mocked(closeBrowser).mockImplementation(async () => {
      callOrder.push("closeBrowser");
    });

    const browserHandle = { closed: new Promise<void>(() => {}) };
    const p = waitForPublishOrClose("d1", browserHandle);

    await Promise.resolve();
    await Promise.resolve();

    // Trigger the URL change — the settle(published) path fires
    await emitBrowserUrlChanged("https://matters.town/@guo/post-a1b2c3");

    // Wait for resolution (sleep is mocked to no-op so the 800ms is instant)
    await p;

    // matters-room-published MUST appear before closeBrowser in the call order
    expect(callOrder).toContain("emit:matters-room-published");
    expect(callOrder).toContain("closeBrowser");
    const publishedIdx = callOrder.indexOf("emit:matters-room-published");
    const closeIdx = callOrder.indexOf("closeBrowser");
    expect(publishedIdx).toBeLessThan(closeIdx);
  });

  it("does NOT emit matters-room-published on the close (null) path", async () => {
    // API never confirms → browser closes → settle(null)
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    const browserHandle = { closed: Promise.resolve() };
    const p = waitForPublishOrClose("d1", browserHandle);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await p;

    // matters-room-published must NOT be emitted on the skip/close path
    const emittedNames = vi.mocked(emitEvent).mock.calls.map((c) => c[0]);
    expect(emittedNames).not.toContain("matters-room-published");
  });
});
