/**
 * Tests for main.ts
 *
 * Covers:
 * - syndicateArticle uploads cover (bytes) when article.frontmatter.cover exists
 * - syndicateArticle skips cover upload when no cover in frontmatter
 * - syndicateArticle continues gracefully when cover upload fails
 * - siteRelativePathFromSrc path resolution and cross-origin/data-uri rejection
 * - imageMimeForPath / audioMimeForPath MIME mapping
 * - normalizeHtmlForMatters heading transformation and image pass-through
 * - addCanonicalLinkToContent with lang parameter
 * - syndicateArticle passing summary and lang
 * - Draft tracking: getDraftMap, saveDraftMap, getDraftId, saveDraftId, removeDraftId
 * - syndicateArticle reusing existing draft
 * - syndicateArticle falling back on API error with stale draft ID
 * - syndicateArticle removing draft on publish
 * - syndicateArticle saving draft on timeout/no-publish
 * - uploadAndReplaceLocalImages byte-upload flow
 * - uploadAndReplaceLocalAudio byte-upload flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArticleInfo } from "../types";

// ============================================================================
// Mocks
// ============================================================================

// Mock @symbiosis-lab/moss-api before importing the modules under test
vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  httpPostMultipart: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readSiteFile: vi.fn(),
  showToast: vi.fn().mockResolvedValue(undefined),
  dismissToast: vi.fn().mockResolvedValue(undefined),
  openBrowser: vi.fn().mockResolvedValue({ closed: new Promise(() => {}) }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  // emitEvent / onEvent used by waitForPublishOrClose (matters-room-published,
  // browser-url-changed). Both must be in the mock or vitest rejects the call.
  emitEvent: vi.fn().mockResolvedValue(undefined),
  onEvent: vi.fn().mockResolvedValue(() => { /* unlisten no-op */ }),
  getPluginEnvVar: vi.fn().mockResolvedValue(null),
  // clearPluginCookies — called by promptLogin() before opening the browser.
  clearPluginCookies: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
  // startTask mock — process hook needs a TaskHandle even when tests
  // only exercise syndicate helpers; keep it a no-op here.
  startTask: vi.fn().mockResolvedValue({
    id: "0",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: vi.fn().mockResolvedValue(undefined),
    advise: vi.fn().mockResolvedValue(undefined),
    succeeded: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
    cancelled: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock the credential module (moved symbols from api.ts)
vi.mock("../credential", () => ({
  clearTokenCache: vi.fn(),
  loadStoredToken: vi.fn().mockResolvedValue(null),
  saveStoredToken: vi.fn().mockResolvedValue(undefined),
  clearStoredToken: vi.fn().mockResolvedValue(undefined),
  getSessionState: vi.fn().mockResolvedValue("valid"),
  shouldNudgeSessionExpired: vi.fn().mockResolvedValue(false),
  markSessionInvalidated: vi.fn().mockResolvedValue(undefined),
  authHeaderToken: vi.fn().mockResolvedValue("test-token"),
  captureLogin: vi.fn().mockResolvedValue("test-token"),
  prepareWebviewAuth: vi.fn().mockResolvedValue(undefined),
  beginFreshLogin: vi.fn().mockResolvedValue(undefined),
}));

// Mock the api module
vi.mock("../api", () => ({
  createDraft: vi.fn(),
  fetchDraft: vi.fn(),
  uploadAssetMultipart: vi.fn(),
  apiConfig: { queryMode: "viewer", testUserName: "Matty", endpoint: "https://server.matters.town/graphql" },
  SINGLE_FILE_UPLOAD_MUTATION: `
mutation SingleFileUpload($input: SingleFileUploadInput!) {
  singleFileUpload(input: $input) { id path }
}
`,
}));

// Mock other modules that main.ts depends on
vi.mock("../config", () => ({
  getConfig: vi.fn().mockResolvedValue({ userName: "testuser" }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../domain", () => ({
  initializeDomain: vi.fn().mockResolvedValue(undefined),
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  draftUrl: vi.fn().mockImplementation((id: string) => `https://matters.town/drafts/${id}`),
  articleUrl: vi.fn().mockImplementation((_user: string, slug: string, hash: string) => `https://matters.town/@testuser/${slug}-${hash}`),
  isMattersUrl: vi.fn().mockImplementation((url: string) => url.includes("matters.town")),
  // scanLocalArticles (in ../sync) resolves extractShortHash from ../domain; this
  // mock must provide it or any future main.ts test reaching scanLocalArticles would
  // call undefined(). Mirror the real /a/ + canonical parsing.
  extractShortHash: vi.fn().mockImplementation((url: string) => {
    try {
      const segments = new URL(url, "https://matters.town").pathname.split("/").filter(Boolean);
      if (segments.length === 0) return null;
      if (segments[0] === "a" && segments.length >= 2) return segments[1] || null;
      const last = segments[segments.length - 1];
      const hyphen = last.lastIndexOf("-");
      return hyphen === -1 ? null : last.substring(hyphen + 1) || null;
    } catch {
      return null;
    }
  }),
}));

vi.mock("../utils", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../converter", () => ({
  parseFrontmatter: vi.fn(),
  regenerateFrontmatter: vi.fn(),
}));

// Now import the modules under test
import {
  syndicateArticle,
  waitForPublishOrClose,
  normalizeHtmlForMatters,
  wrapImagesForMatters,
  wrapAudioForMatters,
  transformMathForMatters,
  stripHeadingAnchors,
  stripArticleTitleH1,
  absolutizeRelativeHrefs,
  addCanonicalLinkToContent,
  uploadAndReplaceLocalImages,
  uploadAndReplaceLocalAudio,
  siteRelativePathFromSrc,
  imageMimeForPath,
  audioMimeForPath,
  getDraftMap,
  saveDraftMap,
  getDraftId,
  saveDraftId,
  removeDraftId,
  type DraftMap,
} from "../main";
import { uploadAssetMultipart, createDraft, fetchDraft, SINGLE_FILE_UPLOAD_MUTATION } from "../api";
import { readSiteFile } from "@symbiosis-lab/moss-api";
import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";

// ============================================================================
// Global setup
// ============================================================================

// `isArticleLive` (called from the syndicate flow) probes the deployed URL with
// fetch. Stub fetch globally so tests don't hit the network.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// Test Helpers
// ============================================================================

function makeArticle(overrides: Partial<ArticleInfo> = {}): ArticleInfo {
  return {
    source_path: "posts/test.md",
    title: "Test Article",
    content: "# Test\n\nContent here.",
    html_content: "<h1>Test</h1><p>Content here.</p>",
    frontmatter: {},
    url_path: "posts/test/",
    date: "2024-01-01",
    tags: ["tag1", "tag2"],
    ...overrides,
  };
}

function makeDraftResponse(id = "draft-123") {
  return {
    id,
    title: "Test Article",
    content: "<h1>Test</h1>",
    createdAt: "2024-01-01T00:00:00Z",
    publishState: "unpublished" as const,
  };
}

function makePublishedDraftResponse(id = "draft-123") {
  return {
    id,
    title: "Test Article",
    content: "<h1>Test</h1>",
    createdAt: "2024-01-01T00:00:00Z",
    publishState: "published" as const,
    article: {
      id: "article-456",
      shortHash: "abc123",
      slug: "test-article",
    },
  };
}

// ============================================================================
// Shared task handle mock for syndicateArticle (Task M-2: threads task into
// syndicateArticle so per-article awaiting + advisory signals can reach L1)
// ============================================================================
//
// Deviation note (Blocker 2 — plan line 13):
// The plan listed main.test.ts as a modification target for:
//   (a) "assert showToast NOT called per-article"
//   (b) "timeout-advisory assertion"
// These invariants are fully covered by syndication-toast-law.test.ts
// (Law 1 + Law 2 describe blocks) which test exactly this on multi-article
// fixtures. Duplicating the assertion here would add noise without additional
// coverage — the invariant is tested in the dedicated law suite, not here.
// This is a deliberate deviation from the plan table's modification target.

const mockTask = {
  id: "0",
  progress: vi.fn().mockResolvedValue(undefined),
  awaiting: vi.fn().mockResolvedValue(undefined),
  advise: vi.fn().mockResolvedValue(undefined),
  succeeded: vi.fn().mockResolvedValue(undefined),
  failed: vi.fn().mockResolvedValue(undefined),
  cancelled: vi.fn().mockResolvedValue(undefined),
};

// ============================================================================
// Tests: syndicateArticle cover upload
// ============================================================================

describe("syndicateArticle - cover upload", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Restore browser/event mocks after clearAllMocks() (they return undefined otherwise,
    // causing closeBrowser().catch() / onEvent().then() to throw).
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: new Promise(() => {}) } as any);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);

    // Default: createDraft succeeds
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());

    // Default: fetchDraft immediately returns published draft
    // This causes waitForPublishOrClose to exit on first poll iteration,
    // preventing the OOM loop caused by mocked sleep running instantly.
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());

    // Default: readSiteFile returns fake base64 bytes, uploadAssetMultipart returns asset
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "cover-asset-id-1", path: "https://assets.matters.news/cover/uploaded-cover.jpg" });
  });

  it("uploads cover bytes AFTER draft creation and updates draft with cover asset ID", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // readSiteFile called with the site-relative path (leading slash stripped)
    expect(readSiteFile).toHaveBeenCalledWith("assets/covers/book.jpg");

    // uploadAssetMultipart called with correct type "cover" and entityId
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "book.jpg",
      "image/jpeg",
      "cover",
      "draft-123"
    );

    // First createDraft: without cover (draft doesn't exist yet)
    expect(createDraft).toHaveBeenNthCalledWith(1,
      expect.not.objectContaining({ cover: expect.anything() })
    );

    // Second createDraft: updates draft with cover asset ID (not path) AND preserves title
    expect(createDraft).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: "draft-123", cover: "cover-asset-id-1", title: "Test Article" })
    );
  });

  it("strips leading slash from cover path when reading site file", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "/assets/covers/hero.png" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // Leading slash stripped for readSiteFile
    expect(readSiteFile).toHaveBeenCalledWith("assets/covers/hero.png");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "hero.png",
      "image/png",
      "cover",
      "draft-123"
    );
  });

  it("skips cover upload and does not update draft when no cover in frontmatter", async () => {
    const article = makeArticle({ frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // No cover upload at all
    expect(uploadAssetMultipart).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), "cover", expect.anything()
    );
    // Only one createDraft call (no cover update)
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("continues without cover when readSiteFile throws (graceful failure)", async () => {
    vi.mocked(readSiteFile).mockRejectedValueOnce(new Error("File not found"));
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    // Should not throw
    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    // createDraft called only once (no cover update since upload failed)
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ cover: expect.anything() })
    );
  });

  it("continues without cover when uploadAssetMultipart throws (graceful failure)", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValueOnce(new Error("Upload failed: 500"));
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    // Should not throw
    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    // createDraft called only once (no cover update since upload failed)
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ cover: expect.anything() })
    );
  });

  it("returns publishedUrl when draft is published", async () => {
    const article = makeArticle({ frontmatter: {} });
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-xyz"));
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse("draft-xyz"));

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(result.draftId).toBe("draft-xyz");
    expect(result.publishedUrl).toBeDefined();
  });
});

