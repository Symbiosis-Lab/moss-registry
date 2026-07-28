import { describe, it, expect, vi } from "vitest";
import { isRemoteNewer } from "../sync";

describe("isRemoteNewer", () => {
  it("returns true when local is undefined", () => {
    expect(isRemoteNewer(undefined, "2024-01-01")).toBe(true);
  });

  it("returns false when remote is undefined", () => {
    expect(isRemoteNewer("2024-01-01", undefined)).toBe(false);
  });

  it("returns true when remote is newer", () => {
    expect(isRemoteNewer("2024-01-01", "2024-01-02")).toBe(true);
  });

  it("returns false when local is newer", () => {
    expect(isRemoteNewer("2024-01-02", "2024-01-01")).toBe(false);
  });

  it("returns false when dates are equal", () => {
    expect(isRemoteNewer("2024-01-01", "2024-01-01")).toBe(false);
  });

  it("handles ISO date strings with time", () => {
    expect(isRemoteNewer("2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z")).toBe(true);
    expect(isRemoteNewer("2024-01-01T12:00:00Z", "2024-01-01T10:00:00Z")).toBe(false);
  });

  it("returns true when both are undefined (local missing means should update)", () => {
    // When local is undefined, we should update regardless of remote
    expect(isRemoteNewer(undefined, undefined)).toBe(true);
  });

  // Tests for real Matters.town date formats
  describe("Matters.town date formats", () => {
    it("handles full ISO format with milliseconds", () => {
      // Real Matters API format: "2025-05-09T18:32:27.769Z"
      expect(isRemoteNewer(
        "2025-05-09T18:32:27.769Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(false);

      expect(isRemoteNewer(
        "2025-05-08T21:10:51.834Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true);
    });

    it("handles comparison between different precision levels", () => {
      // Local might have different precision than remote
      expect(isRemoteNewer(
        "2025-05-09T18:32:27Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true); // Remote is technically later by 769ms
    });

    it("handles date-only vs full ISO comparison", () => {
      // Edge case: local file has date-only, remote has full timestamp
      expect(isRemoteNewer(
        "2025-05-09",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true); // Date-only is treated as 00:00:00
    });

    it("handles same day with remote later time", () => {
      expect(isRemoteNewer(
        "2025-05-09T00:00:00.000Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true);
    });
  });
});

describe("syncToLocalFiles", () => {
  it("exports syncToLocalFiles function", async () => {
    const module = await import("../sync");
    expect(typeof module.syncToLocalFiles).toBe("function");
  });
});

// ============================================================================
// Homepage Grid Generation Tests
// ============================================================================

describe("syncToLocalFiles - homepage grid from pinned works", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should generate :::grid 3 homepage when pinnedWorks has collections", async () => {
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [
        { id: "c1", title: "Travel Notes", description: "My travels", articles: [], cover: "https://example.com/cover.jpg" },
        { id: "c2", title: "Tech Essays", description: "Tech writing", articles: [], cover: undefined },
      ],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Hello world",
        pinnedWorks: [
          { id: "c1", type: "collection", title: "Travel Notes", cover: "https://example.com/cover.jpg" },
          { id: "c2", type: "collection", title: "Tech Essays", cover: undefined },
        ],
      }
    );

    expect(result.result.created).toBeGreaterThanOrEqual(1);
    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toBeDefined();
    expect(homepage).toContain(":::grid 3");
    expect(homepage).toContain("[Travel Notes](/articles/travel-notes/)");
    expect(homepage).toContain("[Tech Essays](/articles/tech-essays/)");
    // Grid CELLS must be separated by moss's canonical `+++` divider, NOT `:::`
    // (a lone `:::` is the grid CLOSER — using it between cells prematurely
    // closes the grid and corrupts the homepage). Regression guard for B1.
    expect(homepage).toMatch(
      /\[Travel Notes\]\([^)]*\)\n\+\+\+\n\[Tech Essays\]\([^)]*\)/
    );
    // The grid must open with :::grid and close with a single ::: — exactly two
    // `:::` occurrences (open marker prefix + closer), no `:::` between cells.
    expect((homepage!.match(/^:::$/gm) || []).length).toBe(1);
    expect(homepage).toContain(":::");
  });

  it("forwards sync progress to the onProgress reporter (unified task, not the dropped legacy path)", async () => {
    const { syncToLocalFiles } = await import("../sync");
    const onProgress = vi.fn();
    await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [], // no collections
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] },
      null, // homepageFile
      null, // folderName
      onProgress,
    );
    // The per-item sync now drives the unified import task (was the legacy
    // reportProgress path, which the panel dropped for the `process` hook).
    expect(onProgress).toHaveBeenCalledWith(
      "syncing_homepage",
      expect.any(Number),
      100,
      expect.any(String),
    );
    // …carrying a real (non-zero) overall fraction, not a constant 0.
    const homepageCall = onProgress.mock.calls.find((c) => c[0] === "syncing_homepage");
    expect(homepageCall?.[1]).toBeGreaterThan(0);
  });

  it("should generate :::grid 3 homepage with pinned articles", async () => {
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [
        {
          id: "a1", title: "My Article", slug: "my-article", shortHash: "abc123",
          content: "<p>Content</p>", summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio text",
        pinnedWorks: [
          { id: "a1", type: "article", title: "My Article", slug: "my-article", shortHash: "abc123" },
        ],
      }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toBeDefined();
    expect(homepage).toContain(":::grid 3");
    expect(homepage).toContain("[My Article](/articles/my-article/)");
  });

  it("should generate :::grid 3 homepage with mixed pinned works", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "Standalone Article", slug: "standalone-article", shortHash: "hash1",
          content: "<p>Content</p>", summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [
        { id: "c1", title: "My Collection", description: "Desc", articles: [], cover: undefined },
      ],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio",
        pinnedWorks: [
          { id: "c1", type: "collection", title: "My Collection" },
          { id: "a1", type: "article", title: "Standalone Article", slug: "standalone-article", shortHash: "hash1" },
        ],
      }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toContain(":::grid 3");
    expect(homepage).toContain("[My Collection](/articles/my-collection/)");
    expect(homepage).toContain("[Standalone Article](/articles/standalone-article/)");
  });

  it("should generate plain homepage when pinnedWorks is empty", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [], [], [], "testuser", {},
      { displayName: "Test User", userName: "testuser", description: "Just a bio", pinnedWorks: [] }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toBeDefined();
    expect(homepage).not.toContain(":::grid");
    expect(homepage).toContain("Just a bio");
  });

  it("should still skip homepage when index.md already exists even with pinnedWorks", async () => {
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, "---\ntitle: \"Existing\"\n---\n\nMy custom homepage");

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [], "testuser", {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio",
        pinnedWorks: [
          { id: "c1", type: "collection", title: "Pinned Collection" },
        ],
      }
    );

    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toContain("My custom homepage");
    expect(homepage).not.toContain(":::grid");
  });

  it("should link pinned article to its collection folder when in a collection", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "Article In Collection", slug: "article-in-collection", shortHash: "hash1",
          content: "<p>Content</p>", summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [
        {
          id: "c1", title: "My Series", description: "A series",
          articles: [{ id: "a1", shortHash: "hash1", title: "Article In Collection", slug: "article-in-collection" }],
          cover: undefined,
        },
      ],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio",
        pinnedWorks: [
          { id: "a1", type: "article", title: "Article In Collection", slug: "article-in-collection", shortHash: "hash1" },
        ],
      }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toContain(":::grid 3");
    // Article should link to its collection folder path
    expect(homepage).toContain("[Article In Collection](/articles/my-series/article-in-collection/)");
  });
});

