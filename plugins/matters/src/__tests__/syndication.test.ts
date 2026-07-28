import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  addCanonicalLinkToContent,
  getArticleContent,
  isArticleLive,
} from "../main";
import type { ArticleInfo } from "../types";

describe("addCanonicalLinkToContent", () => {
  const canonicalUrl = "https://example.com/posts/hello/";

  it("appends markdown canonical link for markdown content", () => {
    const result = addCanonicalLinkToContent("# Hello\n\nContent.", canonicalUrl, false);
    expect(result).toContain("---");
    expect(result).toContain(`[Original link](${canonicalUrl})`);
    expect(result).not.toContain("<hr>");
  });

  it("appends HTML canonical link for HTML content", () => {
    const result = addCanonicalLinkToContent("<h1>Hello</h1><p>Content.</p>", canonicalUrl, true);
    expect(result).toContain("<hr>");
    expect(result).toContain(`<a href="${canonicalUrl}">Original link</a>`);
    expect(result).not.toContain("---\n");
  });

  it("defaults to markdown mode when isHtml is omitted", () => {
    const result = addCanonicalLinkToContent("# Hello", canonicalUrl);
    expect(result).toContain("---");
    expect(result).not.toContain("<hr>");
  });
});

describe("getArticleContent", () => {
  const baseArticle: ArticleInfo = {
    source_path: "posts/test.md",
    title: "Test",
    content: "# Test\n\nMarkdown content.",
    frontmatter: {},
    url_path: "posts/test/",
    tags: [],
  };

  it("returns html_content when available", () => {
    const article: ArticleInfo = {
      ...baseArticle,
      html_content: "<h1>Test</h1>\n<p>Markdown content.</p>",
    };
    const result = getArticleContent(article);
    expect(result.content).toBe("<h1>Test</h1>\n<p>Markdown content.</p>");
    expect(result.isHtml).toBe(true);
  });

  it("falls back to markdown content when html_content is undefined", () => {
    const result = getArticleContent(baseArticle);
    expect(result.content).toBe("# Test\n\nMarkdown content.");
    expect(result.isHtml).toBe(false);
  });

  it("falls back to markdown content when html_content is empty string", () => {
    const article: ArticleInfo = {
      ...baseArticle,
      html_content: "",
    };
    const result = getArticleContent(article);
    expect(result.content).toBe("# Test\n\nMarkdown content.");
    expect(result.isHtml).toBe(false);
  });
});

describe("isArticleLive", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns true when article URL responds with 200", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true } as Response);

    const result = await isArticleLive("https://guoliu.github.io", "writings/reviews/tools-for-thought/");
    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://guoliu.github.io/writings/reviews/tools-for-thought/",
      { method: "HEAD" }
    );
  });

  it("returns false when article URL responds with 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    const result = await isArticleLive("https://guoliu.github.io", "writings/reviews/new-article/");
    expect(result).toBe(false);
  });

  it("returns false when fetch throws (network error)", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));

    const result = await isArticleLive("https://guoliu.github.io", "writings/reviews/new-article/");
    expect(result).toBe(false);
  });

  it("handles trailing slash on siteUrl and leading slash on articlePath", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true } as Response);

    await isArticleLive("https://guoliu.github.io/", "/writings/reviews/test/");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://guoliu.github.io/writings/reviews/test/",
      { method: "HEAD" }
    );
  });

  it("handles siteUrl without trailing slash and articlePath without leading slash", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true } as Response);

    await isArticleLive("https://guoliu.github.io", "writings/reviews/test/");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://guoliu.github.io/writings/reviews/test/",
      { method: "HEAD" }
    );
  });
});