// ============================================================================
// Tests: SINGLE_FILE_UPLOAD_MUTATION shape (api.ts)
// ============================================================================

describe("SINGLE_FILE_UPLOAD_MUTATION", () => {
  it("contains the correct mutation name", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("SingleFileUpload");
  });

  it("uses singleFileUpload field name", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("singleFileUpload");
  });

  it("uses SingleFileUploadInput type for the input argument", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("SingleFileUploadInput");
  });

  it("requests id and path fields from the response", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("id");
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("path");
  });

  it("has correct mutation signature", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toMatch(/mutation\s+SingleFileUpload/);
    expect(SINGLE_FILE_UPLOAD_MUTATION).toMatch(/\$input:\s*SingleFileUploadInput!/);
  });
});

// ============================================================================
// Tests: stripArticleTitleH1
// ============================================================================

describe("stripArticleTitleH1", () => {
  it("strips moss-article-title h1 when text matches", () => {
    const html = '<h1 class="moss-article-title">My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("<p>Body.</p>");
  });

  it("strips when class is one of several", () => {
    const html = '<h1 class="foo moss-article-title bar">My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("<p>Body.</p>");
  });

  it("ignores h1 with the moss class but mismatched text (author-edited)", () => {
    const html = '<h1 class="moss-article-title">Different</h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("ignores plain h1 (no moss-article-title class)", () => {
    const html = '<h1>My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("ignores h2/h3 even when text matches and class is present", () => {
    const html = '<h2 class="moss-article-title">My Title</h2>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("tolerates inline tags inside the h1", () => {
    const html = '<h1 class="moss-article-title">My <em>fancy</em> Title</h1>';
    expect(stripArticleTitleH1(html, "My fancy Title")).toBe("");
  });

  it("collapses whitespace before comparing", () => {
    const html = '<h1 class="moss-article-title">  My\n  Title  </h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("");
  });

  it("does not affect non-leading h1s on its own (multiple h1s case)", () => {
    // The strip is class-gated, so a body-internal plain <h1> survives.
    const html = '<h1 class="moss-article-title">My Title</h1><p>x</p><h1>Also Title</h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe('<p>x</p><h1>Also Title</h1>');
  });
});

// ============================================================================
// Tests: absolutizeRelativeHrefs
// ============================================================================

describe("absolutizeRelativeHrefs", () => {
  const baseUrl = "https://example.com/posts/foo/";

  it("resolves a deep-relative href against the article URL", () => {
    const html = '<a href="../../scale-compare.html">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/scale-compare.html">link</a>',
    );
  });

  it("resolves a sibling-relative href", () => {
    const html = '<a href="other.html">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/posts/foo/other.html">link</a>',
    );
  });

  it("resolves a root-relative href against the site origin", () => {
    const html = '<a href="/about/">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/about/">link</a>',
    );
  });

  it("leaves http URLs untouched", () => {
    const html = '<a href="https://other.com/x">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves mailto: untouched", () => {
    const html = '<a href="mailto:a@b.com">email</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves fragment-only links untouched (intra-document)", () => {
    const html = '<a href="#section">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves protocol-relative URLs untouched", () => {
    const html = '<a href="//cdn.example.com/x.js">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("preserves attributes around the href", () => {
    const html = '<a class="x" href="../foo.html" target="_blank" rel="noopener">link</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('class="x"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain('href="https://example.com/posts/foo.html"');
  });

  it("handles multiple anchors in one document", () => {
    const html = '<a href="a.html">a</a><p>x</p><a href="../b.html">b</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('href="https://example.com/posts/foo/a.html"');
    expect(result).toContain('href="https://example.com/posts/b.html"');
  });

  it("does not touch <img src> attributes", () => {
    const html = '<img src="../foo.gif">';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("preserves &amp;-encoded query strings in resolved hrefs", () => {
    // moss-generated HTML uses HTML entities for & in attributes. Make sure
    // the regex captures and re-emits them unchanged so the resulting href
    // is still well-formed HTML.
    const html = '<a href="../foo?a=1&amp;b=2">link</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('href="https://example.com/posts/foo?a=1&amp;b=2"');
  });

  it("leaves empty href untouched", () => {
    // The regex requires at least one character inside the quotes, so empty
    // hrefs fall through unchanged. That's the safer default — rewriting
    // empty hrefs to the article URL would silently turn a broken link into
    // a self-link, which is worse than leaving it broken.
    const html = '<a href="">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });
});

// ============================================================================
// Tests: normalizeHtmlForMatters — heading transformation
// ============================================================================

describe("normalizeHtmlForMatters - heading transformation", () => {
  it("downgrades h1 to h2", () => {
    const html = "<h1>Title</h1><p>Content</p>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Title</h2><p>Content</p>");
  });

  it("keeps h2 as h2", () => {
    const html = "<h2>Subtitle</h2>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Subtitle</h2>");
  });

  it("keeps h3 as h3", () => {
    const html = "<h3>Section</h3>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Section</h3>");
  });

  it("collapses h4 to h3", () => {
    const html = "<h4>Sub-section</h4>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Sub-section</h3>");
  });

  it("collapses h5 to h3", () => {
    const html = "<h5>Deep</h5>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Deep</h3>");
  });

  it("collapses h6 to h3", () => {
    const html = "<h6>Deepest</h6>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Deepest</h3>");
  });

  it("handles h1 with attributes", () => {
    const html = '<h1 id="top" class="title">Title</h1>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h2 id="top" class="title">Title</h2>');
  });

  it("handles h4 with attributes", () => {
    const html = '<h4 id="sub">Sub</h4>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h3 id="sub">Sub</h3>');
  });

  it("processes multiple heading levels in the same document", () => {
    const html = "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>H1</h2><h2>H2</h2><h3>H3</h3><h3>H4</h3><h3>H5</h3><h3>H6</h3>");
  });

  it("does not double-shift h4-h6 (processes h4-h6 before h1)", () => {
    // If h1→h2 ran first, then h4→h3 would still be fine,
    // but we want to ensure the order is correct:
    // h4-h6→h3 first, then h1→h2
    const html = "<h1>Title</h1><h4>Detail</h4>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Title</h2><h3>Detail</h3>");
  });

  it("handles content with no headings", () => {
    const html = "<p>Just a paragraph</p>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<p>Just a paragraph</p>");
  });
});

// ============================================================================
// Tests: wrapImagesForMatters
// ============================================================================
//
// matters' server-side sanitizer requires images to be wrapped in
// `<figure class="image"><img src="..."><figcaption>...</figcaption></figure>`.
// Anything else (`<figure class="moss-image">`, `<picture>` standalone, bare
// `<img>`) gets stripped on draft storage. Empirically verified 2026-05-27
// via smoke test against `server.matters.icu`.
//
// `wrapImagesForMatters` is matters-specific — moss's emission stays as-is
// for the web; this transform only applies on the syndication path.

describe("wrapImagesForMatters", () => {
  it("wraps a bare img inside a <p> in figure.image", () => {
    const html = '<p><img src="photo.jpg" alt="Photo"></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg" alt="Photo"><figcaption></figcaption></figure>',
    );
  });

  it("wraps a self-closing img alone in <p>", () => {
    const html = '<p><img src="photo.jpg" /></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg" /><figcaption></figcaption></figure>',
    );
  });

  it("renames figure.moss-image → figure.image and adds empty figcaption when missing", () => {
    const html = '<figure class="moss-image"><img src="photo.jpg"></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>',
    );
  });

  it("renames figure.moss-image → figure.image and preserves existing figcaption", () => {
    const html =
      '<figure class="moss-image"><img src="photo.jpg"><figcaption>A caption</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption>A caption</figcaption></figure>',
    );
  });

  it("wraps standalone <picture> (variant pattern from moss raster output) in figure.image", () => {
    const html =
      '<picture><source srcset="photo.webp" type="image/webp"><img src="photo.jpg"></picture>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp" type="image/webp"><img src="photo.jpg"></picture><figcaption></figcaption></figure>',
    );
  });

  it("hoists <p><picture></p> out of the <p> (figure-in-p is invalid HTML)", () => {
    const html =
      '<p><picture><source srcset="photo.webp"><img src="photo.jpg"></picture></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption></figcaption></figure>',
    );
  });

  it("does not double-wrap <picture> that's already inside figure.image", () => {
    const html =
      '<figure class="moss-image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption>Cap</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption>Cap</figcaption></figure>',
    );
  });

  it("wraps multiple standalone images independently", () => {
    const html = '<p><img src="a.jpg"></p><p>text</p><p><img src="b.jpg"></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="a.jpg"><figcaption></figcaption></figure>' +
        "<p>text</p>" +
        '<figure class="image"><img src="b.jpg"><figcaption></figcaption></figure>',
    );
  });

  it("leaves figure.image untouched (already in matters shape)", () => {
    const html =
      '<figure class="image"><img src="photo.jpg"><figcaption>cap</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption>cap</figcaption></figure>',
    );
  });

  it("wraps bare <img> between block elements", () => {
    const html = '<p>Before</p><img src="photo.jpg"><p>After</p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<p>Before</p><figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure><p>After</p>',
    );
  });
});

// ============================================================================
// Tests: stripHeadingAnchors
// ============================================================================
//
// moss appends a permalink anchor to every heading:
//   <h2 id="1.">1.<a class="moss-heading-anchor" href="#1." aria-label="…">
//     <span aria-hidden="true">#</span></a></h2>
// On the web the `#` is hover-only chrome, but matters' sanitizer keeps the
// anchor's text — so headings render as "1.#" (a stray `#`, linked). This is
// web-only chrome, not content, so we strip the whole anchor on syndication.
// Verified 2026-06-16 against server.matters.icu (the `#` survives without this).

