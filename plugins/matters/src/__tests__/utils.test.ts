import { describe, it, expect } from "vitest";
import {
  slugify,
  simpleHash,
  generateLocalFilename,
  getExtensionFromContentType,
  uint8ArrayToBase64,
  formatArticleSyncSummary,
} from "../utils";

describe("formatArticleSyncSummary", () => {
  it("leads with the noun for the all-unchanged run (the opaque '5 unchanged' case)", () => {
    expect(formatArticleSyncSummary({ created: 0, updated: 0, skipped: 5, failed: 0 })).toBe(
      "5 articles already up to date",
    );
  });

  it("uses the singular noun for one article", () => {
    expect(formatArticleSyncSummary({ created: 0, updated: 0, skipped: 1, failed: 0 })).toBe(
      "1 article already up to date",
    );
  });

  it("shows the total then the changed breakdown for a mixed run", () => {
    expect(formatArticleSyncSummary({ created: 3, updated: 2, skipped: 5, failed: 0 })).toBe(
      "10 articles: 3 new, 2 updated, 5 unchanged",
    );
  });

  it("omits zero-count segments", () => {
    expect(formatArticleSyncSummary({ created: 4, updated: 0, skipped: 0, failed: 0 })).toBe(
      "4 articles: 4 new",
    );
  });

  it("reports nothing-to-do plainly", () => {
    expect(formatArticleSyncSummary({ created: 0, updated: 0, skipped: 0, failed: 0 })).toBe(
      "no articles to sync",
    );
  });

  it("appends a failure count as a separate cohort when some synced and some failed", () => {
    expect(formatArticleSyncSummary({ created: 5, updated: 0, skipped: 0, failed: 2 })).toBe(
      "5 articles: 5 new, 2 failed to sync",
    );
  });

  it("keeps the failure cohort distinct from an all-unchanged set (no 'up to date, 2 failed' ambiguity)", () => {
    expect(formatArticleSyncSummary({ created: 0, updated: 0, skipped: 5, failed: 2 })).toBe(
      "5 articles already up to date, 2 failed to sync",
    );
  });

  it("reports a fully-failed run without a misleading 'synced' noun", () => {
    expect(formatArticleSyncSummary({ created: 0, updated: 0, skipped: 0, failed: 3 })).toBe(
      "3 articles failed to sync",
    );
  });
});

describe("slugify", () => {
  it("converts simple text to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello! World?")).toBe("hello-world");
  });

  it("handles multiple spaces", () => {
    expect(slugify("Hello   World")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("preserves CJK characters", () => {
    expect(slugify("你好世界")).toBe("你好世界");
    expect(slugify("Hello 世界")).toBe("hello-世界");
  });

  it("preserves Cyrillic characters", () => {
    expect(slugify("Привет мир")).toBe("привет-мир");
  });

  it("preserves Arabic characters", () => {
    expect(slugify("مرحبا بالعالم")).toBe("مرحبا-بالعالم");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles numbers", () => {
    expect(slugify("Test 123")).toBe("test-123");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("Hello---World")).toBe("hello-world");
  });
});

describe("simpleHash", () => {
  it("returns consistent hash for same input", () => {
    const hash1 = simpleHash("test");
    const hash2 = simpleHash("test");
    expect(hash1).toBe(hash2);
  });

  it("returns different hash for different inputs", () => {
    const hash1 = simpleHash("test1");
    const hash2 = simpleHash("test2");
    expect(hash1).not.toBe(hash2);
  });

  it("returns hexadecimal string", () => {
    const hash = simpleHash("test");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("handles empty string", () => {
    const hash = simpleHash("");
    expect(hash).toBe("0");
  });
});

describe("generateLocalFilename", () => {
  it("extracts filename with extension from URL", () => {
    expect(
      generateLocalFilename("https://example.com/images/photo.jpg")
    ).toBe("photo.jpg");
  });

  it("extracts UUID-based filename", () => {
    expect(
      generateLocalFilename(
        "https://cdn.example.com/550e8400-e29b-41d4-a716-446655440000/image.png"
      )
    ).toBe("550e8400-e29b-41d4-a716-446655440000.png");
  });

  it("handles UUID without extension", () => {
    expect(
      generateLocalFilename(
        "https://cdn.example.com/550e8400-e29b-41d4-a716-446655440000"
      )
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("removes /public suffix", () => {
    expect(
      generateLocalFilename("https://cdn.example.com/image.jpg/public")
    ).toBe("image.jpg");
  });

  it("falls back to hash for URLs without filename", () => {
    const result = generateLocalFilename("https://example.com/");
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("returns null for invalid URLs", () => {
    expect(generateLocalFilename("not-a-url")).toBeNull();
  });
});

describe("getExtensionFromContentType", () => {
  it("returns jpg for image/jpeg", () => {
    expect(getExtensionFromContentType("image/jpeg")).toBe("jpg");
  });

  it("returns jpg for image/jpg", () => {
    expect(getExtensionFromContentType("image/jpg")).toBe("jpg");
  });

  it("returns png for image/png", () => {
    expect(getExtensionFromContentType("image/png")).toBe("png");
  });

  it("returns gif for image/gif", () => {
    expect(getExtensionFromContentType("image/gif")).toBe("gif");
  });

  it("returns webp for image/webp", () => {
    expect(getExtensionFromContentType("image/webp")).toBe("webp");
  });

  it("returns svg for image/svg+xml", () => {
    expect(getExtensionFromContentType("image/svg+xml")).toBe("svg");
  });

  it("handles content-type with charset", () => {
    expect(getExtensionFromContentType("image/png; charset=utf-8")).toBe("png");
  });

  it("returns null for unknown content types", () => {
    expect(getExtensionFromContentType("application/json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getExtensionFromContentType("")).toBeNull();
  });
});

describe("uint8ArrayToBase64", () => {
  it("converts small arrays correctly", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(uint8ArrayToBase64(bytes)).toBe("SGVsbG8=");
  });

  it("handles empty array", () => {
    const bytes = new Uint8Array([]);
    expect(uint8ArrayToBase64(bytes)).toBe("");
  });

  it("handles large arrays without stack overflow", () => {
    // Create a 100KB array
    const bytes = new Uint8Array(100000);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    // Should not throw
    const result = uint8ArrayToBase64(bytes);
    expect(result.length).toBeGreaterThan(0);
  });
});
