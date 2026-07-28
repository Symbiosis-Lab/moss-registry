import { describe, it, expect } from "vitest";
import { isDraftUrl, looksLikePublishedArticleUrl } from "../url-detect";

describe("matters url-detect", () => {
  describe("isDraftUrl", () => {
    it("recognizes the draft editor URL", () => {
      expect(isDraftUrl("https://matters.town/me/drafts/abc123")).toBe(true);
      expect(isDraftUrl("https://matters.town/me/drafts/xzy-987-xyz")).toBe(true);
    });

    it("rejects non-draft URLs", () => {
      expect(isDraftUrl("https://matters.town/@guo/some-post-a1b2c3")).toBe(false);
      expect(isDraftUrl("https://matters.town/")).toBe(false);
      expect(isDraftUrl("https://matters.town/login")).toBe(false);
      expect(isDraftUrl("https://matters.town/@guo")).toBe(false);
    });
  });

  describe("looksLikePublishedArticleUrl", () => {
    it("recognizes a published article URL with hash suffix", () => {
      // Positive: /@user/slug-hash (6+ alphanumeric chars at end)
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo/some-post-a1b2c3")).toBe(true);
      expect(looksLikePublishedArticleUrl("https://matters.town/@alice/my-article-xyz789")).toBe(true);
      expect(looksLikePublishedArticleUrl("https://matters.town/@bob/hello-world-abcdef")).toBe(true);
    });

    it("rejects a draft URL", () => {
      expect(looksLikePublishedArticleUrl("https://matters.town/me/drafts/abc123")).toBe(false);
    });

    it("rejects home URL", () => {
      expect(looksLikePublishedArticleUrl("https://matters.town/")).toBe(false);
    });

    it("rejects login URL", () => {
      expect(looksLikePublishedArticleUrl("https://matters.town/login")).toBe(false);
    });

    it("rejects bare profile root (no article path)", () => {
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo")).toBe(false);
    });

    it("rejects /@user/followers (profile sub-page, no hash)", () => {
      // "followers" has no numeric suffix — fails the hash requirement
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo/followers")).toBe(false);
    });

    it("rejects /@user/settings (profile sub-page, no hash)", () => {
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo/settings")).toBe(false);
    });

    it("rejects /@user/bookmarks (profile sub-page, no hash)", () => {
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo/bookmarks")).toBe(false);
    });

    it("rejects a slug without the hash suffix (fewer than 6 alphanumeric chars)", () => {
      // "abc" is only 3 chars — below the 6-char minimum
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo/no-hash-abc")).toBe(false);
    });

    it("requires the hash to be at the end after a dash", () => {
      // A slug like "pure-text-only" has no trailing hash segment
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo/pure-text-only")).toBe(false);
    });

    it("known false-trigger: /@user/tags-abcdef returns true (accepted, caught by API verify)", () => {
      // /@guo/tags-abcdef passes the regex because its final path segment ends
      // in "-<6+ alnum>". This is an intentionally accepted false-positive: the
      // regex cannot cheaply distinguish article slugs from profile sub-pages
      // whose names happen to end in a hash-like suffix. The caller (the matters
      // plugin sync check) always verifies the candidate URL against the Matters
      // API (draft.article); the API rejects non-article paths, so this false-
      // trigger is harmless in practice. Do NOT change the regex to reject this
      // case — the cure would be worse than the disease (over-fitting to a URL
      // shape that Matters can change at any time).
      expect(looksLikePublishedArticleUrl("https://matters.town/@guo/tags-abcdef")).toBe(true);
    });
  });
});