describe("stripHeadingAnchors", () => {
  it("removes the moss-heading-anchor permalink from a heading", () => {
    const html =
      '<h1 id="1." data-source-line="8">1.<a class="moss-heading-anchor" href="#1." aria-label="Permalink to this section"><span aria-hidden="true">#</span></a></h1>';
    expect(stripHeadingAnchors(html)).toBe('<h1 id="1." data-source-line="8">1.</h1>');
  });

  it("strips anchors from multiple headings, leaving heading text intact", () => {
    const html =
      '<h2>Intro<a class="moss-heading-anchor" href="#intro"><span aria-hidden="true">#</span></a></h2>' +
      "<p>body</p>" +
      '<h3>详情<a class="moss-heading-anchor" href="#详情"><span aria-hidden="true">#</span></a></h3>';
    expect(stripHeadingAnchors(html)).toBe("<h2>Intro</h2><p>body</p><h3>详情</h3>");
  });

  it("tolerates attribute order and extra classes on the anchor", () => {
    const html = '<h2>T<a href="#t" class="foo moss-heading-anchor bar"><span>#</span></a></h2>';
    expect(stripHeadingAnchors(html)).toBe("<h2>T</h2>");
  });

  it("leaves ordinary anchors (non-heading-anchor) untouched", () => {
    const html = '<h2>See <a href="/other">link</a></h2>';
    expect(stripHeadingAnchors(html)).toBe(html);
  });

  it("leaves content without heading anchors unchanged", () => {
    const html = "<h2>Title</h2><p>text</p>";
    expect(stripHeadingAnchors(html)).toBe(html);
  });
});

// Also exercised via the full normalizeHtmlForMatters pipeline.
describe("normalizeHtmlForMatters - strips heading anchors", () => {
  it("removes the permalink # and downgrades h1→h2 in one pass", () => {
    const html =
      '<h1 id="1.">1.<a class="moss-heading-anchor" href="#1."><span aria-hidden="true">#</span></a></h1>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h2 id="1.">1.</h2>');
    expect(result).not.toContain("#");
    expect(result).not.toContain("moss-heading-anchor");
  });
});

// ============================================================================
// Tests: wrapAudioForMatters
// ============================================================================
//
// moss emits audio as a bare `<audio class="moss-embed moss-embed-audio"
// controls preload="metadata"><source src="..." type="..."></audio>`. matters'
// server-side sanitizer STRIPS that shape entirely (the whole <audio> vanishes;
// only the fallback text leaks out as a stray <p>). Empirically verified
// 2026-06-16 against `server.matters.icu`: the only audio shape matters keeps is
//   <figure class="audio"><audio controls><source src="URL" type="MIME"></audio>
//   <figcaption>…</figcaption></figure>
// where (a) the URL MUST live on a <source> child (a `src` on <audio> itself is
// dropped), (b) a <figcaption> child is REQUIRED — its absence triggers a server
// error ("Cannot read properties of undefined (reading 'firstChild')"), empty is
// fine, and (c) matters keeps an EXTERNAL <source src> verbatim, so the audio can
// stream straight from the deployed site — no upload to matters is needed (and
// matters' `embedaudio` asset type rejects url-upload anyway).
//
// So this transform restructures moss's audio into matters' figure shape and
// absolutizes the <source src> against the article URL (same rule as
// absolutizeRelativeHrefs), so matters' player streams from the live site.

/**
 * Every `html` literal below is REAL `moss build` output, captured 2026-07-21
 * from a vault built with `moss build <site> --no-plugins`. Attribute order
 * (`class` then `data-moss-math`) and the HTML-escaping of the TeX are
 * verbatim, not reconstructed.
 */
describe("transformMathForMatters", () => {
  it("unwraps inline math to its LaTeX source, delimiters included", () => {
    const html =
      '<p>Inline: <code class="moss-math" data-moss-math="inline">$E = mc^2$</code></p>';
    const out = transformMathForMatters(html);
    expect(out.html).toBe("<p>Inline: $E = mc^2$</p>");
    expect(out.inline).toBe(1);
  });

  it("keeps moss's HTML-escaping when unwrapping inline math", () => {
    // Escaping must survive: matters re-parses this HTML, so `&lt;` staying
    // `&lt;` is what makes the reader see `<`.
    const html =
      '<p><code class="moss-math" data-moss-math="inline">$a &lt; b \\&amp; c &gt; d$</code></p>';
    expect(transformMathForMatters(html).html).toBe("<p>$a &lt; b \\&amp; c &gt; d$</p>");
  });

  it("hoists display math alone in its paragraph into <pre><code>", () => {
    const html =
      '<p><code class="moss-math" data-moss-math="display">$$ o_t = \\frac{\\phi(q_t)^\\top S_t}{\\phi(q_t)^\\top z_t} $$</code></p>';
    const out = transformMathForMatters(html);
    expect(out.html).toBe(
      "<pre><code>$$ o_t = \\frac{\\phi(q_t)^\\top S_t}{\\phi(q_t)^\\top z_t} $$</code></pre>",
    );
    expect(out.display).toBe(1);
    // Hoisted OUT of the <p>: a <pre> left inside a <p> makes matters split the
    // paragraph and emit stray empty <p></p> siblings.
    expect(out.html).not.toContain("<p>");
  });

  it("preserves the line structure of a multi-line align block inside <pre>", () => {
    // <pre> is the ONLY whitespace-preserving container in matters' pipeline.
    const html =
      '<p><code class="moss-math" data-moss-math="display">$$\n\\begin{align}\na &amp;= b \\\\\nc &amp;= d\n\\end{align}\n$$</code></p>';
    const out = transformMathForMatters(html);
    expect(out.html).toBe(
      "<pre><code>$$\n\\begin{align}\na &amp;= b \\\\\nc &amp;= d\n\\end{align}\n$$</code></pre>",
    );
    expect(out.html.split("\n")).toHaveLength(6);
  });

  it("strips % comments on the hoisted path too — the <pre> is not ours to guarantee", () => {
    // This test previously asserted the opposite: that a `%` comment SURVIVES
    // the hoist because <pre> preserves the newline that ends it. That reasoning
    // holds only while the <pre> itself survives, and whether it does is matters'
    // TipTap schema's call, not ours — a blockquote (which moss really emits, as
    // a bare <p> inside <blockquote data-source-line=…>) refuses a codeBlock
    // child and normalizes it back to a <p>, collapsing the newlines after this
    // transform has returned. A surviving comment then eats the rest of the
    // formula. Dropping it is lossless; the wager was not worth taking.
    const html =
      '<p data-source-line="7"><code class="moss-math" data-moss-math="display">$$\nx = 1 % this is a note\nb = 2\n$$</code></p>';
    const out = transformMathForMatters(html);
    expect(out.html).not.toContain("% this is a note");
    expect(out.commentsStripped).toBe(1);
    expect(out.display).toBe(1);
    // Line structure is still preserved — only the comment went.
    expect(out.html).toContain("<pre><code>$$\nx = 1 \nb = 2\n$$</code></pre>");
  });

  it("degrades display math mixed with prose to text", () => {
    const html =
      '<p>before <code class="moss-math" data-moss-math="display">$$a+b$$</code> after</p>';
    const out = transformMathForMatters(html);
    expect(out.html).toBe("<p>before $$a+b$$ after</p>");
    expect(out.displayInline).toBe(1);
    expect(out.display).toBe(0);
  });

  it("drops % comments and collapses newlines when math lands in prose", () => {
    // Newline collapse is unavoidable outside <pre>. Without stripping the
    // comment, `b = 2` would end up commented out — a silently WRONG but
    // valid-looking formula.
    const html =
      '<p>see <code class="moss-math" data-moss-math="display">$$\nx = 1 % this is a note\nb = 2\n$$</code> ok</p>';
    const out = transformMathForMatters(html);
    expect(out.html).toBe("<p>see $$ x = 1 b = 2 $$ ok</p>");
    expect(out.commentsStripped).toBe(1);
    expect(out.html).not.toContain("%");
  });

  it("keeps an escaped \\% — it is a literal percent, not a comment", () => {
    const html =
      '<p>x <code class="moss-math" data-moss-math="inline">$50 \\% \\text{ of } x$</code> y</p>';
    const out = transformMathForMatters(html);
    expect(out.html).toBe("<p>x $50 \\% \\text{ of } x$ y</p>");
    expect(out.commentsStripped).toBe(0);
  });

  it("counts every equation it touched", () => {
    const html =
      '<p><code class="moss-math" data-moss-math="display">$$a$$</code></p>' +
      '<p>t <code class="moss-math" data-moss-math="inline">$b$</code> ' +
      '<code class="moss-math" data-moss-math="inline">$c$</code></p>';
    const out = transformMathForMatters(html);
    expect(out.display).toBe(1);
    expect(out.inline).toBe(2);
  });

  it("leaves math-free HTML untouched", () => {
    const html = "<p>No math here at all.</p><pre><code>echo $PATH</code></pre>";
    const out = transformMathForMatters(html);
    expect(out.html).toBe(html);
    expect(out.inline + out.display + out.displayInline).toBe(0);
  });
});