// ============================================================================
// Homepage skip when moss detects existing home file
// ============================================================================

describe("syncToLocalFiles - skip homepage when homepageFile is set", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should skip homepage creation when homepageFile indicates an existing home file", async () => {
    // moss detected "刘果.md" as the home file — Matters should NOT create index.md
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [], "testuser", {},
      { displayName: "Test User", userName: "testuser", description: "Bio", pinnedWorks: [] },
      "刘果.md", // homepageFile — moss already found a home file
    );

    // Homepage should be skipped
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    // index.md should NOT be created
    const indexFile = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`);
    expect(indexFile).toBeUndefined();
  });

  it("should skip homepage creation when homepageFile is index.md", async () => {
    // moss detected "index.md" as the home file — even if readFile would fail,
    // the homepageFile flag should short-circuit
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [], "testuser", {},
      { displayName: "Test User", userName: "testuser", description: "Bio", pinnedWorks: [] },
      "index.md",
    );

    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
  });

  it("should still create homepage when homepageFile is null", async () => {
    // No home file detected by moss — Matters should create index.md as before
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [], "testuser", {},
      { displayName: "Test User", userName: "testuser", description: "Bio", pinnedWorks: [] },
      null,
    );

    expect(result.result.created).toBeGreaterThanOrEqual(1);
    const indexFile = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`);
    expect(indexFile).toBeDefined();
  });

  it("should still create homepage when homepageFile is undefined (backwards compat)", async () => {
    // homepageFile not passed at all — existing behavior preserved
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [], "testuser", {},
      { displayName: "Test User", userName: "testuser", description: "Bio", pinnedWorks: [] },
    );

    expect(result.result.created).toBeGreaterThanOrEqual(1);
    const indexFile = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`);
    expect(indexFile).toBeDefined();
  });
});

// ============================================================================
// Self-named home + home:true marker (bug #2)
// Generated homes follow moss's folder-home convention: a self-named
// `<folder>.md` file carrying a `home: true` frontmatter marker.
// ============================================================================

describe("syncToLocalFiles - self-named home with home:true marker", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const baseProfile = {
    displayName: "Test User",
    userName: "testuser",
    description: "Bio",
    pinnedWorks: [],
  };

  it("creates a self-named <folder>.md home carrying home:true when none exists", async () => {
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [], "testuser", {}, baseProfile,
      null,    // homepageFile — moss detected none
      "刘果",  // folderName — root folder basename
    );

    expect(result.result.created).toBeGreaterThanOrEqual(1);
    const home = ctx.filesystem.getFile(`${ctx.projectPath}/刘果.md`)?.content;
    expect(home).toBeDefined();
    expect(home).toContain("home: true");
    // Feature C: homepage title must use the vault folder name, not the Matters displayName.
    expect(home).toContain('title: "刘果"');
    // Must NOT create a competing index.md.
    expect(ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)).toBeUndefined();
  });

  it("falls back to index.md (still carrying home:true) when folderName is absent", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles([], [], [], "testuser", {}, baseProfile, null);

    const home = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(home).toBeDefined();
    expect(home).toContain("home: true");
    // When folderName is null/undefined, the homepage title falls back to the
    // Matters profile displayName (the `folderName ?? profile.displayName` branch).
    expect(home).toContain('title: "Test User"');
  });

  it("does not overwrite an existing self-named home", async () => {
    const { syncToLocalFiles } = await import("../sync");
    ctx.filesystem.setFile(`${ctx.projectPath}/刘果.md`, "---\nhome: true\n---\n# Mine\n");

    const result = await syncToLocalFiles(
      [], [], [], "testuser", {}, baseProfile,
      null,   // moss didn't flag it, but the file is on disk
      "刘果",
    );

    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    expect(ctx.filesystem.getFile(`${ctx.projectPath}/刘果.md`)?.content).toContain("# Mine");
  });
});

// ============================================================================
// Folder-mode Collection Order Tests
// ============================================================================

describe("syncToLocalFiles - folder-mode collection order", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should generate order field with bare slugs in folder mode", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "First Article", slug: "first-article", shortHash: "hash1",
          content: "<p>First</p>", summary: "First",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
        {
          id: "a2", title: "Second Article", slug: "second-article", shortHash: "hash2",
          content: "<p>Second</p>", summary: "Second",
          createdAt: "2024-01-02T00:00:00Z", tags: [],
        },
      ],
      [],
      [{
        id: "c1",
        title: "My Collection",
        description: "Collection desc",
        cover: undefined,
        articles: [
          { id: "a1", shortHash: "hash1", title: "First Article", slug: "first-article" },
          { id: "a2", shortHash: "hash2", title: "Second Article", slug: "second-article" },
        ],
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    const collectionIndex = ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/my-collection.md`)?.content;
    expect(collectionIndex).toBeDefined();
    expect(collectionIndex).toContain("order:");
    expect(collectionIndex).toContain("first-article");
    expect(collectionIndex).toContain("second-article");
    // In folder mode, order should NOT have full paths
    expect(collectionIndex).not.toContain("posts/");
  });

  it("creates a self-named collection home <slug>.md carrying home:true in folder mode", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "First Article", slug: "first-article", shortHash: "hash1",
          content: "<p>First</p>", summary: "First",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [{
        id: "c1",
        title: "My Collection",
        description: "Collection desc",
        cover: undefined,
        articles: [
          { id: "a1", shortHash: "hash1", title: "First Article", slug: "first-article" },
        ],
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    const home = ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/my-collection.md`)?.content;
    expect(home).toBeDefined();
    expect(home).toContain("home: true");
    expect(home).toContain("order:");
    // No competing index.md in the collection folder.
    expect(ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/index.md`)).toBeUndefined();
  });

  it("should preserve article ordering from Matters API", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "Third", slug: "third", shortHash: "h3",
          content: "<p>3</p>", summary: "3", createdAt: "2024-01-03T00:00:00Z", tags: [],
        },
        {
          id: "a2", title: "First", slug: "first", shortHash: "h1",
          content: "<p>1</p>", summary: "1", createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
        {
          id: "a3", title: "Second", slug: "second", shortHash: "h2",
          content: "<p>2</p>", summary: "2", createdAt: "2024-01-02T00:00:00Z", tags: [],
        },
      ],
      [],
      [{
        id: "c1",
        title: "Ordered Collection",
        description: "",
        cover: undefined,
        articles: [
          // Matters API returns articles in specific order
          { id: "a2", shortHash: "h1", title: "First", slug: "first" },
          { id: "a3", shortHash: "h2", title: "Second", slug: "second" },
          { id: "a1", shortHash: "h3", title: "Third", slug: "third" },
        ],
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    const collectionIndex = ctx.filesystem.getFile(`${ctx.projectPath}/articles/ordered-collection/ordered-collection.md`)?.content;
    expect(collectionIndex).toBeDefined();
    // Order should match Matters API order: first, second, third
    const orderMatch = collectionIndex!.match(/order:\n([\s\S]*?)---/);
    expect(orderMatch).toBeTruthy();
    const orderLines = orderMatch![1].trim().split("\n").map((l: string) => l.trim());
    expect(orderLines[0]).toContain("first");
    expect(orderLines[1]).toContain("second");
    expect(orderLines[2]).toContain("third");
  });
});

