import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractAssetUuid,
  escapeRegex,
  buildAssetUrlPattern,
  replaceAssetUrls,
  replaceImageWithWikilink,
  replaceImageUrlWithWikilink,
  calculateRelativePath,
} from "../downloader";

// Note: The downloader module heavily depends on:
// 1. window.__TAURI__ for file operations
// 2. global fetch for HTTP requests
// 3. Other utils functions
//
// Full integration tests would require mocking these. Here we test
// the module's structure and any pure logic that can be extracted.

describe("Downloader Module", () => {
  describe("Module Structure", () => {
    it("exports downloadMediaAndUpdate function", async () => {
      const module = await import("../downloader");
      expect(typeof module.downloadMediaAndUpdate).toBe("function");
    });

    it("exports rewriteAllInternalLinks function", async () => {
      const module = await import("../downloader");
      expect(typeof module.rewriteAllInternalLinks).toBe("function");
    });
  });

  describe("Constants", () => {
    // These are internal constants, but we can verify the module loads correctly
    it("module loads without errors", async () => {
      await expect(import("../downloader")).resolves.toBeDefined();
    });
  });
});

describe("extractAssetUuid", () => {
  it("extracts UUID from assets.matters.news URL", () => {
    const url = "https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/141562277039-pic-hd.jpg";
    expect(extractAssetUuid(url)).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });

  it("extracts UUID from imagedelivery.net URL", () => {
    const url = "https://imagedelivery.net/kDRCweMmqLnTPNlbum-pYA/prod/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/141562277039-pic-hd.jpg/public";
    expect(extractAssetUuid(url)).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });

  it("extracts UUID without filename suffix", () => {
    const url = "https://assets.matters.news/embed/8ef4fb5d-ae3f-4e10-826b-169b0762d555.png";
    expect(extractAssetUuid(url)).toBe("8ef4fb5d-ae3f-4e10-826b-169b0762d555");
  });

  it("handles uppercase UUIDs", () => {
    const url = "https://example.com/66296200-DE80-43F1-A1A2-CE2B1403A3E2.jpg";
    expect(extractAssetUuid(url)).toBe("66296200-DE80-43F1-A1A2-CE2B1403A3E2");
  });

  it("returns null for URL without UUID", () => {
    const url = "https://example.com/image.jpg";
    expect(extractAssetUuid(url)).toBeNull();
  });

  it("returns null for malformed UUID", () => {
    const url = "https://example.com/66296200-de80-43f1-a1a2.jpg"; // Missing last segment
    expect(extractAssetUuid(url)).toBeNull();
  });

  it("returns first UUID if multiple present", () => {
    const url = "https://example.com/66296200-de80-43f1-a1a2-ce2b1403a3e2/8ef4fb5d-ae3f-4e10-826b-169b0762d555.png";
    expect(extractAssetUuid(url)).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });
});

describe("escapeRegex", () => {
  it("escapes dots", () => {
    expect(escapeRegex("file.png")).toBe("file\\.png");
  });

  it("escapes special regex characters", () => {
    expect(escapeRegex("test.*+?^${}()|[]\\")).toBe("test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("leaves alphanumeric and hyphens unchanged", () => {
    expect(escapeRegex("66296200-de80-43f1-a1a2-ce2b1403a3e2")).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });

  it("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

describe("buildAssetUrlPattern", () => {
  it("creates pattern that matches assets.matters.news URL", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const url = "https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/file.jpg";
    expect(pattern.test(url)).toBe(true);
  });

  it("creates pattern that matches imagedelivery.net URL", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const url = "https://imagedelivery.net/kDRCweMmqLnTPNlbum-pYA/prod/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/public";
    expect(pattern.test(url)).toBe(true);
  });

  it("does not match URL with different UUID", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const url = "https://assets.matters.news/embed/8ef4fb5d-ae3f-4e10-826b-169b0762d555.png";
    expect(pattern.test(url)).toBe(false);
  });

  it("does not match non-URL text containing UUID", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const text = "The asset ID is 66296200-de80-43f1-a1a2-ce2b1403a3e2";
    expect(pattern.test(text)).toBe(false);
  });

  it("stops at markdown image closing paren", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const markdown = "![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg)*caption*";
    const match = markdown.match(pattern);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg");
  });
});