describe("normalizeHtmlForMatters - math", () => {
  it("runs math BEFORE image wrapping, so wrapImagesForMatters cannot reach into it", () => {
    // Ordering guard: if math ran after Step 3, a future math-as-figure
    // emission would already have been rewritten by the bare-<img> auto-wrap.
    const html =
      '<p><code class="moss-math" data-moss-math="display">$$x$$</code></p>' +
      '<figure class="moss-image"><img src="a.png"></figure>';
    const out = normalizeHtmlForMatters(html);
    expect(out).toContain("<pre><code>$$x$$</code></pre>");
    expect(out).toContain('<figure class="image">');
    // The math <pre> must not have been swept into a figure.
    expect(out).not.toContain('<figure class="image"><pre>');
  });

  /**
   * PRODUCTION INPUT SHAPE.
   *
   * The transforms do NOT receive the shipped page HTML. They receive
   * `article-map.json`'s `html_content` (`load_articles_for_syndication` →
   * `getArticleContent`), where every top-level paragraph still carries
   * `data-source-line` — `ship_phase` strips that attribute only during the
   * staging→site FILE copy, which never rewrites `article-map.json`.
   *
   * A literal `<p>` pattern therefore matches NOTHING in production. Verified
   * 2026-07-21 against a real `moss build`: before the fix, the whole
   * math-test-site payload reported `display: 0` and every display equation
   * degraded to flattened prose.
   */
  it("hoists display math out of a paragraph that carries data-source-line", () => {
    const html =
      '<p data-source-line="11"><code class="moss-math" data-moss-math="display">' +
      "$$\nS_t &amp;= \\sum_i \\phi(k_i) \\\\\nz_t &amp;= \\sum_i \\phi(k_i)\n$$</code></p>";
    const stats = transformMathForMatters(html);
    expect(stats.display).toBe(1);
    expect(stats.displayInline).toBe(0);
    // …and the line structure survived the hoist.
    expect(stats.html).toContain("<pre><code>$$\nS_t &amp;= \\sum_i \\phi(k_i) \\\\\n");
  });

  it("wraps an image in a paragraph that carries data-source-line", () => {
    const html = '<p data-source-line="5"><img src="a.png"></p>';
    const out = normalizeHtmlForMatters(html);
    expect(out).toContain('<figure class="image"><img src="a.png"><figcaption></figcaption></figure>');
    // The hoist must consume the <p>, not leave it wrapping the figure.
    expect(out).not.toContain("<p data-source-line");
  });

  /**
   * BLOCKQUOTE — the container where hoisting is NOT ours to guarantee.
   *
   * moss emits a BARE `<p>` inside `<blockquote data-source-line=…>` (verified
   * by real `moss build` emission, 2026-07-21), so Pass 1 fires there. But
   * matters' TipTap schema decides which parents accept a codeBlock child, and
   * a blockquote is reported to refuse one — normalizing `<pre>` back down to
   * `<p>`, which re-enters the newline-collapsing path AFTER this transform has
   * finished. If a `%` comment were still present at that point it would eat
   * the rest of the equation and publish a valid-looking but WRONG formula.
   *
   * So the `%` strip is unconditional, including on the hoisted path. Dropping
   * a comment is lossless for the formula; staking correctness on a downstream
   * schema we cannot run locally is not.
   */
  it("strips % comments even when hoisting, so a downstream collapse cannot corrupt the formula", () => {
    const html =
      '<blockquote data-source-line="4">\n' +
      '<p><code class="moss-math" data-moss-math="display">$$\na % note\nb\n$$</code></p>\n' +
      "</blockquote>";
    const stats = transformMathForMatters(html);
    expect(stats.display).toBe(1);
    expect(stats.commentsStripped).toBe(1);
    expect(stats.html).not.toContain("% note");
    // Collapse the newlines the way a <pre>-refusing container would, and the
    // formula must still read `$$ a b $$` — `b` outside any comment.
    const collapsed = stats.html.replace(/\s*\n\s*/g, " ");
    expect(collapsed).toContain("$$ a b $$");
  });

  it("keeps an escaped \\% through the hoist", () => {
    const html =
      '<p data-source-line="2"><code class="moss-math" data-moss-math="display">$$50 \\% x$$</code></p>';
    const stats = transformMathForMatters(html);
    expect(stats.commentsStripped).toBe(0);
    expect(stats.html).toContain("$$50 \\% x$$");
  });

  it("keeps math source out of headings' anchor-stripping path", () => {
    const html =
      '<h3>状态更新 <code class="moss-math" data-moss-math="inline">$S_t$</code> 的推导</h3>';
    expect(normalizeHtmlForMatters(html)).toBe("<h3>状态更新 $S_t$ 的推导</h3>");
  });

  /**
   * P2 — the typeset `<svg>` shape, which fails INVISIBLY if shipped as-is.
   *
   * matters' sanitizer allows no `<svg>`: the element is unwrapped to its
   * children and `<path>` has no text, so a bare equation vanishes while
   * syndication still reports success. Verified 2026-07-21 by running the real
   * `@matters/matters-editor` transformers over
   * `<p>x <svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg> y</p>`,
   * which returned `<p>x y</p>`.
   *
   * P2 renders `$tex$` as an inline `<svg class="moss-math" … aria-label="…">`
   * carrying the LaTeX source in its `<title>`/`aria-label` (ADR-030). matters
   * has no SVG projection (PNG-upload is a FUTURE step), so the transform MUST
   * degrade a math SVG to that source before it reaches the draft body. These
   * tests feed the REAL P2 shape and pin: (a) no `<svg>` survives to matters,
   * (b) the reader sees the source instead of a blank, (c) the `svgDetected`
   * tripwire still fires for an SVG we genuinely cannot recover.
   */
  it("degrades a P2 inline math <svg> to its LaTeX source, no <svg> left", () => {
    const withSvg =
      '<p data-source-line="1">Mass–energy: ' +
      '<svg class="moss-math" data-moss-math="inline" role="img" fill="currentColor" ' +
      'aria-label="$E = mc^2$"><title>$E = mc^2$</title>' +
      '<path d="M0 0 L10 10"/></svg> holds.</p>';
    const out = transformMathForMatters(withSvg);
    // MUTATION WITNESS: neuter Pass 0's conversion and this line goes red —
    // the raw <svg> reaches the assembled matters body and the equation vanishes.
    expect(out.html).not.toContain("<svg");
    expect(out.html).not.toContain("moss-math");
    expect(out.html).toBe("<p data-source-line=\"1\">Mass–energy: $E = mc^2$ holds.</p>");
    expect(out.mathSvg).toBe(1);
    expect(out.svgDetected).toBe(0);
  });

  it("degrades a P2 display math <svg> alone in its paragraph to <pre><code>", () => {
    // A display SVG carries multi-line source; degrading to <pre><code> keeps
    // the line structure, the same treatment P1's display <code> gets.
    const withSvg =
      '<p data-source-line="2"><svg class="moss-math" data-moss-math="display" role="img" ' +
      'fill="currentColor" aria-label="$$\n\\begin{align}\na &amp;= b \\\\\nc &amp;= d\n\\end{align}\n$$">' +
      '<title>$$\n\\begin{align}\na &amp;= b \\\\\nc &amp;= d\n\\end{align}\n$$</title>' +
      '<path d="M0 0"/></svg></p>';
    const out = transformMathForMatters(withSvg);
    expect(out.html).not.toContain("<svg");
    expect(out.html).toBe(
      "<pre><code>$$\n\\begin{align}\na &amp;= b \\\\\nc &amp;= d\n\\end{align}\n$$</code></pre>",
    );
    expect(out.mathSvg).toBe(1);
    expect(out.display).toBe(1);
    expect(out.svgDetected).toBe(0);
  });

  it("recovers source from aria-label when a math <svg> has no <title>", () => {
    // ADR-030 lists both carriers; if a build ever drops the <title>, the
    // aria-label must still save the equation from silent deletion.
    const withSvg =
      '<p data-source-line="3">See <svg class="moss-math" data-moss-math="inline" ' +
      'aria-label="$a &lt; b$"><path d="M0 0"/></svg> here.</p>';
    const out = transformMathForMatters(withSvg);
    expect(out.html).not.toContain("<svg");
    expect(out.html).toBe('<p data-source-line="3">See $a &lt; b$ here.</p>');
    expect(out.mathSvg).toBe(1);
    expect(out.svgDetected).toBe(0);
  });

  it("infers display from a $$ prefix when the SVG carries no data-moss-math", () => {
    const withSvg =
      '<p data-source-line="4"><svg class="moss-math" aria-label="$$x+y$$">' +
      "<title>$$x+y$$</title><path d=\"M0 0\"/></svg></p>";
    const out = transformMathForMatters(withSvg);
    expect(out.html).toBe("<pre><code>$$x+y$$</code></pre>");
    expect(out.display).toBe(1);
    expect(out.svgDetected).toBe(0);
  });

  it("wraps a delimiter-less aria-label source so the reader sees real LaTeX", () => {
    // Defensive: if a build ever emits the bare TeX (no $ delimiters) in the
    // carrier, we still hand matters a well-formed `$…$` span, not naked prose.
    const withSvg =
      '<p data-source-line="5">x <svg class="moss-math" data-moss-math="inline" ' +
      'aria-label="E = mc^2"><path d="M0 0"/></svg> y</p>';
    const out = transformMathForMatters(withSvg);
    expect(out.html).toBe('<p data-source-line="5">x $E = mc^2$ y</p>');
    expect(out.svgDetected).toBe(0);
  });

  it("still trips svgDetected for a non-math <svg> it cannot degrade to source", () => {
    // A non-math <svg> (no moss-math class, no source carrier) is NOT ours to
    // rescue; matters deletes it silently, so it must stay counted and loud.
    const withSvg =
      '<p data-source-line="6">x <svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg> y</p>';
    const out = transformMathForMatters(withSvg);
    expect(out.html).toContain("<svg"); // untouched — not moss math
    expect(out.mathSvg).toBe(0);
    expect(
      out.svgDetected,
      "an <svg> matters will delete must be counted — an undetected one means " +
        "content vanishes from the published article with no error anywhere.",
    ).toBe(1);
  });

  it("leaves the tripwire down for P1's own <code> emission", () => {
    const html =
      '<p data-source-line="1">Inline <code class="moss-math" data-moss-math="inline">$E = mc^2$</code></p>' +
      '<p data-source-line="2"><code class="moss-math" data-moss-math="display">$$\\int_0^1 x\\,dx$$</code></p>';
    const out = transformMathForMatters(html);
    expect(out.svgDetected).toBe(0);
    expect(out.mathSvg).toBe(0);
  });

  it("degrades a P2 math <svg> through the full normalizeHtmlForMatters chain", () => {
    // End-to-end at the same altitude the golden payload runs: a P2 SVG on the
    // real assembly path must reach the draft body as source, never as <svg>.
    const html =
      '<p data-source-line="1"><svg class="moss-math" data-moss-math="display" ' +
      'aria-label="$$\\int_0^1 x\\,dx$$"><title>$$\\int_0^1 x\\,dx$$</title>' +
      '<path d="M0 0"/></svg></p>';
    const body = normalizeHtmlForMatters(html);
    expect(body).not.toContain("<svg");
    expect(body).toContain("<pre><code>$$\\int_0^1 x\\,dx$$</code></pre>");
  });
});

/**
 * GOLDEN PAYLOAD — the whole transform chain over a real moss article.
 *
 * `test-fixtures/syndication-test-site/moss-emitted-body.html` is the verbatim
 * `html_content` that `moss build --no-plugins` wrote to `article-map.json`
 * for `input/posts/rich-test-article.md` (recaptured 2026-07-21).
 *
 * It MUST come from `article-map.json`, NOT from the shipped page HTML under
 * `.moss/build/current/`. `article-map.json` is what the plugin actually
 * receives (`load_articles_for_syndication` → `getArticleContent`); the shipped
 * page has already had `data-source-line` stripped by `ship_phase`'s
 * staging→site file copy. Capturing from the shipped page is how this fixture
 * green-lit a shape production never produces, hiding a dead Pass 1 behind 17
 * passing tests. Regenerate with:
 *
 *   cd plugins/matters/test-fixtures/syndication-test-site
 *   moss build input --no-plugins
 *   python3 -c "import json; print(json.load(open('input/.moss/build/article-map.json'))\
 *     ['articles']['posts/rich-test-article/']['html_content'])" > moss-emitted-body.html
 *
 * This is the ONLY test that exercises the transforms against real emission
 * rather than hand-written literals, so it is where a change in moss's math
 * markup will surface first — which only holds while it is wired to the real
 * emission.
 */
