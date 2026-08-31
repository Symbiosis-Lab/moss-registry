/**
 * updateFrontmatterSyndicated — the write-back that closes the syndication
 * loop: after a draft is published on Matters, the article's own frontmatter
 * gains the published URL, which is what excludes it from the next run.
 *
 * Deliberately runs the REAL ./converter (parseFrontmatter/regenerateFrontmatter)
 * with only host I/O mocked. main.test.ts mocks the converter away, so before
 * this file nothing proved the URL actually lands in the file on disk.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  httpGet: vi.fn(),
  fetchUrl: vi.fn(),
  downloadAsset: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: vi.fn().mockResolvedValue(undefined),
  dismissToast: vi.fn().mockResolvedValue(undefined),
  openBrowser: vi.fn().mockResolvedValue({ closed: new Promise<void>(() => {}) }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn().mockResolvedValue("{}"),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn().mockResolvedValue(false),
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  startTask: vi.fn(),
  // utils.ts calls setMessageContext at module load time.
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
  uploadAssetMultipart: vi.fn(),
  fetchUserProfile: vi.fn(),
  MattersAuthError: class MattersAuthError extends Error {},
  apiConfig: { queryMode: "viewer", testUserName: "Matty", endpoint: "https://server.matters.town/graphql" },
}));

vi.mock("../domain", () => ({
  initializeDomain: vi.fn().mockResolvedValue(undefined),
  getDomain: vi.fn().mockReturnValue("matters.town"),
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  draftUrl: vi.fn(),
  articleUrl: vi.fn(),
  isMattersUrl: vi.fn().mockImplementation((url: string) => url.includes("matters.town")),
  extractShortHash: vi.fn(),
}));

vi.mock("../utils", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { updateFrontmatterSyndicated } from "../main";
import { readFile, writeFile } from "@symbiosis-lab/moss-api";

const MATTERS_URL = "https://matters.town/@guo/my-post-abc123";

/** A synced article file as it sits on disk: frontmatter + blank line + body. */
function articleFile(frontmatter: string, body = "Body text.\n"): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function writtenContent(): string {
  expect(writeFile).toHaveBeenCalledTimes(1);
  return vi.mocked(writeFile).mock.calls[0][1] as string;
}

describe("updateFrontmatterSyndicated", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
    vi.mocked(writeFile).mockClear();
  });

  it("appends the URL to an existing syndicated list, preserving the rest of the file", async () => {
    vi.mocked(readFile).mockResolvedValue(
      articleFile(
        'title: "My Post"\ndate: "2026-01-01"\nuid: "5ac32a4a"\nsyndicated:\n  - "https://example.com/mirror"',
        "Hello **world**.\n"
      )
    );

    await updateFrontmatterSyndicated("/vault/articles/my-post.md", MATTERS_URL);

    const written = writtenContent();
    expect(vi.mocked(writeFile).mock.calls[0][0]).toBe("/vault/articles/my-post.md");
    // The pre-existing mirror stays; the Matters URL is appended after it.
    expect(written).toMatch(
      /syndicated:\n {2}- "https:\/\/example\.com\/mirror"\n {2}- "https:\/\/matters\.town\/@guo\/my-post-abc123"/
    );
    // Other frontmatter values and the body survive the round-trip.
    expect(written).toContain('title: "My Post"');
    expect(written).toContain('uid: "5ac32a4a"');
    expect(written).toContain("Hello **world**.");
  });

  it("creates the syndicated list when the article has none", async () => {
    vi.mocked(readFile).mockResolvedValue(articleFile('title: "Fresh"'));

    await updateFrontmatterSyndicated("/vault/articles/fresh.md", MATTERS_URL);

    expect(writtenContent()).toMatch(/syndicated:\n {2}- "https:\/\/matters\.town\/@guo\/my-post-abc123"/);
  });

  it("keeps exactly one blank line between frontmatter and body across rewrites", async () => {
    // parseFrontmatter's body capture includes the blank separator line; without
    // trimming, every rewrite would prepend another blank line to the body.
    vi.mocked(readFile).mockResolvedValue(articleFile('title: "T"', "First paragraph.\n"));

    await updateFrontmatterSyndicated("/vault/a.md", MATTERS_URL);

    expect(writtenContent()).toMatch(/---\n\nFirst paragraph\./);
  });

  it("does not rewrite the file when the URL is already recorded", async () => {
    // Idempotence matters: regenerateFrontmatter re-serializes hand-written
    // frontmatter, and any write re-triggers moss's watcher rebuild.
    vi.mocked(readFile).mockResolvedValue(
      articleFile(`title: "T"\nsyndicated:\n  - "${MATTERS_URL}"`)
    );

    await updateFrontmatterSyndicated("/vault/a.md", MATTERS_URL);

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("leaves the file untouched when it has no parseable frontmatter", async () => {
    vi.mocked(readFile).mockResolvedValue("No frontmatter here, just prose.\n");

    await updateFrontmatterSyndicated("/vault/a.md", MATTERS_URL);

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("swallows I/O failures — a failed write-back must not fail the publish", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("EBUSY"));

    await expect(updateFrontmatterSyndicated("/vault/a.md", MATTERS_URL)).resolves.toBeUndefined();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