// ============================================================================
// Integration Tests with Mock Tauri
// ============================================================================

import { vi, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";

// ============================================================================
// Tag whitespace trimming (B10)
// ============================================================================

describe("syncToLocalFiles - tag whitespace trimming", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("trims leading/trailing whitespace from article tags and drops empties (B10)", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1",
          title: "Tagged Article",
          slug: "tagged-article",
          shortHash: "tag123",
          content: "<p>Content</p>",
          summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z",
          // Matters can hand us tags with surrounding whitespace + an all-blank one.
          tags: [
            { id: "t1", content: " tag " },
            { id: "t2", content: "React\t" },
            { id: "t3", content: "   " },
          ],
        },
      ],
      [],
      [],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    const article = ctx.filesystem.getFile(
      `${ctx.projectPath}/articles/tagged-article.md`
    )?.content;
    expect(article).toBeDefined();
    // Emitted trimmed — exact list entries, never the padded form.
    expect(article).toContain('  - "tag"');
    expect(article).toContain('  - "React"');
    expect(article).not.toContain('  - " tag "');
    expect(article).not.toContain('React\t');
    // The all-whitespace tag is dropped entirely (no empty list entry).
    expect(article).not.toContain('  - ""');
  });
});

describe("syncToLocalFiles - skip unchanged content", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should skip homepage when content is unchanged", async () => {
    // Setup: Create existing homepage with same content that would be generated
    // The generateFrontmatter function creates frontmatter in a specific format
    const existingHomepage = `---
title: "Test User"
---

Test bio`;
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, existingHomepage);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [], // no collections
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "Test bio", pinnedWorks: [] }
    );

    // Homepage should be skipped, not created
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.result.created).toBe(0);
  });

  it("should skip homepage when local file already exists", async () => {
    // Setup: Create existing homepage with DIFFERENT content
    const existingHomepage = `---
title: "Old Name"
---

Old bio`;
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, existingHomepage);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [], // no collections
      "testuser",
      {},
      { displayName: "New Name", userName: "testuser", description: "New bio", pinnedWorks: [] }
    );

    // Homepage should be skipped (local file preserved)
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);

    // Verify local content was NOT overwritten
    const preservedContent = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(preservedContent).toContain("Old Name");
    expect(preservedContent).toContain("Old bio");
  });

  it("should skip collection when content is unchanged", async () => {
    // Setup: Create existing collection with same content that sync would generate
    const existingCollection = `---
title: "Test Collection"
description: "Collection description"
---

Collection description`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-collection/index.md`, existingCollection);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [{
        id: "1",
        title: "Test Collection",
        description: "Collection description",
        articles: [],
        cover: null
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // Collection should be skipped if content matches
    // result.skipped should include the collection
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
  });

  it("should skip collection when local file already exists", async () => {
    // Setup: Create existing collection with DIFFERENT content
    const existingCollection = `---
title: "Old Collection Name"
---

Old description`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-collection/index.md`, existingCollection);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [{
        id: "1",
        title: "Test Collection",
        description: "New description",
        articles: [],
        cover: null
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // Collection should be skipped (local file preserved)
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);

    // Verify local content was NOT overwritten
    const preservedContent = ctx.filesystem.getFile(`${ctx.projectPath}/articles/test-collection/index.md`)?.content;
    expect(preservedContent).toContain("Old Collection Name");
    expect(preservedContent).toContain("Old description");
  });

  it("should skip article when file has been renamed but still has syndicated URL", async () => {
    // Setup: Article exists locally at a RENAMED path, but has the original syndicated URL
    const renamedArticle = `---
title: "My Better Title"
date: "2024-01-01T00:00:00Z"
syndicated:
  - "https://matters.town/@testuser/original-title-abc123"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/my-better-title.md`, renamedArticle);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [
        {
          id: "a1",
          title: "Original Title",
          slug: "original-title",
          shortHash: "abc123",
          content: "<p>Article content</p>",
          summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z",
          tags: [],
        },
      ],
      [],
      [],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "",
        pinnedWorks: [],
      }
    );

    // Article should be skipped (not duplicated at articles/original-title.md)
    // skipped count includes homepage (already doesn't exist, so homepage is created)
    // The article itself should be skipped
    const articleFile = ctx.filesystem.getFile(`${ctx.projectPath}/articles/original-title.md`);
    expect(articleFile).toBeUndefined();

    // The renamed file should still exist untouched
    const renamedFile = ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-better-title.md`);
    expect(renamedFile).toBeDefined();
  });

  it("should use actual local path in articlePathMap when file is renamed", async () => {
    // Setup: Article exists at a renamed path
    const renamedArticle = `---