describe("syndication golden payload - rich-test-article", () => {
  const fixtureDir = join(__dirname, "..", "..", "test-fixtures", "syndication-test-site");
  const canonicalUrl = "https://example.com/posts/rich-test-article/";
  const title = "Exploring Decentralized Publishing: A Test Article";

  const assembleBody = (): string => {
    const emitted = readFileSync(join(fixtureDir, "moss-emitted-body.html"), "utf8");
    let content = stripArticleTitleH1(emitted, title);
    content = normalizeHtmlForMatters(content);
    content = addCanonicalLinkToContent(content, canonicalUrl, true, "en");
    content = absolutizeRelativeHrefs(content, canonicalUrl);
    content = wrapAudioForMatters(content, canonicalUrl);
    return content;
  };

  it("matches the committed golden payload", async () => {
    await expect(assembleBody()).toMatchFileSnapshot(
      join(fixtureDir, "expected-matters-body.html"),
    );
  });

  it("leaves no moss-math markup in the assembled body", () => {
    const body = assembleBody();
    expect(body).not.toContain("moss-math");
    expect(body).not.toContain("data-moss-math");
  });

  it("keeps every equation's LaTeX source, delimiters included", () => {
    const body = assembleBody();
    expect(body).toContain("$h = H(c)$");
    expect(body).toContain("\\mathrm{cost}(n)");
    expect(body).toContain("\\begin{align}");
  });

  it("puts multi-line display math in <pre><code> with its lines intact", () => {
    const body = assembleBody();
    const align = body.match(/<pre><code>[\s\S]*?\\begin\{align\}[\s\S]*?<\/code><\/pre>/);
    expect(align).not.toBeNull();
    expect(align![0]).toContain("S_t &amp;= \\sum_{i \\le t} \\phi(k_i) v_i^\\top \\\\\n");
    expect(align![0]).toContain("z_t &amp;=");
  });

  it("drops the % comment but keeps the line it must not eat", () => {
    const body = assembleBody();
    expect(body).not.toContain("% ratio of unique to total");
    // The line the comment would have eaten is still there, still on its own
    // line — so even if matters collapses this <pre>, the formula reads right.
    expect(body).toContain("\n\\quad\\text{where } U = \\bigcup_i B_i");
  });

  it("keeps an escaped \\% as a literal percent sign", () => {
    expect(assembleBody()).toContain("$50 \\%$");
  });

  it("contains no <svg> (P2 constraint — matters deletes it silently)", () => {
    expect(
      assembleBody().includes("<svg"),
      "matters' sanitizer DELETES <svg> silently. P2 (typeset math) must not " +
        "emit SVG on the matters syndication path.",
    ).toBe(false);
  });
});

describe("wrapAudioForMatters", () => {
  const base = "https://example.com/posts/test/";

  it("wraps moss audio into figure.audio and absolutizes a relative src", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">Your browser does not support the audio tag.</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("resolves deep-relative srcs against the article URL", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="../assets/song.mp3" type="audio/mpeg">fallback</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/assets/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("leaves an already-absolute src unchanged", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="https://cdn.example.com/a.mp3" type="audio/mpeg">x</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://cdn.example.com/a.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("hoists audio out of a wrapping <p> (figure-in-p is invalid HTML)", () => {
    const html =
      '<p><audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">x</audio></p>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("drops the <audio> fallback text (no leak into figcaption or siblings)", () => {
    const html =
      '<p>Before</p><audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">Your browser does not support the audio tag.</audio><p>After</p>';
    const result = wrapAudioForMatters(html, base);
    expect(result).not.toContain("does not support");
    expect(result).toBe(
      '<p>Before</p><figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure><p>After</p>',
    );
  });

  it("omits the type attr when moss emitted none", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3">x</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3"></audio><figcaption></figcaption></figure>',
    );
  });

  it("wraps multiple audio embeds independently", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="a.mp3" type="audio/mpeg">x</audio>' +
      "<p>mid</p>" +
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="b.wav" type="audio/wav">y</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/a.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>' +
        "<p>mid</p>" +
        '<figure class="audio"><audio controls><source src="https://example.com/posts/test/b.wav" type="audio/wav"></audio><figcaption></figcaption></figure>',
    );
  });

  it("leaves content without audio untouched", () => {
    const html = "<h2>Title</h2><p>No audio here</p>";
    expect(wrapAudioForMatters(html, base)).toBe(html);
  });
});

// Also called via normalizeHtmlForMatters (the full pipeline)
describe("normalizeHtmlForMatters - image wrap (via pipeline)", () => {
  it("wraps a standalone img while leaving headings alone", () => {
    const html = '<h2>Title</h2><p><img src="photo.jpg"></p>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain('<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>');
    expect(result).toContain("<h2>Title</h2>");
  });

  it("downgrades h1 and wraps img in the same pass", () => {
    const html = '<h1>Title</h1><p><img src="photo.jpg"></p>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain("<h2>Title</h2>");
    expect(result).toContain('<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>');
  });
});

// ============================================================================
// Tests: addCanonicalLinkToContent with lang parameter
// ============================================================================

describe("addCanonicalLinkToContent - lang parameter", () => {
  const url = "https://example.com/posts/test/";

  it("uses Chinese text for zh lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "zh");
    expect(result).toContain("原文链接");
    expect(result).toContain(`href="${url}"`);
    expect(result).toContain("<hr>");
    expect(result).not.toContain("Originally published");
  });

  it("uses Chinese text for zh_hans lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "zh_hans");
    expect(result).toContain("原文链接");
  });

  it("uses Chinese text for zh_hant lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "zh_hant");
    expect(result).toContain("原文链接");
  });

  it("uses English text for en lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "en");
    expect(result).toContain("Original link");
    expect(result).toContain(`href="${url}"`);
    expect(result).not.toContain("原文链接");
  });

  it("uses English text when lang is undefined (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true);
    expect(result).toContain("Original link");
  });

  it("uses Chinese text for zh lang (Markdown)", () => {
    const result = addCanonicalLinkToContent("Content", url, false, "zh");
    expect(result).toContain("[原文链接]");
    expect(result).toContain(`(${url})`);
    expect(result).toContain("---");
  });

  it("uses English text for en lang (Markdown)", () => {
    const result = addCanonicalLinkToContent("Content", url, false, "en");
    expect(result).toContain("[Original link]");
    expect(result).toContain(`(${url})`);
  });

  it("uses English text when lang is undefined (Markdown)", () => {
    const result = addCanonicalLinkToContent("Content", url, false);
    expect(result).toContain("[Original link]");
  });

  it("preserves original content before the canonical link", () => {
    const original = "<p>My article content</p>";
    const result = addCanonicalLinkToContent(original, url, true, "en");
    expect(result.startsWith(original)).toBe(true);
  });
});

// ============================================================================
// Tests: syndicateArticle — summary and lang
// ============================================================================