describe("replaceAssetUrls", () => {
  const assetId = "66296200-de80-43f1-a1a2-ce2b1403a3e2";
  const localPath = "assets/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg";

  it("replaces assets.matters.news URL in markdown", () => {
    const content = "![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/file.jpg)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![](${localPath})`);
  });

  it("replaces imagedelivery.net URL in markdown", () => {
    const content = "![](https://imagedelivery.net/xxx/prod/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/public)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![](${localPath})`);
  });

  it("replaces multiple occurrences", () => {
    const content = `
![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg)
Some text
![](https://imagedelivery.net/xxx/66296200-de80-43f1-a1a2-ce2b1403a3e2/public)
`.trim();
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`
![](${localPath})
Some text
![](${localPath})
`.trim());
  });

  it("returns replaced=false when no match", () => {
    const content = "![](https://example.com/other-image.jpg)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(false);
    expect(result.content).toBe(content);
  });

  it("preserves surrounding content", () => {
    const content = "Before ![alt](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg)*caption* After";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`Before ![alt](${localPath})*caption* After`);
  });

  it("handles URL without extension", () => {
    const content = "![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![](${localPath})`);
  });
});

describe("replaceImageWithWikilink", () => {
  const assetId = "66296200-de80-43f1-a1a2-ce2b1403a3e2";
  const filename = "66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg";

  it("replaces the WHOLE image token with a filename-only wikilink (B2)", () => {
    const content = "![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/file.jpg)";
    const result = replaceImageWithWikilink(content, assetId, filename);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![[${filename}]]`);
    // No residual relative-markdown wrapper.
    expect(result.content).not.toContain("](");
  });

  it("drops alt text and the CDN URL (depth-independent ![[file]])", () => {
    const content = "before ![some alt](https://imagedelivery.net/xxx/prod/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/public) after";
    const result = replaceImageWithWikilink(content, assetId, filename);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`before ![[${filename}]] after`);
  });

  it("handles a markdown title attribute ![alt](url \"title\") (htmd emits these)", () => {
    const content = `![cap](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/file.jpg "A caption")`;
    const result = replaceImageWithWikilink(content, assetId, filename);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![[${filename}]]`);
    expect(result.content).not.toContain("https://"); // CDN url fully removed
  });

  it("returns replaced=false when the asset id is absent", () => {
    const content = "![](https://example.com/other.jpg)";
    const result = replaceImageWithWikilink(content, assetId, filename);
    expect(result.replaced).toBe(false);
    expect(result.content).toBe(content);
  });
});