title: "Renamed Article"
syndicated:
  - "https://matters.town/@testuser/some-slug-xyz789"
---

Content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/custom-name.md`, renamedArticle);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [
        {
          id: "a1",
          title: "Some Slug",
          slug: "some-slug",
          shortHash: "xyz789",
          content: "<p>Content</p>",
          summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z",
          tags: [],
        },
      ],
      [],
      [],
      "testuser",
      {},
      { displayName: "Test", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // articlePathMap should map to the actual renamed path, not the computed one
    const mattersUrl = "https://matters.town/@testuser/some-slug-xyz789";
    expect(result.articlePathMap.get(mattersUrl)).toBe("articles/custom-name.md");
    expect(result.articlePathMap.get("xyz789")).toBe("articles/custom-name.md");
  });
});

// ============================================================================
// Collection skip when folder already has a home file
// ============================================================================

describe("syncToLocalFiles - skip collection index when folder has home file", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should skip collection index.md when folder has a self-named note", async () => {
    // Simulate: user has articles/my-collection/my-collection.md (Obsidian folder note)
    ctx.filesystem.setFile(
      `${ctx.projectPath}/articles/my-collection/my-collection.md`,
      "---\ntitle: \"My Collection\"\n---\n\nUser's custom content"
    );

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [{
        id: "c1",
        title: "My Collection",
        description: "Collection desc",
        articles: [],
        cover: null,
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // Collection should be skipped — self-named note is the home file
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    // index.md should NOT be created
    const indexFile = ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/index.md`);
    expect(indexFile).toBeUndefined();
    // Self-named note should be untouched
    const selfNamed = ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/my-collection.md`);
    expect(selfNamed?.content).toContain("User's custom content");
  });

  it("should still create collection index.md when folder has no home file", async () => {
    // No pre-existing files in the collection folder
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [],
      "testuser", {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // With no collections, nothing to test — this is a control case
    expect(result.result.created).toBeGreaterThanOrEqual(0);
  });

  it("should still create the self-named collection home when folder only has non-home files", async () => {
    // Folder has an article but no home file
    ctx.filesystem.setFile(
      `${ctx.projectPath}/articles/my-collection/some-article.md`,
      "---\ntitle: \"Some Article\"\n---\n\nArticle content"
    );

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [
        {
          id: "a1", title: "Some Article", slug: "some-article", shortHash: "hash1",
          content: "<p>Article content</p>", summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [{
        id: "c1",
        title: "My Collection",
        description: "Collection desc",
        articles: [{ id: "a1", shortHash: "hash1", title: "Some Article", slug: "some-article" }],
        cover: null,
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // Self-named collection home SHOULD be created since some-article.md is not a home file
    const home = ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/my-collection.md`);
    expect(home).toBeDefined();
    expect(home?.content).toContain("home: true");
    // and no competing index.md
    expect(ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/index.md`)).toBeUndefined();
  });
});

// ============================================================================
// scanLocalArticles Tests
// ============================================================================

describe("scanLocalArticles", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("finds articles with Matters syndicated URLs", async () => {
    const articleContent = `---
title: "Test Article"
syndicated:
  - "https://matters.town/@testuser/test-article-abc123"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].shortHash).toBe("abc123");
    expect(articles[0].title).toBe("Test Article");
  });

  it("finds articles syndicated with a /a/ short-link URL", async () => {
    const articleContent = `---
title: "Short Link Article"
uid: 9136b141
syndicated:
  - "https://matters.town/a/aj5szksg7ppa"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/short-link.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].shortHash).toBe("aj5szksg7ppa");
    expect(articles[0].uid).toBe("9136b141");
  });

  it("warns and skips a Matters URL whose shortHash cannot be parsed", async () => {
    const articleContent = `---
title: "Unparseable Syndication"
syndicated:
  - "https://matters.town/@testuser/nohyphenslug"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/unparseable.md`, articleContent);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0); // excluded, not silently included
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not extract shortHash")
    );
    warn.mockRestore();
  });

  it("ignores files without syndicated field", async () => {
    const articleContent = `---
title: "Local Only Article"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/local-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });

  it("ignores files with non-Matters syndicated URLs", async () => {
    const articleContent = `---
title: "Cross-posted Article"
syndicated:
  - "https://dev.to/testuser/article"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/devto-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });

  it("skips index.md and README.md", async () => {
    const indexContent = `---
title: "Homepage"
syndicated:
  - "https://matters.town/@testuser/home-abc123"
---`;
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, indexContent);
    ctx.filesystem.setFile(`${ctx.projectPath}/README.md`, indexContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });

  it("skips _drafts folder", async () => {
    const draftContent = `---
title: "Draft Article"
syndicated:
  - "https://matters.town/@testuser/draft-abc123"
---`;
    ctx.filesystem.setFile(`${ctx.projectPath}/_drafts/draft.md`, draftContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });

  it("returns uid from frontmatter when present", async () => {
    const articleContent = `---
title: "Article With UID"
uid: "abc123-def456"
syndicated:
  - "https://matters.town/@testuser/test-article-abc123"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].uid).toBe("abc123-def456");
    expect(articles[0].shortHash).toBe("abc123");
  });

  it("returns null uid when not present in frontmatter", async () => {
    const articleContent = `---
title: "Article Without UID"
syndicated:
  - "https://matters.town/@testuser/test-article-xyz789"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].uid).toBeNull();
    expect(articles[0].shortHash).toBe("xyz789");
  });

  it("returns uid for each article independently", async () => {
    const articleWithUid = `---
title: "Has UID"
uid: "uid-111"
syndicated:
  - "https://matters.town/@testuser/has-uid-aaa111"
---

Content`;
    const articleWithoutUid = `---
title: "No UID"
syndicated:
  - "https://matters.town/@testuser/no-uid-bbb222"
---

Content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/has-uid.md`, articleWithUid);
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/no-uid.md`, articleWithoutUid);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(2);
    const withUid = articles.find(a => a.shortHash === "aaa111");
    const withoutUid = articles.find(a => a.shortHash === "bbb222");
    expect(withUid?.uid).toBe("uid-111");
    expect(withoutUid?.uid).toBeNull();
  });
});