describe("syndicateArticle - summary and lang", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";

  beforeEach(async () => {
    vi.clearAllMocks();
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: new Promise(() => {}) } as any);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "asset-id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
  });

  it("passes summary from frontmatter.description to createDraft", async () => {
    const article = makeArticle({
      frontmatter: { description: "A short summary of the article" },
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "A short summary of the article" })
    );
  });

  it("does not pass summary when frontmatter.description is absent", async () => {
    const article = makeArticle({ frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ summary: expect.anything() })
    );
  });

  it("passes lang to addCanonicalLinkToContent (zh produces Chinese text)", async () => {
    const article = makeArticle({
      html_content: "<p>Content</p>",
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: true,
      lang: "zh_hans",
    }, mockTask);

    // The content passed to createDraft should contain Chinese canonical text
    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain("原文链接");
  });

  it("normalizes HTML headings before creating draft", async () => {
    const article = makeArticle({
      html_content: "<h1>Title</h1><h4>Detail</h4><p>Body</p>",
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain("<h2>Title</h2>");
    expect(callArgs.content).toContain("<h3>Detail</h3>");
    expect(callArgs.content).not.toContain("<h1>");
    expect(callArgs.content).not.toContain("<h4>");
  });

  it("wraps images in figure.image for matters compatibility", async () => {
    // matters' server-side sanitizer requires `<figure class="image">` with
    // a `<figcaption>` child or it strips the `<img>` entirely. Empirically
    // verified 2026-05-27. Phase 2A of the unified-image-emission migration
    // (2026-05-25) removed this wrap on the (incorrect) assumption that
    // moss's `<figure class="moss-image">` output would round-trip through
    // matters; it does not. So the plugin restores the wrap as a
    // matters-specific transform — moss-core's emission stays as-is.
    const article = makeArticle({
      html_content: '<p>Text</p><p><img src="photo.jpg" alt="Photo"></p><p>More</p>',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain('<figure class="image">');
    expect(callArgs.content).toContain("<figcaption>");
    expect(callArgs.content).toContain('src="photo.jpg"');
  });

  it("does not normalize HTML when content is markdown (not HTML)", async () => {
    const article = makeArticle({
      html_content: undefined,
      content: "# Title\n\nContent with h4-like text: <h4>not real</h4>",
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    // Markdown content should not be normalized
    expect(callArgs.content).toBe("# Title\n\nContent with h4-like text: <h4>not real</h4>");
  });
});

// ============================================================================
// Tests: siteRelativePathFromSrc
// ============================================================================

describe("siteRelativePathFromSrc", () => {
  const base = "https://liu-guo.com/posts/foo/";

  it("resolves a site-absolute src to a relative site path", () => {
    expect(siteRelativePathFromSrc("/image/x.jpg", "https://liu-guo.com/posts/foo/"))
      .toBe("image/x.jpg");
  });

  it("resolves a same-directory relative src", () => {
    expect(siteRelativePathFromSrc("photo.jpg", base)).toBe("posts/foo/photo.jpg");
  });

  it("resolves a parent-traversal relative src", () => {
    expect(siteRelativePathFromSrc("../a.jpg", "https://s.com/p/q/")).toBe("p/a.jpg");
  });

  it("resolves a deep-relative src (../../) against the article URL", () => {
    expect(siteRelativePathFromSrc("../../assets/x.gif", "https://example.com/writings/foo-bar/"))
      .toBe("assets/x.gif");
  });

  it("returns null for a data: URI", () => {
    expect(siteRelativePathFromSrc("data:image/png;base64,abc=", base)).toBeNull();
  });

  it("returns null for a cross-origin absolute URL", () => {
    expect(siteRelativePathFromSrc("https://other.com/x.jpg", base)).toBeNull();
  });

  it("returns null for a matters CDN URL (different origin)", () => {
    expect(siteRelativePathFromSrc("https://assets.matters.news/embed/abc.jpg", base)).toBeNull();
  });

  it("decodes percent-encoded pathname characters", () => {
    expect(siteRelativePathFromSrc("/%E5%9B%BE%E7%89%87/photo.png", "https://example.com/"))
      .toBe("图片/photo.png");
  });

  it("resolves same-origin absolute URL to its site path", () => {
    expect(siteRelativePathFromSrc("https://liu-guo.com/image/x.jpg", "https://liu-guo.com/posts/foo/"))
      .toBe("image/x.jpg");
  });
});

// ============================================================================
// Tests: imageMimeForPath
// ============================================================================

describe("imageMimeForPath", () => {
  it("maps .jpg to image/jpeg", () => {
    expect(imageMimeForPath("photo.jpg")).toBe("image/jpeg");
  });

  it("maps .jpeg to image/jpeg", () => {
    expect(imageMimeForPath("photo.jpeg")).toBe("image/jpeg");
  });

  it("maps .png to image/png", () => {
    expect(imageMimeForPath("cover.png")).toBe("image/png");
  });

  it("maps .webp to image/webp", () => {
    expect(imageMimeForPath("img.webp")).toBe("image/webp");
  });

  it("maps .gif to image/gif", () => {
    expect(imageMimeForPath("anim.gif")).toBe("image/gif");
  });

  it("maps .avif to image/avif", () => {
    expect(imageMimeForPath("photo.avif")).toBe("image/avif");
  });

  it("maps .svg to image/svg+xml", () => {
    expect(imageMimeForPath("icon.svg")).toBe("image/svg+xml");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(imageMimeForPath("file.bmp")).toBe("application/octet-stream");
  });
});

// ============================================================================
// Tests: audioMimeForPath
// ============================================================================

describe("audioMimeForPath", () => {
  it("maps .mp3 to audio/mpeg", () => {
    expect(audioMimeForPath("song.mp3")).toBe("audio/mpeg");
  });

  it("maps .wav to audio/wav", () => {
    expect(audioMimeForPath("sound.wav")).toBe("audio/wav");
  });

  it("maps .ogg to audio/ogg", () => {
    expect(audioMimeForPath("track.ogg")).toBe("audio/ogg");
  });

  it("maps .flac to audio/flac", () => {
    expect(audioMimeForPath("lossless.flac")).toBe("audio/flac");
  });

  it("maps .m4a to audio/mp4", () => {
    expect(audioMimeForPath("podcast.m4a")).toBe("audio/mp4");
  });

  it("maps .opus to audio/opus", () => {
    expect(audioMimeForPath("voice.opus")).toBe("audio/opus");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(audioMimeForPath("file.aiff")).toBe("application/octet-stream");
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalImages
// ============================================================================

describe("uploadAndReplaceLocalImages", () => {
  const baseUrl = "https://example.com/posts/foo/";
  const entityId = "draft-test";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "asset-id-1",
      path: "https://assets.matters.news/embed/uploaded.jpg",
    });
  });

  it("reads site file and uploads bytes, replaces src with CDN URL", async () => {
    const html = '<p>Text</p><img src="images/photo.jpg" alt="Photo"><p>More</p>';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/images/photo.jpg");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "photo.jpg",
      "image/jpeg",
      "embed",
      entityId
    );
    expect(result).toContain('src="https://assets.matters.news/embed/uploaded.jpg"');
    expect(result).not.toContain('src="images/photo.jpg"');
  });

  it("resolves site-absolute src to correct site path", async () => {
    const html = '<img src="/assets/hero.png" alt="Hero">';

    await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(readSiteFile).toHaveBeenCalledWith("assets/hero.png");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String), "hero.png", "image/png", "embed", entityId
    );
  });

  it("leaves cross-origin absolute URLs unchanged (no upload)", async () => {
    const html = '<img src="https://cdn.example.com/photo.jpg"><img src="http://other.com/img.png">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(readSiteFile).not.toHaveBeenCalled();
    expect(result).toContain('src="https://cdn.example.com/photo.jpg"');
    expect(result).toContain('src="http://other.com/img.png"');
  });

  it("skips data: URIs (no upload, no replacement)", async () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("deduplicates: same src used twice is only uploaded once", async () => {
    const html = '<img src="images/photo.jpg"><p>text</p><img src="images/photo.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).toHaveBeenCalledTimes(1);
    // Both occurrences should be replaced
    const matches = result.match(/src="https:\/\/assets\.matters\.news\/embed\/uploaded\.jpg"/g);
    expect(matches).toHaveLength(2);
  });

  it("handles multiple different local images", async () => {
    vi.mocked(uploadAssetMultipart)
      .mockResolvedValueOnce({ id: "id-a", path: "https://assets.matters.news/embed/a.jpg" })
      .mockResolvedValueOnce({ id: "id-b", path: "https://assets.matters.news/embed/b.jpg" });

    const html = '<img src="a.jpg"><img src="b.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).toHaveBeenCalledTimes(2);
    expect(result).toContain('src="https://assets.matters.news/embed/a.jpg"');
    expect(result).toContain('src="https://assets.matters.news/embed/b.jpg"');
  });

  it("falls back to absolutized deployed URL when upload fails (graceful failure)", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValueOnce(new Error("Upload failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="images/photo.jpg" alt="Photo">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    // Fallback: src becomes the absolutized deployed URL, not the original relative src
    expect(result).toContain('src="https://example.com/posts/foo/images/photo.jpg"');
    expect(result).not.toContain('src="images/photo.jpg"');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("falls back to absolutized deployed URL when readSiteFile fails", async () => {
    vi.mocked(readSiteFile).mockRejectedValueOnce(new Error("File not found"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="images/photo.jpg" alt="Photo">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    // Fallback: absolutized deployed URL
    expect(result).toContain('src="https://example.com/posts/foo/images/photo.jpg"');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("replaces successful uploads while falling back on failed ones", async () => {
    vi.mocked(uploadAssetMultipart)
      .mockResolvedValueOnce({ id: "id-good", path: "https://assets.matters.news/embed/good.jpg" })
      .mockRejectedValueOnce(new Error("Failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="good.jpg"><img src="bad.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(result).toContain('src="https://assets.matters.news/embed/good.jpg"');
    // bad.jpg gets absolutized fallback URL
    expect(result).toContain('src="https://example.com/posts/foo/bad.jpg"');

    vi.restoreAllMocks();
  });

  it("returns content unchanged when no images are present", async () => {
    const html = "<p>Just text, no images</p>";

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });

  it("returns content unchanged when all images are already-uploaded matters URLs (cross-origin)", async () => {
    const html = '<img src="https://assets.matters.news/embed/abc.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(readSiteFile).not.toHaveBeenCalled();
    // Cross-origin absolute URL stays exactly as-is
    expect(result).toBe(html);
  });

  it("preserves other attributes when replacing src", async () => {
    const html = '<img src="photo.jpg" alt="A photo" width="500" height="300" class="hero">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(result).toContain('src="https://assets.matters.news/embed/uploaded.jpg"');
    expect(result).toContain('alt="A photo"');
    expect(result).toContain('width="500"');
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalAudio
// ============================================================================

describe("uploadAndReplaceLocalAudio", () => {
  // After wrapAudioForMatters, the <source src> is already an absolutized
  // deployed URL (e.g. "https://liu-guo.com/posts/foo/song.mp3"). The audio
  // upload step tries to read it from the local build and replace it with a
  // durable matters CDN URL; on failure the absolutized deployed URL stays.
  const baseUrl = "https://liu-guo.com/posts/foo/";
  const entityId = "draft-audio-test";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "audio-asset-id",
      path: "https://assets.matters.news/embedaudio/uploaded.mp3",
    });
  });

  it("uploads audio bytes and replaces <source src> with CDN URL", async () => {
    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/song.mp3");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "song.mp3",
      "audio/mpeg",
      "embedaudio",
      entityId
    );
    expect(result).toContain('src="https://assets.matters.news/embedaudio/uploaded.mp3"');
    expect(result).not.toContain('src="https://liu-guo.com/posts/foo/song.mp3"');
  });

  it("leaves <source src> unchanged on upload error (deployed URL streams fine)", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValueOnce(new Error("Upload failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // src stays unchanged — the deployed URL lets matters stream it
    expect(result).toContain('src="https://liu-guo.com/posts/foo/song.mp3"');

    vi.restoreAllMocks();
  });

  it("leaves <source src> unchanged on readSiteFile error", async () => {
    vi.mocked(readSiteFile).mockRejectedValueOnce(new Error("File not found"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(result).toContain('src="https://liu-guo.com/posts/foo/song.mp3"');

    vi.restoreAllMocks();
  });

  it("does NOT touch <img src> attributes — only matches <source>", async () => {
    const html =
      '<figure class="image"><img src="https://liu-guo.com/posts/foo/photo.jpg"></figure>' +
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // img src is not changed
    expect(result).toContain('src="https://liu-guo.com/posts/foo/photo.jpg"');
    // source src is replaced
    expect(result).toContain('src="https://assets.matters.news/embedaudio/uploaded.mp3"');
    // readSiteFile only called once (for the audio, not the image)
    expect(readSiteFile).toHaveBeenCalledTimes(1);
    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/song.mp3");
  });

  it("returns content unchanged when no <source> elements are present", async () => {
    const html = "<p>Just text, no audio</p>";

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });

  it("leaves cross-origin <source src> unchanged (external CDN audio)", async () => {
    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://cdn.other.com/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // Cross-origin src → no upload, no change
    expect(readSiteFile).not.toHaveBeenCalled();
    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });
});

// ============================================================================
// Tests: syndicateArticle - local image upload integration
// ============================================================================

describe("syndicateArticle - audio upload (integration)", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: new Promise(() => {}) } as any);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-aud"));
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "audio-asset-1",
      path: "https://assets-develop.matters.news/embedaudio/uploaded.mpga",
    });
  });

  it("wraps moss audio into figure.audio, uploads bytes (embedaudio), re-puts draft with CDN url", async () => {
    const article = makeArticle({
      html_content:
        '<p>Intro</p><audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">Your browser does not support the audio tag.</audio>',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // Audio bytes read from the deployed site path resolved against the article URL.
    expect(readSiteFile).toHaveBeenCalledWith("posts/test/song.mp3");
    // Uploaded as embedaudio against the draft id.
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "song.mp3",
      "audio/mpeg",
      "embedaudio",
      "draft-aud",
    );

    // Final draft body: figure.audio wrap with the matters CDN url on the <source>,
    // and NO surviving bare moss <audio> / relative src / fallback text.
    const lastPut = vi.mocked(createDraft).mock.calls.at(-1)![0];
    const finalContent = String(lastPut.content);
    expect(finalContent).toContain('<figure class="audio">');
    expect(finalContent).toContain(
      '<source src="https://assets-develop.matters.news/embedaudio/uploaded.mpga"',
    );
    expect(finalContent).toContain("<figcaption></figcaption>");
    expect(finalContent).not.toContain("moss-embed-audio");
    expect(finalContent).not.toContain("does not support");
  });

  it("falls back to the streamed deployed URL when audio byte-upload fails", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValue(new Error("upload 500"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const article = makeArticle({
      html_content:
        '<audio class="moss-embed moss-embed-audio" controls><source src="song.mp3" type="audio/mpeg">x</audio>',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // The figure.audio survives with the absolutized deployed URL (matters streams it).
    const calls = vi.mocked(createDraft).mock.calls.map((c) => String(c[0]?.content ?? ""));
    const withAudio = calls.find((c) => c.includes('<figure class="audio">'));
    expect(withAudio).toContain('<source src="https://example.com/posts/test/song.mp3"');
    vi.restoreAllMocks();
  });
});

describe("syndicateArticle - local image upload", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: new Promise(() => {}) } as any);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "asset-id-1",
      path: "https://assets.matters.news/embed/uploaded.jpg",
    });
  });

  it("reads site file bytes and uploads AFTER draft creation with entityId, then re-puts draft", async () => {
    // Regression: Matters' singleFileUpload mutation requires `entityId` for
    // type:"embed", just as it does for cover. Uploading before the draft
    // exists fails with "Entity id needs to be specified.", leaving the body
    // <img> srcs as relative paths (which 404 inside matters.town).
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg" alt="Photo">',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // readSiteFile called with the decoded site path resolved against the article URL
    expect(readSiteFile).toHaveBeenCalledWith("posts/test/images/photo.jpg");

    // uploadAssetMultipart called with embed type and the draft's entityId
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "photo.jpg",
      "image/jpeg",
      "embed",
      "draft-123"
    );

    // First putDraft: original content (still has the relative src — the
    // draft must exist before we have an entityId to upload against).
    expect(createDraft).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ content: expect.stringContaining('src="images/photo.jpg"') }),
    );

    // Second putDraft: rewrites content with CDN URLs, preserves title.
    expect(createDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "draft-123",
        title: "Test Article",
        content: expect.stringContaining('src="https://assets.matters.news/embed/uploaded.jpg"'),
      }),
    );
  });

  it("resolves deep-relative srcs (../../) against article path, not site root", async () => {
    // Regression: a post at /writings/foo-bar/ with `<img src="../../assets/x.gif">`
    // must read from assets/x.gif (resolved via parent traversal), not be
    // dropped/mis-resolved. Earlier code passed bare siteUrl as the base, so
    // `../../` clamped to root and the per-article directory was never used.
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-deep"));
    const article = makeArticle({
      html_content: '<img src="../../assets/scale-compare-recording.gif">',
      frontmatter: {},
      url_path: "writings/foo-bar/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).toHaveBeenCalledWith("assets/scale-compare-recording.gif");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "scale-compare-recording.gif",
      expect.any(String),
      "embed",
      "draft-deep"
    );
  });

  it("does not upload images when content is markdown (not HTML)", async () => {
    const article = makeArticle({
      html_content: undefined,
      content: '# Title\n\n![photo](images/photo.jpg)',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).not.toHaveBeenCalled();
    expect(uploadAssetMultipart).not.toHaveBeenCalled();
  });

  it("does not upload absolute cross-origin URL images in HTML content", async () => {
    const article = makeArticle({
      html_content: '<img src="https://cdn.example.com/already-hosted.jpg">',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).not.toHaveBeenCalled();
    expect(uploadAssetMultipart).not.toHaveBeenCalled();
  });

  it("continues gracefully when image upload step throws — does not re-put draft with relative src", async () => {
    // When readSiteFile + uploadAssetMultipart both fail, the src becomes
    // the absolutized fallback URL (not the original relative one). No
    // re-put happens only when the rewritten content equals original content.
    vi.mocked(readSiteFile).mockRejectedValue(new Error("File not found"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg">',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    vi.restoreAllMocks();
  });

  it("continues gracefully when re-put after image upload throws (matches cover's failure semantics)", async () => {
    // Regression: a single 5xx on the embed re-put used to kill syndicateArticle,
    // skipping the toast/openBrowser path while the draft itself was already
    // created. Cover survives the same failure (try/catch around its block),
    // and embed should too — the user is still better off seeing the draft.
    vi.mocked(createDraft)
      .mockResolvedValueOnce(makeDraftResponse("draft-rep")) // first putDraft: ok
      .mockRejectedValueOnce(new Error("matters 503")) // re-put: fails
      .mockResolvedValue(makeDraftResponse("draft-rep")); // any later calls: ok
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg">',
      frontmatter: {},
    });

    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Asset upload step failed"),
    );

    vi.restoreAllMocks();
  });

  it("absolutizes relative <a href> links against the article URL", async () => {
    // Regression: matters.town serves whatever URL we send. Relative hrefs in
    // the draft (e.g. `../../scale-compare.html`) end up resolved against
    // matters.town/me/drafts/... and 404 every internal link from the source.
    const article = makeArticle({
      html_content: '<p>See <a href="../../scale-compare.html">the demo</a>.</p>',
      frontmatter: {},
      url_path: "writings/foo-bar/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    const draftContent = vi.mocked(createDraft).mock.calls[0][0].content!;
    expect(draftContent).toContain('href="https://example.com/scale-compare.html"');
    expect(draftContent).not.toContain('href="../../scale-compare.html"');
  });

  it("strips the moss-injected article-title h1 to avoid duplicating the matters title", async () => {
    // Regression: moss's pipeline auto-injects <h1 class="moss-article-title">
    // into html_content. matters.town has its own title field, so leaving the
    // h1 in the body shows the title twice in the published draft.
    const article = makeArticle({
      title: "My Title",
      html_content:
        '<h1 class="moss-article-title">My Title</h1><p>Body.</p>',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    const draftContent = vi.mocked(createDraft).mock.calls[0][0].content!;
    expect(draftContent).not.toContain('moss-article-title');
    // The matters title field carries the title.
    expect(vi.mocked(createDraft).mock.calls[0][0].title).toBe("My Title");
    // The first non-whitespace content should not be a title heading.
    expect(draftContent.trim().startsWith("<p>Body.</p>")).toBe(true);
  });
});

// ============================================================================
// Tests: Draft tracking functions
// ============================================================================

describe("Draft tracking - getDraftMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty object when file does not exist", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    const map = await getDraftMap();
    expect(map).toEqual({});
  });

  it("returns parsed map when file exists", async () => {
    const stored: DraftMap = {
      "articles/review.md": { draftId: "abc123", createdAt: "2026-03-16T10:00:00Z" },
    };
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(JSON.stringify(stored));

    const map = await getDraftMap();
    expect(map).toEqual(stored);
  });

  it("returns empty object on parse error", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue("not valid json {{{");

    const map = await getDraftMap();
    expect(map).toEqual({});
  });

  it("returns empty object when readPluginFile throws", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockRejectedValue(new Error("read error"));

    const map = await getDraftMap();
    expect(map).toEqual({});
  });
});

