import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";

import {
  loadFailedMediaMemo,
  mergePermanentFailures,
  type FailedMediaEntry,
} from "../failed-media";

const PLUGIN_DIR_PREFIX = (projectPath: string) =>
  `${projectPath}/.moss/plugins/test-plugin`;

describe("loadFailedMediaMemo", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project", pluginName: "test-plugin" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("returns [] when file is absent", async () => {
    const result = await loadFailedMediaMemo();
    expect(result).toEqual([]);
  });

  it("returns [] when file contains invalid JSON", async () => {
    ctx.filesystem.setFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`,
      "not-valid-json{{{"
    );
    const result = await loadFailedMediaMemo();
    expect(result).toEqual([]);
  });

  it("returns [] when file contains a JSON non-array", async () => {
    ctx.filesystem.setFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`,
      JSON.stringify({ url: "https://example.com/img.jpg" })
    );
    const result = await loadFailedMediaMemo();
    expect(result).toEqual([]);
  });

  it("returns parsed entries when file exists and is valid", async () => {
    const entries: FailedMediaEntry[] = [
      {
        url: "https://assets.matters.news/embed/dead.jpg",
        filePaths: ["article/post.md"],
        failedAt: "2026-06-24T00:00:00.000Z",
      },
    ];
    ctx.filesystem.setFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`,
      JSON.stringify(entries)
    );
    const result = await loadFailedMediaMemo();
    expect(result).toEqual(entries);
  });

  it("returns [] for an empty array in the file", async () => {
    ctx.filesystem.setFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`,
      "[]"
    );
    const result = await loadFailedMediaMemo();
    expect(result).toEqual([]);
  });
});

describe("mergePermanentFailures", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project", pluginName: "test-plugin" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("creates failed-media.json when it did not exist", async () => {
    const entries: FailedMediaEntry[] = [
      {
        url: "https://example.com/img.jpg",
        filePaths: ["posts/article.md"],
        failedAt: "2026-06-24T00:00:00.000Z",
      },
    ];

    await mergePermanentFailures(entries);

    const written = ctx.filesystem.getFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`
    );
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!.content) as FailedMediaEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe("https://example.com/img.jpg");
  });

  it("deduplicates by URL: a newer entry for the same URL overwrites the old one", async () => {
    const existing: FailedMediaEntry[] = [
      {
        url: "https://example.com/img.jpg",
        filePaths: ["old/path.md"],
        failedAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    ctx.filesystem.setFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`,
      JSON.stringify(existing)
    );

    const newEntry: FailedMediaEntry = {
      url: "https://example.com/img.jpg",
      filePaths: ["new/path.md"],
      failedAt: "2026-06-24T00:00:00.000Z",
    };
    await mergePermanentFailures([newEntry]);

    const written = ctx.filesystem.getFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`
    );
    const parsed = JSON.parse(written!.content) as FailedMediaEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].filePaths).toEqual(["new/path.md"]);
    expect(parsed[0].failedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("preserves existing entries when adding a new distinct URL", async () => {
    const existing: FailedMediaEntry[] = [
      {
        url: "https://example.com/old.jpg",
        filePaths: ["old/article.md"],
        failedAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    ctx.filesystem.setFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`,
      JSON.stringify(existing)
    );

    const newEntry: FailedMediaEntry = {
      url: "https://example.com/new.jpg",
      filePaths: ["new/article.md"],
      failedAt: "2026-06-24T00:00:00.000Z",
    };
    await mergePermanentFailures([newEntry]);

    const written = ctx.filesystem.getFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`
    );
    const parsed = JSON.parse(written!.content) as FailedMediaEntry[];
    expect(parsed).toHaveLength(2);
    const urls = parsed.map((e) => e.url);
    expect(urls).toContain("https://example.com/old.jpg");
    expect(urls).toContain("https://example.com/new.jpg");
  });

  it("is a no-op when called with an empty array", async () => {
    await mergePermanentFailures([]);

    // No file should have been created
    const written = ctx.filesystem.getFile(
      `${PLUGIN_DIR_PREFIX(ctx.projectPath)}/failed-media.json`
    );
    expect(written).toBeUndefined();
  });
});