describe("replaceImageUrlWithWikilink (B6 — legacy non-UUID assets)", () => {
  // A legacy cloudfront URL with no UUID segment to key on.
  const url = "https://d1y0vy6cjcgwlk.cloudfront.net/legacy/photo.jpg";
  const filename = "photo.jpg";

  it("replaces the whole image token for an exact non-UUID URL", () => {
    const content = `before ![cap](${url}) after`;
    const result = replaceImageUrlWithWikilink(content, url, filename);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`before ![[${filename}]] after`);
    expect(result.content).not.toContain("cloudfront.net");
  });

  it("handles an htmd title trailer ![alt](url \"title\")", () => {
    const content = `![cap](${url} "A caption")`;
    const result = replaceImageUrlWithWikilink(content, url, filename);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![[${filename}]]`);
  });

  it("only matches the exact URL, not a different one", () => {
    const content = "![](https://d1y0vy6cjcgwlk.cloudfront.net/legacy/other.jpg)";
    const result = replaceImageUrlWithWikilink(content, url, filename);
    expect(result.replaced).toBe(false);
    expect(result.content).toBe(content);
  });
});

describe("calculateRelativePath", () => {
  it("returns asset path directly for root-level markdown", () => {
    // Markdown at root, asset in assets/
    expect(calculateRelativePath("article.md", "assets/image.png")).toBe("assets/image.png");
  });

  it("calculates path from nested markdown to assets", () => {
    // Markdown in 文章/, asset in assets/
    expect(calculateRelativePath("文章/article.md", "assets/image.png")).toBe("../assets/image.png");
  });

  it("calculates path from deeply nested markdown to assets", () => {
    // Markdown in a/b/c/, asset in assets/
    expect(calculateRelativePath("a/b/c/article.md", "assets/image.png")).toBe("../../../assets/image.png");
  });

  it("handles markdown and asset in same directory", () => {
    // Both in same directory
    expect(calculateRelativePath("folder/article.md", "folder/image.png")).toBe("image.png");
  });

  it("handles markdown in subdirectory of assets parent", () => {
    // Markdown in assets/docs/, asset in assets/
    expect(calculateRelativePath("assets/docs/article.md", "assets/image.png")).toBe("../image.png");
  });

  it("handles two-level nesting with Chinese characters", () => {
    // Real-world case with Chinese directory names
    expect(calculateRelativePath("刘果/文章/ipfs開發者大會記錄.md", "assets/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg"))
      .toBe("../../assets/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg");
  });
});

// Note: withTimeout was removed - timeout handling is now done by Rust side
// (tokio::time::timeout with Semaphore for concurrency control)

// ============================================================================
// Integration Tests with Mock Tauri
// ============================================================================

import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";

describe("downloadMediaAndUpdate - partial completion", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("updates file references for successfully downloaded images", async () => {
    // Set up a markdown file with 2 images
    const uuid1 = "aaaaaaaa-1111-1111-1111-111111111111";
    const uuid2 = "bbbbbbbb-2222-2222-2222-222222222222";
    const markdownContent = `---
title: "Test Article"
---

# Article

![](https://assets.matters.news/embed/${uuid1}.jpg)

Some text

![](https://assets.matters.news/embed/${uuid2}.jpg)
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/article.md`, markdownContent);

    // Configure URL responses - uuid1 succeeds, uuid2 fails with 404
    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid1}.jpg`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 1024,
      actualPath: `assets/${uuid1}.jpg`,
    });
    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid2}.jpg`, {
      status: 404,
      ok: false,
      contentType: null,
      bytesWritten: 0,
      actualPath: "",
    });

    // Run the download and update function, capturing progress reports
    const { downloadMediaAndUpdate } = await import("../downloader");
    const onProgress = vi.fn();
    const result = await downloadMediaAndUpdate(onProgress);

    // Verify: 1 image downloaded, 1 error
    expect(result.imagesDownloaded).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);

    // Media-download progress is forwarded to the unified task via onProgress
    // (replacing the legacy reportProgress path the panel dropped) so the
    // import hairline advances through the heaviest phase.
    expect(onProgress).toHaveBeenCalledWith(
      "downloading_media",
      expect.any(Number),
      100,
      expect.any(String),
    );
    // …and the reported overall value is a real (non-zero) fraction of the band,
    // not a constant 0 — the reporter is actually carrying progress.
    const mediaCall = onProgress.mock.calls.find((c) => c[0] === "downloading_media");
    expect(mediaCall?.[1]).toBeGreaterThan(0);

    // The failed image's SOURCE URL is surfaced for a per-image advisory (so
    // the user sees which image broke, not an opaque "1 failed" count).
    expect(result.failedImageUrls).toContain(
      `https://assets.matters.news/embed/${uuid2}.jpg`,
    );
    // The successful image is NOT listed as failed.
    expect(result.failedImageUrls).not.toContain(
      `https://assets.matters.news/embed/${uuid1}.jpg`,
    );

    // Verify: File was modified to update successful reference
    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/article.md`)?.content;
    expect(updatedContent).toBeDefined();

    // UUID1 should be replaced with a filename-only wikilink (B2)
    expect(updatedContent).toContain(`![[${uuid1}.jpg]]`);
    expect(updatedContent).not.toContain(`https://assets.matters.news/embed/${uuid1}.jpg`);

    // UUID2 should remain as remote URL (download failed)
    expect(updatedContent).toContain(`https://assets.matters.news/embed/${uuid2}.jpg`);
  });

  it("tracks downloaded UUIDs correctly in map", async () => {
    const uuid = "cccccccc-3333-3333-3333-333333333333";
    const markdownContent = `---
title: "Test"
---

![](https://assets.matters.news/embed/${uuid}.png)
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/test.md`, markdownContent);

    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid}.png`, {
      status: 200,
      ok: true,
      contentType: "image/png",
      bytesWritten: 512,
      actualPath: `assets/${uuid}.png`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    expect(result.imagesDownloaded).toBe(1);
    expect(result.filesProcessed).toBe(1);

    // Verify the file was updated
    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/test.md`)?.content;
    expect(updatedContent).toContain(`![[${uuid}.png]]`);
  });

  it("handles file in subdirectory with a depth-independent wikilink", async () => {
    const uuid = "dddddddd-4444-4444-4444-444444444444";
    const markdownContent = `---
title: "Nested Article"
---

![](https://assets.matters.news/embed/${uuid}.jpg)
`;
    // File in nested directory
    ctx.filesystem.setFile(`${ctx.projectPath}/文章/游记/article.md`, markdownContent);

    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid}.jpg`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 2048,
      actualPath: `assets/${uuid}.jpg`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    expect(result.imagesDownloaded).toBe(1);

    // Wikilink is depth-INDEPENDENT: identical at any nesting, no `../` chain.
    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/文章/游记/article.md`)?.content;
    expect(updatedContent).toContain(`![[${uuid}.jpg]]`);
    expect(updatedContent).not.toContain("../");
  });

  it("skips already existing assets", async () => {
    const existingUuid = "eeeeeeee-5555-5555-5555-555555555555";
    const newUuid = "ffffffff-6666-6666-6666-666666666666";

    const markdownContent = `---
title: "Test"
---

![](https://assets.matters.news/embed/${existingUuid}.jpg)
![](https://assets.matters.news/embed/${newUuid}.jpg)
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/article.md`, markdownContent);

    // Simulate existing asset on disk
    ctx.filesystem.setFile(`${ctx.projectPath}/assets/${existingUuid}.jpg`, "[binary image data]");

    // Only configure the new UUID
    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${newUuid}.jpg`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 1024,
      actualPath: `assets/${newUuid}.jpg`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    // Only 1 new download (existing was skipped)
    expect(result.imagesDownloaded).toBe(1);
    expect(result.imagesSkipped).toBe(1);
  });

  it("updates cover reference in frontmatter", async () => {
    const uuid = "11111111-aaaa-bbbb-cccc-dddddddddddd";
    const markdownContent = `---
title: "Article with Cover"
cover: "https://imagedelivery.net/xxx/prod/embed/${uuid}.jpeg/public"
---

# Content
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/article.md`, markdownContent);

    ctx.urlConfig.setResponse(`https://imagedelivery.net/xxx/prod/embed/${uuid}.jpeg/public`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 4096,
      actualPath: `assets/${uuid}.jpg`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    expect(result.imagesDownloaded).toBe(1);
    expect(result.filesProcessed).toBe(1);

    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/article.md`)?.content;
    // Cover → bare filename (the shared asset resolver finds it); no path prefix.
    expect(updatedContent).toContain(`${uuid}.jpg`);
    expect(updatedContent).not.toContain("imagedelivery.net");
    expect(updatedContent).not.toContain("assets/");
  });

  it("updates references when asset already exists (self-correcting)", async () => {
    // This test reproduces the production bug:
    // 1. Asset was downloaded in a previous run (exists on disk)
    // 2. But the file still has remote URL (previous run was interrupted)
    // 3. Running again should update the reference even though download is skipped
    const uuid = "2ef1d558-bca4-4792-bb63-41ee12fa95ac";
    const markdownContent = `---
title: "色达"
---

![](https://assets.matters.news/embed/${uuid}.jpeg)
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/文章/游记/色达.md`, markdownContent);

    // Asset already exists on disk (from previous interrupted run)
    ctx.filesystem.setFile(`${ctx.projectPath}/assets/${uuid}.jpg`, "[binary image data]");

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    // Asset should be skipped (already exists), not downloaded
    expect(result.imagesDownloaded).toBe(0);
    expect(result.imagesSkipped).toBe(1);

    // But file should still be updated with local path
    expect(result.filesProcessed).toBe(1);

    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/文章/游记/色达.md`)?.content;
    expect(updatedContent).toBeDefined();
    // Depth-independent wikilink (asset on disk is .jpg though the URL was .jpeg).
    expect(updatedContent).toContain(`![[${uuid}.jpg]]`);
    expect(updatedContent).not.toContain(`https://assets.matters.news/embed/${uuid}.jpeg`);
  });

  it("updates multiple references when multiple assets already exist", async () => {
    // Same scenario but with multiple images
    const uuid1 = "aaaa1111-1111-1111-1111-111111111111";
    const uuid2 = "bbbb2222-2222-2222-2222-222222222222";
    const uuid3 = "cccc3333-3333-3333-3333-333333333333";

    const markdownContent = `---
title: "Multi Image Article"
cover: "https://assets.matters.news/embed/${uuid1}.jpg"
---

![](https://assets.matters.news/embed/${uuid2}.png)

Some text

![](https://assets.matters.news/embed/${uuid3}.jpeg)
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/nested/dir/article.md`, markdownContent);

    // All 3 assets exist on disk
    ctx.filesystem.setFile(`${ctx.projectPath}/assets/${uuid1}.jpg`, "[image 1]");
    ctx.filesystem.setFile(`${ctx.projectPath}/assets/${uuid2}.png`, "[image 2]");
    ctx.filesystem.setFile(`${ctx.projectPath}/assets/${uuid3}.jpeg`, "[image 3]");

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    // All 3 skipped, none downloaded
    expect(result.imagesDownloaded).toBe(0);
    expect(result.imagesSkipped).toBe(3);

    // File should be updated
    expect(result.filesProcessed).toBe(1);

    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/nested/dir/article.md`)?.content;
    expect(updatedContent).toBeDefined();

    // cover → bare filename; body images → depth-independent wikilinks.
    expect(updatedContent).toContain(`${uuid1}.jpg`);
    expect(updatedContent).toContain(`![[${uuid2}.png]]`);
    expect(updatedContent).toContain(`![[${uuid3}.jpeg]]`);
    expect(updatedContent).not.toContain("../");

    // None should have remote URLs
    expect(updatedContent).not.toContain("https://assets.matters.news");
  });

  it("should NOT write file when all references are already local paths", async () => {
    // This is the key test for Issue #5: Media download writes files unnecessarily
    // If all image references are already local, the file should NOT be written
    const uuid = "12345678-1234-1234-1234-123456789abc";

    // Markdown file with ALREADY LOCAL references (no remote URLs at all)
    const markdownContent = `---
title: "Already Localized Article"
cover: "assets/${uuid}.jpg"
---

![](assets/${uuid}.jpg)

Already using local path.
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/article.md`, markdownContent);

    // Asset exists on disk
    ctx.filesystem.setFile(`${ctx.projectPath}/assets/${uuid}.jpg`, "[binary image data]");

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    // No downloads (no remote URLs to download)
    expect(result.imagesDownloaded).toBe(0);
    // No files should be skipped (no remote URLs to check)
    expect(result.imagesSkipped).toBe(0);
    // File should NOT be processed (no changes needed)
    expect(result.filesProcessed).toBe(0);
  });

  it("localizes a legacy non-UUID CDN image (B6)", async () => {
    // A legacy cloudfront URL with NO UUID segment — previously Phase 3 skipped
    // it (`if (!media.uuid) continue;`), leaving the dead CDN URL in the body.
    const legacyUrl = "https://d1y0vy6cjcgwlk.cloudfront.net/legacy/photo.jpg";
    const markdownContent = `---
title: "Legacy Image Article"
---

![a caption](${legacyUrl})
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/文章/old-post.md`, markdownContent);

    // The download succeeds; moss derives a local filename for the non-UUID asset.
    ctx.urlConfig.setResponse(legacyUrl, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 1024,
      actualPath: "assets/photo.jpg",
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    expect(result.imagesDownloaded).toBe(1);
    expect(result.filesProcessed).toBe(1);

    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/文章/old-post.md`)?.content;
    expect(updatedContent).toBeDefined();
    // The legacy image is now a depth-independent wikilink; the CDN URL is gone.
    expect(updatedContent).toContain("![[photo.jpg]]");
    expect(updatedContent).not.toContain("cloudfront.net");
    expect(updatedContent).not.toContain("../");
  });

  it("should not write file if replacement results in identical content", async () => {
    // This tests the scenario where:
    // 1. File still has remote URL
    // 2. Asset exists on disk
    // 3. Replacement would result in same content (edge case)
    const uuid = "87654321-4321-4321-4321-987654321abc";

    // File with remote URL, but the "replacement" local path is identical to what's there
    // This is a contrived case but tests the comparison logic
    const markdownContent = `---
title: "Article"
cover: "../../assets/${uuid}.jpg"
---

![](../../assets/${uuid}.jpg)
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/nested/dir/article.md`, markdownContent);

    // Asset exists on disk
    ctx.filesystem.setFile(`${ctx.projectPath}/assets/${uuid}.jpg`, "[binary image data]");

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    // File should NOT be processed (content unchanged after any attempted replacements)
    expect(result.filesProcessed).toBe(0);
  });
});