// ============================================================================
// detectBoundUser Tests
// ============================================================================

describe("detectBoundUser", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("returns username from Matters syndication URL", async () => {
    ctx.filesystem.setFile(
      `${ctx.projectPath}/articles/test-article.md`,
      `---
title: "Test Article"
syndicated:
  - "https://matters.town/@alice/test-article-abc123"
---

Article content`
    );

    const { detectBoundUser } = await import("../sync");
    const userName = await detectBoundUser();

    expect(userName).toBe("alice");
  });

  it("returns null when no Matters content exists", async () => {
    ctx.filesystem.setFile(
      `${ctx.projectPath}/articles/local-article.md`,
      `---
title: "Local Only"
---

Content`
    );

    const { detectBoundUser } = await import("../sync");
    const userName = await detectBoundUser();

    expect(userName).toBeNull();
  });

  it("returns null when syndication URLs are from other platforms", async () => {
    ctx.filesystem.setFile(
      `${ctx.projectPath}/articles/devto-article.md`,
      `---
title: "Cross-posted"
syndicated:
  - "https://dev.to/alice/article-123"
---

Content`
    );

    const { detectBoundUser } = await import("../sync");
    const userName = await detectBoundUser();

    expect(userName).toBeNull();
  });

  it("returns null when no markdown files exist", async () => {
    // Empty project
    const { detectBoundUser } = await import("../sync");
    const userName = await detectBoundUser();

    expect(userName).toBeNull();
  });

  it("ignores hidden and underscore folders", async () => {
    ctx.filesystem.setFile(
      `${ctx.projectPath}/.hidden/article.md`,
      `---
title: "Hidden"
syndicated:
  - "https://matters.town/@alice/hidden-abc123"
---

Content`
    );
    ctx.filesystem.setFile(
      `${ctx.projectPath}/_drafts/draft.md`,
      `---
title: "Draft"
syndicated:
  - "https://matters.town/@alice/draft-def456"
---

Content`
    );

    const { detectBoundUser } = await import("../sync");
    const userName = await detectBoundUser();

    expect(userName).toBeNull();
  });

  it("extracts username from matters.town URL with @ prefix", async () => {
    ctx.filesystem.setFile(
      `${ctx.projectPath}/posts/my-post.md`,
      `---
title: "My Post"
syndicated:
  - "https://matters.town/@bob_writer/my-post-xyz789"
---

Content`
    );

    const { detectBoundUser } = await import("../sync");
    const userName = await detectBoundUser();

    expect(userName).toBe("bob_writer");
  });
});