describe("Draft tracking - saveDraftMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes JSON to plugin storage", async () => {
    const map: DraftMap = {
      "posts/test.md": { draftId: "draft-1", createdAt: "2026-03-16T10:00:00Z" },
    };

    await saveDraftMap(map);

    expect(writePluginFile).toHaveBeenCalledWith(
      "drafts.json",
      JSON.stringify(map, null, 2)
    );
  });

  it("writes empty object for empty map", async () => {
    await saveDraftMap({});

    expect(writePluginFile).toHaveBeenCalledWith(
      "drafts.json",
      JSON.stringify({}, null, 2)
    );
  });
});

describe("Draft tracking - getDraftId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns draftId when entry exists for sourcePath", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-abc", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    const id = await getDraftId("posts/test.md");
    expect(id).toBe("draft-abc");
  });

  it("returns undefined when no entry for sourcePath", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/other.md": { draftId: "draft-abc", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    const id = await getDraftId("posts/test.md");
    expect(id).toBeUndefined();
  });

  it("returns undefined when drafts file is empty", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    const id = await getDraftId("posts/test.md");
    expect(id).toBeUndefined();
  });
});

describe("Draft tracking - saveDraftId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds entry to empty map", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    await saveDraftId("posts/test.md", "draft-new");

    expect(writePluginFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/test.md"].draftId).toBe("draft-new");
    expect(written["posts/test.md"].createdAt).toBeDefined();
  });

  it("adds entry to existing map without overwriting others", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/existing.md": { draftId: "draft-old", createdAt: "2026-01-01T00:00:00Z" },
      })
    );

    await saveDraftId("posts/new.md", "draft-new");

    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/existing.md"].draftId).toBe("draft-old");
    expect(written["posts/new.md"].draftId).toBe("draft-new");
  });

  it("overwrites existing entry for the same source path", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-old", createdAt: "2026-01-01T00:00:00Z" },
      })
    );

    await saveDraftId("posts/test.md", "draft-updated");

    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/test.md"].draftId).toBe("draft-updated");
  });
});

describe("Draft tracking - removeDraftId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes entry from map", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-abc", createdAt: "2026-01-01T00:00:00Z" },
        "posts/other.md": { draftId: "draft-def", createdAt: "2026-01-02T00:00:00Z" },
      })
    );

    await removeDraftId("posts/test.md");

    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/test.md"]).toBeUndefined();
    expect(written["posts/other.md"].draftId).toBe("draft-def");
  });

  it("no-ops when entry does not exist (still writes the map)", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(JSON.stringify({}));

    await removeDraftId("posts/nonexistent.md");

    expect(writePluginFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(Object.keys(written)).toHaveLength(0);
  });
});

// ============================================================================
// Tests: syndicateArticle — draft reuse integration
// ============================================================================