// ============================================================================
// Permanent-failure memo (failed-media.json) integration tests
// ============================================================================

describe("downloadMediaAndUpdate - permanent-failure memo", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("(a) a non-retryable 403 writes failed-media.json with url and filePaths", async () => {
    const uuid = "aaaa0403-0000-0000-0000-000000000403";
    const url = `https://assets.matters.news/embed/${uuid}.jpg`;
    const markdownContent = `---
title: "403 Article"
---

![](${url})
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/article.md`, markdownContent);

    ctx.urlConfig.setResponse(url, {
      status: 403,
      ok: false,
      contentType: null,
      bytesWritten: 0,
      actualPath: "",
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    // The URL must appear in failedImageUrls (existing behaviour preserved)
    expect(result.failedImageUrls).toContain(url);

    // A failed-media.json must have been written
    const memoPath = `${ctx.projectPath}/.moss/plugins/test-plugin/failed-media.json`;
    const memoFile = ctx.filesystem.getFile(memoPath);
    expect(memoFile).toBeDefined();

    const entries = JSON.parse(memoFile!.content) as Array<{ url: string; filePaths: string[]; failedAt: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe(url);
    expect(entries[0].filePaths).toEqual(["posts/article.md"]);
    // failedAt is a valid ISO timestamp (parses to a real Date).
    expect(Number.isNaN(new Date(entries[0].failedAt).getTime())).toBe(false);
  });

  it("(a2) a dead URL referenced by MULTIPLE articles records ALL filePaths", async () => {
    const uuid = "aaaa0410-0000-0000-0000-000000000410";
    const url = `https://assets.matters.news/embed/${uuid}.jpg`;
    const md = `---
title: "Shared Dead Image"
---

![](${url})
`;
    // Two distinct articles reference the SAME dead URL.
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/one.md`, md);
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/two.md`, md);

    ctx.urlConfig.setResponse(url, {
      status: 410,
      ok: false,
      contentType: null,
      bytesWritten: 0,
      actualPath: "",
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    await downloadMediaAndUpdate();

    const memoPath = `${ctx.projectPath}/.moss/plugins/test-plugin/failed-media.json`;
    const memoFile = ctx.filesystem.getFile(memoPath);
    expect(memoFile).toBeDefined();
    const entries = JSON.parse(memoFile!.content) as Array<{ url: string; filePaths: string[] }>;
    expect(entries).toHaveLength(1);
    // Both referencing articles are recorded (order-independent).
    expect([...entries[0].filePaths].sort()).toEqual(["posts/one.md", "posts/two.md"]);
  });

  it("(b) a URL already in failed-media.json is skipped: no network attempt, imagesSkipped increments, not in failedImageUrls", async () => {
    const uuid = "bbbb0404-0000-0000-0000-000000000404";
    const url = `https://assets.matters.news/embed/${uuid}.jpg`;
    const markdownContent = `---
title: "Already Known Dead"
---

![](${url})
`;
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/dead.md`, markdownContent);

    // Pre-populate the memo with this URL
    const memoPath = `${ctx.projectPath}/.moss/plugins/test-plugin/failed-media.json`;
    ctx.filesystem.setFile(
      memoPath,
      JSON.stringify([
        { url, filePaths: ["posts/dead.md"], failedAt: "2026-06-01T00:00:00.000Z" },
      ])
    );

    // The mock's DEFAULT response for an unconfigured URL is 200 OK. If the
    // memo-skip were broken and the downloader attempted a network call, the
    // image would DOWNLOAD successfully → imagesDownloaded would be 1 and
    // imagesSkipped 0, FAILING the assertions below. That is the correct
    // regression signal: these assertions prove no network attempt was made.
    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate();

    // URL was memo-skipped: counts as skipped, NOT a new error/failedImageUrl
    expect(result.imagesSkipped).toBeGreaterThanOrEqual(1);
    expect(result.failedImageUrls).not.toContain(url);
    // And definitely not downloaded
    expect(result.imagesDownloaded).toBe(0);
  });

  it("(c) a transient 503 failure is NOT memoized as permanent", async () => {
    // Fake timers so the 3 retry sleeps (Fibonacci 1s+1s) resolve instantly
    // instead of burning ~2s of real wall-clock time.
    vi.useFakeTimers();
    try {
      const uuid = "cccc0503-0000-0000-0000-000000000503";
      const url = `https://assets.matters.news/embed/${uuid}.jpg`;
      const markdownContent = `---
title: "Transient Failure"
---

![](${url})
`;
      ctx.filesystem.setFile(`${ctx.projectPath}/posts/transient.md`, markdownContent);

      // 503 is a retryable status; all 3 attempts fail
      ctx.urlConfig.setResponse(url, [
        { status: 503, ok: false, contentType: null, bytesWritten: 0, actualPath: "" },
        { status: 503, ok: false, contentType: null, bytesWritten: 0, actualPath: "" },
        { status: 503, ok: false, contentType: null, bytesWritten: 0, actualPath: "" },
      ]);

      const { downloadMediaAndUpdate } = await import("../downloader");
      // Kick off the download, then drain all pending timers (the retry sleeps)
      // so the promise resolves without real-time delay.
      const pending = downloadMediaAndUpdate();
      await vi.runAllTimersAsync();
      const result = await pending;

      // The URL is a failure (appears in failedImageUrls)
      expect(result.failedImageUrls).toContain(url);

      // But NO failed-media.json should have been written (transient errors are
      // not permanent — the server may recover on the next build)
      const memoPath = `${ctx.projectPath}/.moss/plugins/test-plugin/failed-media.json`;
      const memoFile = ctx.filesystem.getFile(memoPath);
      expect(memoFile).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