describe("syndicateArticle - draft tracking integration", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset sleep to default no-op (timeout tests override it with clock-advancing mock)
    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockResolvedValue(undefined);

    // Re-establish SDK mocks (vi.restoreAllMocks() in earlier tests may have wiped them)
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.showToast).mockResolvedValue(undefined);
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: new Promise(() => {}) } as any);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);

    // Re-establish domain mocks
    const domain = await import("../domain");
    vi.mocked(domain.draftUrl).mockImplementation((id: string) => `https://matters.town/drafts/${id}`);
    vi.mocked(domain.articleUrl).mockImplementation((_user: string, slug: string, hash: string) => `https://matters.town/@testuser/${slug}-${hash}`);

    // Default: no existing drafts tracked
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    // Default: createDraft succeeds
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());

    // Default: fetchDraft immediately returns published draft
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());

    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "asset-id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
  });

  it("passes existing draft ID to createDraft when one is tracked", async () => {
    // Set up existing draft tracking
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "existing-draft-99", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: "existing-draft-99" })
    );
  });

  it("does not pass id to createDraft when no draft is tracked", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ id: expect.anything() })
    );
  });

  it("falls back to new draft when existing draft ID causes API error", async () => {
    // Set up existing stale draft tracking
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "stale-draft-id", createdAt: "2026-01-01T00:00:00Z" },
      })
    );

    // First call (with id) fails, second call (without id) succeeds
    vi.mocked(createDraft)
      .mockRejectedValueOnce(new Error("Draft not found"))
      .mockResolvedValueOnce(makeDraftResponse("new-draft-456"));

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // Should have been called twice: once with id, once without
    expect(createDraft).toHaveBeenCalledTimes(2);
    expect(createDraft).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ id: "stale-draft-id" })
    );
    expect(createDraft).toHaveBeenNthCalledWith(2,
      expect.not.objectContaining({ id: expect.anything() })
    );
    expect(result.draftId).toBe("new-draft-456");
  });

  it("throws when createDraft fails and no existing draft to fall back from", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);
    vi.mocked(createDraft).mockRejectedValue(new Error("API error"));

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    await expect(
      syndicateArticle(article, siteUrl, userName, options, mockTask)
    ).rejects.toThrow("API error");
  });

  it("removes draft tracking on successful publish", async () => {
    // Set up existing draft
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-123", createdAt: "2026-03-16T10:00:00Z" },
        "posts/other.md": { draftId: "draft-other", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    // Draft is published
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse("draft-123"));

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(result.publishedUrl).toBeDefined();

    // writePluginFile should have been called to remove the draft entry
    // The last call to writePluginFile should be from removeDraftId
    const lastWriteCall = vi.mocked(writePluginFile).mock.calls;
    const lastWritten = JSON.parse(lastWriteCall[lastWriteCall.length - 1][1]);
    expect(lastWritten["posts/test.md"]).toBeUndefined();
    // Other entries should be preserved
    expect(lastWritten["posts/other.md"]).toBeDefined();
  });

  it("saves draft ID when browser is closed without publishing", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    // Draft created but NOT published
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-timeout"));

    // fetchDraft always returns unpublished — poll loop would run forever
    // without the browser-close termination path.
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "draft-timeout",
      title: "Test",
      content: "<p>Test</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "unpublished" as const,
    });

    // Simulate browser closing after the first poll sleep: resolve the
    // `closed` promise on the first sleep() call so the race terminates.
    const sdk = await import("@symbiosis-lab/moss-api");
    let resolveClose!: (reason: any) => void;
    const closedPromise = new Promise<any>((resolve) => { resolveClose = resolve; });
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: closedPromise });

    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockImplementation(async () => {
      // On first sleep (5s poll) resolve the browser close so branch (b) fires.
      resolveClose({ type: "user" });
      // Yield for the closed promise to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(result.publishedUrl).toBeUndefined();

    // Draft ID should have been saved for reuse
    const writeCalls = vi.mocked(writePluginFile).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    // Find the call that writes drafts.json
    const draftWriteCall = writeCalls.find(call => call[0] === "drafts.json");
    expect(draftWriteCall).toBeDefined();
    const written = JSON.parse(draftWriteCall![1]);
    expect(written["posts/test.md"].draftId).toBe("draft-timeout");
  });

  it("does not track draft when article has no source_path (browser closed)", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-no-path"));

    // Terminate via browser close instead of a wall-clock timeout.
    const sdk = await import("@symbiosis-lab/moss-api");
    let resolveClose!: (reason: any) => void;
    const closedPromise = new Promise<any>((resolve) => { resolveClose = resolve; });
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: closedPromise });

    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockImplementation(async () => {
      resolveClose({ type: "user" });
      await Promise.resolve();
      await Promise.resolve();
    });

    vi.mocked(fetchDraft).mockResolvedValue({
      id: "draft-no-path",
      title: "Test",
      content: "<p>Test</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "unpublished" as const,
    });

    const article = makeArticle({ source_path: "", frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // writePluginFile should NOT have been called with drafts.json
    const draftWriteCalls = vi.mocked(writePluginFile).mock.calls.filter(
      call => call[0] === "drafts.json"
    );
    expect(draftWriteCalls).toHaveLength(0);
  });
});

// ============================================================================
// Tests: Cover path decoding for non-ASCII paths
// ============================================================================

describe("syndicateArticle - cover path decoding", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: new Promise(() => {}) } as any);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "cover-id-1", path: "https://assets.matters.news/cover/cover.png" });
  });

  it("decodes percent-encoded Chinese characters in cover path for readSiteFile", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-cn"));

    // frontmatter.cover may contain literal Chinese or percent-encoded chars
    const article = makeArticle({
      frontmatter: { cover: "%E5%9B%BE%E7%89%87/cover-image.png" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // readSiteFile should receive the DECODED path (filesystem uses decoded chars)
    const readCall = vi.mocked(readSiteFile).mock.calls[0][0];
    expect(readCall).toBe("图片/cover-image.png");
    expect(readCall).not.toContain("%");
  });

  it("reads ASCII cover paths without modification", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-ascii"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).toHaveBeenCalledWith("assets/covers/book.jpg");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "book.jpg",
      "image/jpeg",
      "cover",
      "draft-ascii"
    );
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalImages — non-ASCII path decoding for readSiteFile
// ============================================================================

describe("uploadAndReplaceLocalImages - non-ASCII path decoding", () => {
  const baseUrl = "https://example.com/posts/foo/";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
  });

  it("decodes percent-encoded Chinese characters in src for readSiteFile", async () => {
    // Browsers may percent-encode non-ASCII in src attributes; readSiteFile
    // needs the decoded filesystem path.
    const html = '<img src="%E5%9B%BE%E7%89%87/photo.png" alt="Photo">';

    await uploadAndReplaceLocalImages(html, baseUrl, "draft-cn");

    const readCall = vi.mocked(readSiteFile).mock.calls[0][0];
    expect(readCall).toContain("图片/photo.png");
    expect(readCall).not.toContain("%E5%9B%BE%E7%89%87");
  });

  it("passes literal Chinese src characters to readSiteFile decoded", async () => {
    // src may contain raw non-ASCII if the author typed it directly
    const html = '<img src="图片/photo.png" alt="Photo">';

    await uploadAndReplaceLocalImages(html, baseUrl, "draft-cn");

    const readCall = vi.mocked(readSiteFile).mock.calls[0][0];
    expect(readCall).toContain("图片/photo.png");
  });
});

// ============================================================================
// Tests: waitForPublishOrClose detects browser close
// ============================================================================

describe("syndicateArticle - browser close detection", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();

    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockResolvedValue(undefined);

    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.showToast).mockResolvedValue(undefined);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);

    const domain = await import("../domain");
    vi.mocked(domain.draftUrl).mockImplementation((id: string) => `https://matters.town/drafts/${id}`);
    vi.mocked(domain.articleUrl).mockImplementation((_user: string, slug: string, hash: string) => `https://matters.town/@testuser/${slug}-${hash}`);

    vi.mocked(pluginFileExists).mockResolvedValue(false);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-close-test"));
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "asset-id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
  });

  it("exits immediately when browser is closed, saves draft for reuse", async () => {
    const sdk = await import("@symbiosis-lab/moss-api");

    // Simulate browser closing after first sleep call
    let resolveClose!: (reason: any) => void;
    const closedPromise = new Promise<any>((resolve) => { resolveClose = resolve; });
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: closedPromise });

    // Draft never gets published (no article field)
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "draft-close-test",
      title: "Test",
      content: "<p>Test</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "unpublished" as const,
    });

    // Track how many times fetchDraft is polled.
    // Clock does NOT advance past timeout — so if waitForPublishOrClose
    // doesn't detect browser close, it will poll in an infinite loop.
    // We cap sleep calls to detect this.
    let sleepCallCount = 0;
    const MAX_SLEEP_CALLS = 5;
    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockImplementation(async () => {
      sleepCallCount++;
      if (sleepCallCount === 1) {
        // Resolve browser close on first poll iteration
        resolveClose({ type: "user" });
        // Yield so the promise can settle
        await Promise.resolve();
        await Promise.resolve();
      }
      if (sleepCallCount > MAX_SLEEP_CALLS) {
        // Safety valve: prevent infinite loop in current (broken) code.
        // Force timeout by making Date.now() return a large value.
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 999999999);
      }
    });

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // Should NOT have published (browser was closed)
    expect(result.publishedUrl).toBeUndefined();

    // Key assertion: browser close should stop polling after 1 sleep call.
    // If the code doesn't detect browser close, it will poll many times
    // until our safety valve kicks in at MAX_SLEEP_CALLS.
    expect(sleepCallCount).toBeLessThanOrEqual(2);

    // Draft ID should be saved for reuse
    const draftWriteCalls = vi.mocked(writePluginFile).mock.calls.filter(
      call => call[0] === "drafts.json"
    );
    expect(draftWriteCalls.length).toBeGreaterThan(0);
    const written = JSON.parse(draftWriteCalls[draftWriteCalls.length - 1][1]);
    expect(written["posts/test.md"].draftId).toBe("draft-close-test");
  });
});

// ============================================================================
// Tests: waitForPublishOrClose — no wall-clock ceiling
// ============================================================================

describe("waitForPublishOrClose - no wall-clock ceiling (resolves on publish or close only)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockResolvedValue(undefined);
    // onEvent / emitEvent are called inside waitForPublishOrClose — must be re-mocked
    // after clearAllMocks() or the .then()/.catch() chains will throw on undefined.
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.onEvent).mockResolvedValue(() => {});
    vi.mocked(sdk.emitEvent).mockResolvedValue(undefined);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);
  });

  it("resolves with publish result when fetchDraft returns article", async () => {
    vi.mocked(fetchDraft).mockResolvedValueOnce({
      id: "d1",
      title: "T",
      content: "<p>T</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "published" as const,
      article: { shortHash: "abc123", slug: "my-article" },
    });

    const result = await waitForPublishOrClose("d1");
    expect(result).toEqual({ shortHash: "abc123", slug: "my-article" });
  });

  it("resolves with null when browser handle closes (no publish)", async () => {
    // fetchDraft always returns unpublished — without browser close this would
    // loop forever. The test verifies the wall-clock-free path terminates on close.
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d2",
      title: "T",
      content: "<p>T</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "unpublished" as const,
    });

    let resolveClose!: (r: unknown) => void;
    const closedPromise = new Promise<unknown>((res) => { resolveClose = res; });

    const { sleep } = await import("../utils");
    let sleepCalls = 0;
    vi.mocked(sleep).mockImplementation(async () => {
      sleepCalls++;
      // Trigger browser close on first poll so the race terminates.
      if (sleepCalls === 1) {
        resolveClose({ type: "user" });
        await Promise.resolve();
        await Promise.resolve();
      }
      // Safety: if close path is broken the poll would run forever; cap at 3.
      if (sleepCalls > 3) throw new Error("waitForPublishOrClose did not terminate on browser close");
    });

    const result = await waitForPublishOrClose("d2", { closed: closedPromise } as any);
    expect(result).toBeNull();
    // Closed after first poll — should not have looped many times.
    expect(sleepCalls).toBeLessThanOrEqual(2);
  });

  it("does NOT have a wall-clock timeout path — no setTimeout deadline", async () => {
    // Verify that the function signature no longer accepts a timeoutMs argument.
    // If someone accidentally re-adds it and uses it, this structural assertion
    // (function.length = parameter count) catches the regression.
    // waitForPublishOrClose(draftId, browserHandle?) → 2 formal params max.
    expect(waitForPublishOrClose.length).toBeLessThanOrEqual(2);
  });
});
