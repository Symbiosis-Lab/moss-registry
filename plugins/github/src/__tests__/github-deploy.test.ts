/**
 * Tests for GitHub Deployment Module
 *
 * Tests verifyRepoExists and deployViaGitPush (single-repo with tree extraction).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock utils
vi.mock("../utils", () => ({
  showToast: vi.fn().mockResolvedValue(undefined),
}));

// Mock @symbiosis-lab/moss-api for executeBinary and listSiteFilesWithSizes
vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: vi.fn(),
  listSiteFilesWithSizes: vi.fn().mockResolvedValue([]),
}));

import { executeBinary, listSiteFilesWithSizes } from "@symbiosis-lab/moss-api";
import type { ExecuteResult } from "@symbiosis-lab/moss-api";
import { showToast } from "../utils";

import {
  deployViaGitPush,
  verifyRepoExists,
  getOriginOwnerRepo,
  looksLikeCorruptGit,
  resolveCurrentGenDir,
  type DeployViaGitPushOptions,
  type DeployResult,
} from "../github-deploy";

// ============================================================================
// Test Constants
// ============================================================================

const TOKEN = "ghp_test-token-123";
const OWNER = "testuser";
const REPO = "my-site";

/** Simulated absolute readlink output for .moss/build/current */
const GEN_ABS = "/Users/test/.../project/.moss/build/generations/gen-abc123def456";
/** Relative generation directory path (what resolveCurrentGenDir returns) */
const GEN_DIR = ".moss/build/generations/gen-abc123def456";

/**
 * Helper to create a mock Response for fetch
 */
function mockResponse(body: unknown, status = 200, ok = true): Partial<Response> {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockErrorResponse(status: number, message: string): Partial<Response> {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ message }),
    text: () => Promise.resolve(JSON.stringify({ message })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("github-deploy", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ==========================================================================
  // verifyRepoExists
  // ==========================================================================
  describe("verifyRepoExists", () => {
    it("succeeds silently when repo exists (200)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 123, name: "my-site" }));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/my-site",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
          }),
        })
      );
    });

    it("throws repo-not-found error when 404 and owner exists", async () => {
      // First call: GET /repos/{owner}/{repo} → 404
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));
      // Second call: GET /users/{owner} → 200 (owner exists)
      mockFetch.mockResolvedValueOnce(mockResponse({ login: OWNER }));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        `Repository "${OWNER}/${REPO}" not found`
      );
      // Should have made the disambiguation call
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `https://api.github.com/users/${OWNER}`,
        expect.objectContaining({
          headers: expect.not.objectContaining({ Authorization: expect.anything() }),
        })
      );
    });

    it("throws owner-not-found error when 404 and owner does not exist", async () => {
      // First call: GET /repos/{owner}/{repo} → 404
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));
      // Second call: GET /users/{owner} → 404 (owner doesn't exist)
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        `GitHub user or organization "${OWNER}" not found`
      );
    });

    it("throws invalid token error on 401", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401, "Unauthorized"));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        "GitHub token is invalid or expired"
      );
    });

    it("throws access denied error on 403", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        `Access denied to "${OWNER}/${REPO}"`
      );
    });

  });

  // ==========================================================================
  // getOriginOwnerRepo
  // ==========================================================================
  describe("getOriginOwnerRepo", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);

    function gitResult(success: boolean, stdout = "", stderr = ""): { success: boolean; exitCode: number; stdout: string; stderr: string } {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    beforeEach(() => {
      mockExecuteBinary.mockReset();
    });

    it("returns owner/repo from HTTPS origin", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "https://github.com/testuser/my-site.git\n")
      );

      const result = await getOriginOwnerRepo();

      expect(result).toEqual({ owner: "testuser", repo: "my-site" });
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "get-url", "origin"],
        })
      );
    });

    it("returns owner/repo from SSH origin", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "git@github.com:testuser/my-site.git\n")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toEqual({ owner: "testuser", repo: "my-site" });
    });

    it("handles dotted repo names (username.github.io)", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "https://github.com/guoliu/guoliu.github.io.git\n")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toEqual({ owner: "guoliu", repo: "guoliu.github.io" });
    });

    it("returns null when no .git directory (command fails)", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(false, "", "fatal: not a git repository")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toBeNull();
    });

    it("returns null when origin is not a GitHub URL", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "https://gitlab.com/user/repo.git\n")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toBeNull();
    });

    it("returns null when origin remote does not exist", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(false, "", "fatal: No such remote 'origin'")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // resolveCurrentGenDir
  // ==========================================================================
  describe("resolveCurrentGenDir", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);

    function execResult(success: boolean, stdout = "", stderr = ""): import("@symbiosis-lab/moss-api").ExecuteResult {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    beforeEach(() => {
      mockExecuteBinary.mockReset();
    });

    it("resolves symlink target to relative generation dir path", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        execResult(true, "/Users/test/project/.moss/build/generations/gen-abc123def456\n")
      );

      const result = await resolveCurrentGenDir();
      expect(result).toBe(".moss/build/generations/gen-abc123def456");
    });

    it("calls readlink with .moss/build/current argument", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        execResult(true, "/some/path/.moss/build/generations/gen-xyz789\n")
      );

      await resolveCurrentGenDir();

      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "readlink",
          args: [".moss/build/current"],
        })
      );
    });

    it("throws when .moss/build/current symlink is missing (readlink fails)", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        execResult(false, "", "readlink: .moss/build/current: No such file or directory")
      );

      await expect(resolveCurrentGenDir()).rejects.toThrow(
        "Cannot locate current generation"
      );
    });

    it("throws when readlink returns empty stdout", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        execResult(true, "")
      );

      await expect(resolveCurrentGenDir()).rejects.toThrow(
        "Cannot locate current generation"
      );
    });
  });

  // ==========================================================================
  // deployViaGitPush (single-repo with tree extraction)
  // ==========================================================================
  describe("deployViaGitPush", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);
    const mockListSiteFilesWithSizes = vi.mocked(listSiteFilesWithSizes);
    const mockShowToast = vi.mocked(showToast);

    /** Helper to create an ExecuteResult */
    function gitResult(success: boolean, stdout = "", stderr = ""): ExecuteResult {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    /** Token-free marker URL used for origin identity checks */
    const REPO_MARKER = `https://github.com/${OWNER}/${REPO}.git`;

    /**
     * Set up mock sequence for a full successful deploy (existing repo, matching origin).
     * Returns the mock for further customization.
     *
     * New sequence (incremental deploy, generations model, #816):
     *   rev-parse --git-dir, remote get-url origin, fetch --depth=1,
     *   .gitignore, rm -f index.lock, rm -f shallow.lock,
     *   readlink .moss/build/current (resolve generation dir),
     *   git add .moss/build/generations/<id>/,
     *   rm -f .git/index.lock (iCloud race),
     *   write-tree --prefix=.moss/build/generations/<id>/, .nojekyll injection,
     *   rev-parse gh-pages tip, commit-tree, push gh-pages,
     *   then deferred: find(large files), add --all, diff, commit,
     *   rev-parse --short HEAD, push main
     *
     * listSiteFilesWithSizes is mocked separately (returns [] by default).
     */
    function setupFullDeployMocks(commitSha = "abc1234") {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore (sh -c)
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111bbb222\n"))  // git write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection (always happens):
        .mockResolvedValueOnce(gitResult(true, "nojekyll000\n"))   // hash-object -w --stdin (.nojekyll)
        .mockResolvedValueOnce(gitResult(true, "100644 blob siteblob\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modifiedTree\n"))  // mktree (with .nojekyll)
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "ccc333ddd444\n"))  // git commit-tree (orphan, no parent)
        .mockResolvedValueOnce(gitResult(true))                    // git push --force gh-pages only
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none found)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, commitSha + "\n"))  // git rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // git push main
    }

    beforeEach(() => {
      mockExecuteBinary.mockReset();
      mockListSiteFilesWithSizes.mockReset();
      mockListSiteFilesWithSizes.mockResolvedValue([]);
      mockShowToast.mockReset();
      mockShowToast.mockResolvedValue(undefined);
    });

    it("initializes git repo on first deploy", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse fails (no .git)
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(false))                   // git fetch (fails, first deploy)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree (orphan)
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages only
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // push main

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify git init was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );

      // Verify git config
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.email", "moss@symbiosis-lab.com"] })
      );
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.name", "moss"] })
      );

      // Verify remote add origin with token-free marker URL
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "add", "origin", REPO_MARKER],
        })
      );
    });

    it("reuses existing git repo when origin matches", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify remote get-url origin was checked
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "get-url", "origin"],
        })
      );

      // Verify git init was NOT called
      const initCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "init"
      );
      expect(initCalls).toHaveLength(0);
    });

    it("strips stale moss-managed .moss/* lines from root .gitignore (migration)", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Gitignore ownership for .moss/ lives in .moss/.gitignore (written by Rust).
      // Here we only strip stale .moss/* rules from the root .gitignore via sed.
      const shCall = mockExecuteBinary.mock.calls.find(
        (call) => call[0].binaryPath === "sh" && (call[0].args[1] as string).includes("sed")
      );
      expect(shCall).toBeDefined();
      const cmd = shCall![0].args[1] as string;
      expect(cmd).toContain("[ -f .gitignore ]");
      expect(cmd).toContain("sed -i");
      expect(cmd).toContain("/^\\.moss/d");
      expect(cmd).toContain("/^!\\.moss/d");
    });

    it("pushes gh-pages first, then main separately", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;

      // Verify TWO separate push calls
      const pushCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
      );
      expect(pushCalls).toHaveLength(2);

      // First push: gh-pages only (with --force --progress)
      expect(pushCalls[0][0].args).toEqual([
        "push", "--force", "--progress", pushUrl,
        "ccc333ddd444:refs/heads/gh-pages",
      ]);

      // Second push: main only (no --force, no --progress)
      expect(pushCalls[1][0].args).toEqual([
        "push", pushUrl, "HEAD:refs/heads/main",
      ]);
    });

    it("extracts current generation tree via write-tree and creates orphan commit for gh-pages", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify tree extraction via write-tree --prefix on the resolved generation dir
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["write-tree", `--prefix=${GEN_DIR}/`],
        })
      );

      // Verify orphan commit creation with modified tree (includes .nojekyll)
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["commit-tree", "modifiedTree", "-m", "Deploy site\n\nGenerated by moss"],
        })
      );
    });

    it("still pushes gh-pages for fresh repo with empty site tree", async () => {
      // In the new flow, write-tree always succeeds (even empty tree).
      // gh-pages is always pushed. The deferred source backup may have no changes.
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse --git-dir fails (no .git)
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(false))                   // git fetch (fails, first deploy)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "4b825dc\n"))       // write-tree --prefix (empty tree)
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, ""))                // ls-tree (empty tree — no entries)
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree (just .nojekyll)
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "orphan123\n"))     // commit-tree
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(true));                   // git diff --cached --quiet (no changes)

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect((result as DeployResult).commitSha).toBe("");
      expect((result as DeployResult).orphanSha).toBe("orphan123");
      // gh-pages push should still happen
      const pushCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
      );
      expect(pushCalls).toHaveLength(1); // gh-pages only, no main push (no source changes)
    });

    it("returns commit SHA via rev-parse after commit", async () => {
      setupFullDeployMocks("abc1234");

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect((result as DeployResult).commitSha).toBe("abc1234");

      // Verify rev-parse --short HEAD was called (not regex on commit output)
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["rev-parse", "--short", "HEAD"],
        })
      );
    });

    it("returns empty commitSha when rev-parse fails after commit", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore (sh -c)
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111bbb222\n"))  // write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "newTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "ccc333ddd444\n"))  // git commit-tree
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(false));                  // rev-parse --short HEAD FAILS

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect((result as DeployResult).commitSha).toBe("");
    });

    it("sanitizes token from error messages on push failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(false, "", `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/testuser/my-site.git/'`));  // push gh-pages fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
      ).rejects.toThrow(expect.objectContaining({
        message: expect.not.stringContaining(TOKEN),
      }));
    });

    it("reports weighted progress at phase boundaries", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect(onProgress).toHaveBeenCalledWith(0, "Preparing deploy...");
      expect(onProgress).toHaveBeenCalledWith(5, "Staging site files...");
      expect(onProgress).toHaveBeenCalledWith(10, "Preparing gh-pages...");
      expect(onProgress).toHaveBeenCalledWith(25, "Pushing to GitHub...");
      expect(onProgress).toHaveBeenCalledWith(100, "Deployed!");
    });

    it("uses project root as working directory for all git commands", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // All calls should use workingDir "." (project root)
      for (const call of mockExecuteBinary.mock.calls) {
        expect(call[0].workingDir).toBe(".");
      }
    });

    it("throws on write-tree failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(false, "", "fatal: not a valid object name"));  // write-tree --prefix fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
      ).rejects.toThrow("Failed to write site tree");
    });

    it("throws on commit-tree failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(false, "", "fatal: not a tree object"));  // commit-tree fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
      ).rejects.toThrow("Failed to create gh-pages commit");
    });

    // ========================================================================
    // Idempotency: repo change detection (14a)
    // ========================================================================
    it("reinitializes git when target repo changes", async () => {
      const oldMarker = "https://github.com/oldowner/old-repo.git";
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, oldMarker + "\n"))  // remote get-url origin (DIFFERENT repo)
        .mockResolvedValueOnce(gitResult(true))                    // rm -rf .git
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(false))                   // git fetch (fails, first deploy)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // push main

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect((result as DeployResult).commitSha).toBe("abc1234");

      // Verify rm -rf .git was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "rm",
          args: ["-rf", ".git"],
        })
      );

      // Verify reinit happened
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );

      // Verify remote add origin with new marker URL
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "add", "origin", REPO_MARKER],
        })
      );
    });

    it("reinitializes git when origin is missing", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(false))                   // remote get-url origin FAILS (no remote)
        .mockResolvedValueOnce(gitResult(true))                    // rm -rf .git
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(false))                   // git fetch (fails, first deploy)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // push main

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify rm -rf .git was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "rm",
          args: ["-rf", ".git"],
        })
      );

      // Verify reinit happened
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );
    });

    // ========================================================================
    // Idempotency: stale index.lock removal (14b)
    // ========================================================================
    it("removes stale index.lock before git add", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify rm -f .git/index.lock was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "rm",
          args: ["-f", ".git/index.lock"],
        })
      );
    });

    // ========================================================================
    // Idempotency: push even when no staged changes (14c — resume after crash)
    // ========================================================================
    it("pushes gh-pages even when no source changes exist (resume after crash)", async () => {
      const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
        // .nojekyll injection:
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(true))                    // git diff --cached --quiet SUCCESS (no changes)
        .mockResolvedValueOnce(gitResult(true, "0\n"));            // rev-list --count (no unpushed commits)

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Returns empty commitSha (no source changes) but orphanSha populated
      expect((result as DeployResult).commitSha).toBe("");
      expect((result as DeployResult).orphanSha).toBe("bbb222");

      // Verify commit was NOT called (no source changes to commit)
      const commitCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "commit"
      );
      expect(commitCalls).toHaveLength(0);

      // Verify gh-pages push happened (first push)
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["push", "--force", "--progress", pushUrl, "bbb222:refs/heads/gh-pages"],
        })
      );

      // Only ONE push call (gh-pages only, no main push since no source changes)
      const pushCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
      );
      expect(pushCalls).toHaveLength(1);
    });

    // ========================================================================
    // 100MB site file limit — ABORT if any site file exceeds 100MB
    // ========================================================================
    describe("100MB site file limit", () => {
      it("throws when a site file exceeds 100MB", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "index.html", size: 1024 },
          { path: "assets/huge-video.mp4", size: HUNDRED_MB + 1 },
        ]);

        const onProgress = vi.fn();

        await expect(
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
        ).rejects.toThrow("assets/huge-video.mp4");
      });

      it("includes file size in the error message", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "assets/huge-video.mp4", size: HUNDRED_MB + 500 },
        ]);

        const onProgress = vi.fn();

        await expect(
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
        ).rejects.toThrow("100");
      });

      it("lists multiple oversized files in error", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "video1.mp4", size: HUNDRED_MB + 1 },
          { path: "video2.mp4", size: HUNDRED_MB * 2 },
          { path: "small.html", size: 500 },
        ]);

        const onProgress = vi.fn();

        try {
          await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });
          expect.fail("Expected to throw");
        } catch (err: unknown) {
          const error = err as Error;
          expect(error.message).toContain("video1.mp4");
          expect(error.message).toContain("video2.mp4");
          expect(error.message).not.toContain("small.html");
        }
      });

      it("does not abort when all site files are under 100MB", async () => {
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "index.html", size: 1024 },
          { path: "style.css", size: 2048 },
        ]);

        // Set up full deploy mocks (file size check passes, then normal flow)
        setupFullDeployMocks();

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect((result as DeployResult).commitSha).toBe("abc1234");
      });

      it("aborts before any git operations when site files exceed limit", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "huge.bin", size: HUNDRED_MB + 1 },
        ]);

        const onProgress = vi.fn();

        try {
          await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });
        } catch {
          // Expected
        }

        // No git commands should have been called
        expect(mockExecuteBinary).not.toHaveBeenCalled();
      });
    });

    // ========================================================================
    // 100MB source file limit — SKIP >100MB files with warning
    // ========================================================================
    describe("100MB source file limit", () => {
      it("appends large source files to .gitignore", async () => {
        // Set up mocks with new sequence: site-only staging → gh-pages push → deferred source backup
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                        // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))    // remote get-url origin (matches)
          .mockResolvedValueOnce(gitResult(true))                        // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                        // write .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))        // readlink .moss/build/current → abs gen path
          .mockResolvedValueOnce(gitResult(true))                        // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))            // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))      // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))           // mktree
          .mockResolvedValueOnce(gitResult(false))                       // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))            // commit-tree
          .mockResolvedValueOnce(gitResult(true))                        // push gh-pages
          // Deferred source backup — find returns large files:
          .mockResolvedValueOnce(gitResult(true, "big-model.bin\ndata/huge.csv\n"))  // find large files
          .mockResolvedValueOnce(gitResult(true))                        // append .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // git add --all
          .mockResolvedValueOnce(gitResult(false))                       // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))           // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                       // push main

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Verify a second sh -c call was made to append to .gitignore
        const shCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "sh"
        );
        expect(shCalls.length).toBeGreaterThanOrEqual(2);
        // The append call should contain the large file names
        const appendCall = shCalls[1];
        expect(appendCall[0].args[1]).toContain("big-model.bin");
        expect(appendCall[0].args[1]).toContain("data/huge.csv");
      });

      it("shows warning toast for skipped source files", async () => {
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                        // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))    // remote get-url origin (matches)
          .mockResolvedValueOnce(gitResult(true))                        // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                        // write .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))        // readlink .moss/build/current → abs gen path
          .mockResolvedValueOnce(gitResult(true))                        // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))            // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))      // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))           // mktree
          .mockResolvedValueOnce(gitResult(false))                       // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))            // commit-tree
          .mockResolvedValueOnce(gitResult(true))                        // push gh-pages
          // Deferred source backup — find returns large files:
          .mockResolvedValueOnce(gitResult(true, "large-file.bin\n"))    // find large files
          .mockResolvedValueOnce(gitResult(true))                        // append .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // git add --all
          .mockResolvedValueOnce(gitResult(false))                       // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))           // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                       // push main

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // showToast should have been called with a warning
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "warning",
            message: expect.stringContaining("large-file.bin"),
          })
        );
      });

      it("does not modify .gitignore when no large source files found", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Should only have one sh -c call (base .gitignore write)
        const shCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "sh"
        );
        expect(shCalls).toHaveLength(1);

        // showToast should NOT have been called for large files
        expect(mockShowToast).not.toHaveBeenCalled();
      });

      it("uses find command to detect large source files", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Verify find command was called with correct args
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "find",
            args: expect.arrayContaining(["-size", "+100M"]),
          })
        );
      });
    });

    // ========================================================================
    // Streaming git operations — verbose/progress flags + onStderr
    // ========================================================================
    describe("streaming git operations", () => {
      it("calls git add --all without -v flag for source backup", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // The deferred source backup uses git add --all (no -v)
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["add", "--all"],
          })
        );
      });

      it("calls git push with --force --progress for gh-pages only", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
        // First push: gh-pages only
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["push", "--force", "--progress", pushUrl, "ccc333ddd444:refs/heads/gh-pages"],
          })
        );
      });

      it("passes onStderr callback to gh-pages push", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Find the gh-pages push call
        const pushCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.includes("ccc333ddd444:refs/heads/gh-pages")
        );
        expect(pushCall).toBeDefined();
        expect(pushCall![0].onStderr).toBeTypeOf("function");
      });

      it("maps push stderr progress to 25-95% range", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Find the gh-pages push call and invoke its onStderr
        const pushCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.includes("ccc333ddd444:refs/heads/gh-pages")
        );
        const pushOnStderr = pushCall![0].onStderr;

        // Simulate git push progress output at 50%
        pushOnStderr("Writing objects:  50% (5/10), 1.00 MiB | 500.00 KiB/s");

        // Should map 50% to range 25-95%, which is 25 + 35 = 60%
        expect(onProgress).toHaveBeenCalledWith(60, expect.stringContaining("Writing objects"));
      });
    });

    // ========================================================================
    // CNAME injection for custom domains
    // ========================================================================
    describe("CNAME injection for custom domains", () => {
      it("injects CNAME file into gh-pages tree when domain is provided", async () => {
        const SITE_TREE = "aaa111bbb222";
        const NOJEKYLL_BLOB = "nnn000jjj111";
        const CNAME_BLOB = "fff000ccc111";
        const NEW_TREE = "eee222ddd333";
        const ORPHAN_SHA = "ggg444hhh555";

        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, SITE_TREE + "\n"))  // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll + CNAME injection steps:
          .mockResolvedValueOnce(gitResult(true, NOJEKYLL_BLOB + "\n"))  // hash-object -w --stdin (.nojekyll)
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc123\tindex.html\n"))  // git ls-tree
          .mockResolvedValueOnce(gitResult(true, CNAME_BLOB + "\n"))  // hash-object -w --stdin (CNAME)
          .mockResolvedValueOnce(gitResult(true, NEW_TREE + "\n"))   // git mktree (tree with .nojekyll + CNAME)
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, ORPHAN_SHA + "\n")) // git commit-tree (uses NEW tree)
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // push main

        const onProgress = vi.fn();
        await deployViaGitPush({
          owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git",
          domain: "example.com",
        });

        // Verify CNAME blob was created with domain content
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["hash-object", "-w", "--stdin"],
            stdin: "example.com\n",
          })
        );

        // Verify ls-tree was called on the original site tree
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["ls-tree", SITE_TREE],
          })
        );

        // Verify mktree was called with entries including both .nojekyll and CNAME
        const mktreeCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "mktree"
        );
        expect(mktreeCall).toBeDefined();
        expect(mktreeCall![0].stdin).toContain("CNAME");
        expect(mktreeCall![0].stdin).toContain(CNAME_BLOB);
        expect(mktreeCall![0].stdin).toContain(".nojekyll");
        expect(mktreeCall![0].stdin).toContain(NOJEKYLL_BLOB);

        // Verify commit-tree used the NEW tree (with CNAME + .nojekyll), not the original
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["commit-tree", NEW_TREE, "-m", "Deploy site\n\nGenerated by moss"],
          })
        );
      });

      it("falls back to original tree when hash-object fails for CNAME", async () => {
        const SITE_TREE = "aaa111bbb222";
        const NOJEKYLL_BLOB = "nnn000jjj111";

        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, SITE_TREE + "\n"))  // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, NOJEKYLL_BLOB + "\n"))  // hash-object -w --stdin (empty .nojekyll)
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc123\tindex.html\n"))  // ls-tree
          // CNAME injection: hash-object FAILS
          .mockResolvedValueOnce(gitResult(false))                   // hash-object for CNAME fails
          // mktree still happens with just .nojekyll
          .mockResolvedValueOnce(gitResult(true, "newTree123\n"))    // mktree (with .nojekyll only)
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "ccc333ddd444\n"))  // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // push main

        const onProgress = vi.fn();
        await deployViaGitPush({
          owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git",
          domain: "example.com",
        });

        // mktree should have been called with .nojekyll but not CNAME
        const mktreeCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "mktree"
        );
        expect(mktreeCall).toBeDefined();
        expect(mktreeCall![0].stdin).toContain(".nojekyll");
        expect(mktreeCall![0].stdin).not.toContain("CNAME");
      });
    });

    // ========================================================================
    // .nojekyll injection (Bug 1)
    // ========================================================================
    describe(".nojekyll injection", () => {
      it("always injects .nojekyll into gh-pages tree even without domain", async () => {
        const SITE_TREE = "aaa111bbb222";
        const NOJEKYLL_BLOB = "nnn000jjj111";
        const NEW_TREE = "eee222ddd333";
        const ORPHAN_SHA = "ggg444hhh555";

        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, SITE_TREE + "\n"))  // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, NOJEKYLL_BLOB + "\n"))  // hash-object -w --stdin (empty .nojekyll)
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc123\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, NEW_TREE + "\n"))   // mktree (with .nojekyll)
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, ORPHAN_SHA + "\n")) // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // push main

        const onProgress = vi.fn();
        await deployViaGitPush({
          owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git",
          // no domain — .nojekyll should still be injected
        });

        // Verify .nojekyll blob was created with empty stdin
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["hash-object", "-w", "--stdin"],
            stdin: "",
          })
        );

        // Verify ls-tree was called on the original site tree
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["ls-tree", SITE_TREE],
          })
        );

        // Verify mktree was called with .nojekyll entry
        const mktreeCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "mktree"
        );
        expect(mktreeCall).toBeDefined();
        expect(mktreeCall![0].stdin).toContain(".nojekyll");
        expect(mktreeCall![0].stdin).toContain(NOJEKYLL_BLOB);

        // Verify commit-tree used the NEW tree (with .nojekyll), not the original
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["commit-tree", NEW_TREE, "-m", "Deploy site\n\nGenerated by moss"],
          })
        );
      });

      it("injects both .nojekyll and CNAME when domain is provided", async () => {
        const SITE_TREE = "aaa111bbb222";
        const NOJEKYLL_BLOB = "nnn000jjj111";
        const CNAME_BLOB = "fff000ccc111";
        const NEW_TREE = "eee222ddd333";
        const ORPHAN_SHA = "ggg444hhh555";

        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, SITE_TREE + "\n"))  // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, NOJEKYLL_BLOB + "\n"))  // hash-object -w --stdin (.nojekyll)
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc123\tindex.html\n"))  // ls-tree
          // CNAME injection:
          .mockResolvedValueOnce(gitResult(true, CNAME_BLOB + "\n"))  // hash-object -w --stdin (CNAME)
          // mktree with both entries:
          .mockResolvedValueOnce(gitResult(true, NEW_TREE + "\n"))   // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, ORPHAN_SHA + "\n")) // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // push main

        const onProgress = vi.fn();
        await deployViaGitPush({
          owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git",
          domain: "example.com",
        });

        // Verify mktree contains both .nojekyll and CNAME
        const mktreeCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "mktree"
        );
        expect(mktreeCall).toBeDefined();
        expect(mktreeCall![0].stdin).toContain(".nojekyll");
        expect(mktreeCall![0].stdin).toContain(NOJEKYLL_BLOB);
        expect(mktreeCall![0].stdin).toContain("CNAME");
        expect(mktreeCall![0].stdin).toContain(CNAME_BLOB);

        // Single mktree call — combined pass
        const mktreeCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "mktree"
        );
        expect(mktreeCalls).toHaveLength(1);
      });
    });

    // ========================================================================
    // DeployResult return type (Bug 2)
    // ========================================================================
    describe("DeployResult return type", () => {
      it("returns DeployResult with commitSha and orphanSha", async () => {
        setupFullDeployMocks("abc1234");

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Should return DeployResult object instead of string
        expect(result).toHaveProperty("commitSha");
        expect(result).toHaveProperty("orphanSha");
        expect((result as DeployResult).commitSha).toBe("abc1234");
        expect((result as DeployResult).orphanSha).toBe("ccc333ddd444");
      });

      it("returns empty commitSha when no source changes to deploy", async () => {
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "newTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(true))                    // git diff --cached --quiet SUCCESS (no changes)
          .mockResolvedValueOnce(gitResult(true, "0\n"));            // rev-list --count (no unpushed commits)

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect((result as DeployResult).commitSha).toBe("");
        expect((result as DeployResult).orphanSha).toBe("bbb222");
      });

      it("returns orphanSha even for fresh repo (write-tree always succeeds)", async () => {
        // In the new flow, write-tree produces a valid tree even for fresh repos.
        // gh-pages is always pushed. Only commitSha may be empty (no source changes).
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse --git-dir (no .git)
          .mockResolvedValueOnce(gitResult(true))                    // git init
          .mockResolvedValueOnce(gitResult(true))                    // git config user.email
          .mockResolvedValueOnce(gitResult(true))                    // git config user.name
          .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
          .mockResolvedValueOnce(gitResult(false))                   // git fetch (fails, first deploy)
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "4b825dc\n"))       // write-tree --prefix (empty tree)
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, ""))                // ls-tree (empty)
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan123\n"))     // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(true))                    // git diff --cached --quiet (no changes)
          .mockResolvedValueOnce(gitResult(true, "0\n"));            // rev-list --count (no unpushed commits)

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect((result as DeployResult).commitSha).toBe("");
        expect((result as DeployResult).orphanSha).toBe("orphan123");
      });
    });

    // ========================================================================
    // Regression: generation dir path (prevents .moss/build/site/ or .moss/site/ bug)
    // ========================================================================
    describe("path regression: current generation dir", () => {
      it("uses .moss/build/generations/<id>/ for git add (not .moss/build/site/ or .moss/site/)", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Verify git add uses the resolved generation dir, not the legacy .moss/build/site/
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["add", `${GEN_DIR}/`],
          })
        );

        // Verify NO call uses the old .moss/site/ or .moss/build/site/ path
        const oldPathCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" &&
            call[0].args.some(
              (arg: string) =>
                arg === ".moss/site/" ||
                arg === "--prefix=.moss/site/" ||
                arg === ".moss/build/site/" ||
                arg === "--prefix=.moss/build/site/"
            )
        );
        expect(oldPathCalls).toHaveLength(0);
      });

      it("uses .moss/build/generations/<id>/ for write-tree --prefix (not .moss/build/site/ or .moss/site/)", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Verify write-tree uses the resolved generation dir prefix
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["write-tree", `--prefix=${GEN_DIR}/`],
          })
        );
      });

      it("migration sed strips both .moss and !.moss rules from root .gitignore", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Gitignore ownership for .moss/ moved to .moss/.gitignore (Rust-managed).
        // The plugin only strips stale .moss/* and !.moss/* lines from the root
        // gitignore for users upgrading from older moss versions.
        const shCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "sh" && (call[0].args[1] as string).includes("sed")
        );
        expect(shCall).toBeDefined();
        const cmd = shCall![0].args[1] as string;

        // Deletes lines starting with .moss (ignore rules)
        expect(cmd).toContain("/^\\.moss/d");
        // Deletes lines starting with !.moss (un-ignore rules)
        expect(cmd).toContain("/^!\\.moss/d");
      });
    });

    // ========================================================================
    // Tree comparison: treeChanged flag in DeployResult
    // ========================================================================
    describe("treeChanged flag", () => {
      it("returns treeChanged=true when tree SHA differs from previous gh-pages", async () => {
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "newSiteTree\n"))   // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          // Previous gh-pages exists with DIFFERENT tree:
          .mockResolvedValueOnce(gitResult(true, "prevGhPagesTip\n"))  // rev-parse refs/remotes/origin/gh-pages
          .mockResolvedValueOnce(gitResult(true, "oldTreeSha\n"))    // rev-parse prevGhPagesTip^{tree} (different from modTree)
          .mockResolvedValueOnce(gitResult(true, "newOrphanSha\n"))  // commit-tree -p prevGhPagesTip
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // push main

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect(result.treeChanged).toBe(true);
      });

      it("returns treeChanged=false when tree SHA matches previous gh-pages", async () => {
        // The key: mktree returns "modTree" and the previous gh-pages tree is also "modTree"
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "siteTree\n"))      // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree (treeSha = "modTree")
          // Previous gh-pages exists with SAME tree:
          .mockResolvedValueOnce(gitResult(true, "prevGhPagesTip\n"))  // rev-parse refs/remotes/origin/gh-pages
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // rev-parse prevGhPagesTip^{tree} (SAME as modTree)
          .mockResolvedValueOnce(gitResult(true, "newOrphanSha\n"))  // commit-tree -p prevGhPagesTip
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // push main

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect(result.treeChanged).toBe(false);
      });

      it("returns treeChanged=true when no previous gh-pages exists (first deploy)", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // First deploy: no previous gh-pages ref, so tree is always "changed"
        expect(result.treeChanged).toBe(true);
      });
    });

    // ========================================================================
    // Stale lock cleanup: both index.lock and shallow.lock
    // ========================================================================
    describe("stale lock cleanup", () => {
      it("removes both index.lock and shallow.lock before staging", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Verify rm -f .git/index.lock was called
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "rm",
            args: ["-f", ".git/index.lock"],
          })
        );

        // Verify rm -f .git/shallow.lock was called
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "rm",
            args: ["-f", ".git/shallow.lock"],
          })
        );
      });

      it("cleans lock files before git add", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Find the indices of the lock removal and first git add
        const indexLockIdx = mockExecuteBinary.mock.calls.findIndex(
          (call) => call[0].binaryPath === "rm" && call[0].args.includes(".git/index.lock")
        );
        const shallowLockIdx = mockExecuteBinary.mock.calls.findIndex(
          (call) => call[0].binaryPath === "rm" && call[0].args.includes(".git/shallow.lock")
        );
        const gitAddIdx = mockExecuteBinary.mock.calls.findIndex(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "add"
        );

        // Both lock removals must come before git add
        expect(indexLockIdx).toBeLessThan(gitAddIdx);
        expect(shallowLockIdx).toBeLessThan(gitAddIdx);
      });
    });

    // ========================================================================
    // Source backup: push existing unpushed commits when working tree is clean
    // ========================================================================
    describe("source backup push for unpushed commits", () => {
      it("pushes main when diff --cached --quiet succeeds but unpushed commits exist", async () => {
        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "siteTree\n"))      // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphanSha\n"))     // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large files (none)
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(true))                    // git diff --cached --quiet SUCCESS (clean working tree)
          // But local has unpushed commits:
          .mockResolvedValueOnce(gitResult(true, "3\n"))             // rev-list --count origin/main..HEAD → 3 unpushed
          .mockResolvedValueOnce(gitResult(true));                   // git push main (pushes the 3 pending commits)

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect(result.commitSha).toBe("");  // No new commit (working tree was clean)
        expect(result.orphanSha).toBe("orphanSha");

        // Verify rev-list was called to check for unpushed commits
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["rev-list", "--count", "origin/main..HEAD"],
          })
        );

        // Verify push to main still happened (for the unpushed commits)
        const pushCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
        );
        expect(pushCalls).toHaveLength(2);  // gh-pages + main
        expect(pushCalls[1][0].args).toEqual(["push", pushUrl, "HEAD:refs/heads/main"]);
      });

      it("does not push main when working tree is clean and no unpushed commits", async () => {
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "siteTree\n"))      // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphanSha\n"))     // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large files (none)
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(true))                    // git diff --cached --quiet SUCCESS (clean)
          .mockResolvedValueOnce(gitResult(true, "0\n"));            // rev-list --count → 0 (no unpushed)

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect(result.commitSha).toBe("");

        // Only ONE push call (gh-pages only, NO main push)
        const pushCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
        );
        expect(pushCalls).toHaveLength(1);
      });
    });

    // ========================================================================
    // Corrupt git recovery (auto-reinitialize on corrupt .git)
    // ========================================================================
    describe("corrupt git recovery", () => {
      it("retries deploy after wiping corrupt .git when push fails with 'Could not read' error", async () => {
        const corruptPushError = "error: Could not read 6077fdfa2120f56c44a1504a3d05deac53a83781\n" +
          "fatal: Failed to traverse parents of commit 6e3a40c7dae586b51d844ecdcec03ec8da841a32\n" +
          "fatal: the remote end hung up unexpectedly";

        // First attempt: full deploy sequence, push fails with corrupt error
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan1\n"))       // commit-tree
          .mockResolvedValueOnce(gitResult(false, "", corruptPushError))  // push gh-pages FAILS (corrupt)
          // Recovery: rm -rf .git
          .mockResolvedValueOnce(gitResult(true))                    // rm -rf .git
          // Retry: full deploy sequence again (needsInit = true since .git was removed)
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse --git-dir (no .git)
          .mockResolvedValueOnce(gitResult(true))                    // git init
          .mockResolvedValueOnce(gitResult(true))                    // git config user.email
          .mockResolvedValueOnce(gitResult(true))                    // git config user.name
          .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
          .mockResolvedValueOnce(gitResult(false))                   // git fetch (fails, first deploy)
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging (retry):
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // write-tree --prefix=.moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree2\n"))      // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan2\n"))       // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages SUCCEEDS
          // Deferred source backup (retry):
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main def] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "def5678\n"))       // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // push main SUCCEEDS

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Should succeed on retry
        expect((result as DeployResult).commitSha).toBe("def5678");

        // Verify .git was wiped during recovery
        const rmCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "rm" && call[0].args.includes("-rf") && call[0].args.includes(".git")
        );
        expect(rmCalls.length).toBeGreaterThanOrEqual(1);

        // Verify recovery progress was reported
        expect(onProgress).toHaveBeenCalledWith(0, expect.stringContaining("Recovering"));
      });

      it("does NOT retry on non-corruption push failures", async () => {
        const authError = "fatal: Authentication failed for 'https://github.com/user/repo.git'";

        // Full deploy sequence, push fails with auth error
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan1\n"))       // commit-tree
          .mockResolvedValueOnce(gitResult(false, "", authError));    // push gh-pages FAILS (auth error)

        const onProgress = vi.fn();

        await expect(
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
        ).rejects.toThrow("git push failed");

        // Should NOT have tried to rm -rf .git for recovery
        const rmCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "rm" && call[0].args.includes("-rf") && call[0].args.includes(".git")
        );
        expect(rmCalls).toHaveLength(0);
      });

      it("throws if retry also fails", async () => {
        const corruptError = "error: Could not read abc123\nfatal: Failed to traverse parents of commit def456";

        // First attempt fails with corruption
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // write-tree --prefix=.moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan1\n"))       // commit-tree
          .mockResolvedValueOnce(gitResult(false, "", corruptError)) // push gh-pages FAILS (corrupt)
          // Recovery: rm -rf .git
          .mockResolvedValueOnce(gitResult(true))                    // rm -rf .git
          // Retry: also fails
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse --git-dir (no .git)
          .mockResolvedValueOnce(gitResult(true))                    // git init
          .mockResolvedValueOnce(gitResult(true))                    // git config user.email
          .mockResolvedValueOnce(gitResult(true))                    // git config user.name
          .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
          .mockResolvedValueOnce(gitResult(false))                   // git fetch (fails, first deploy)
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging (retry):
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // write-tree --prefix=.moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree2\n"))      // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan2\n"))       // commit-tree
          .mockResolvedValueOnce(gitResult(false, "", "fatal: some other error"));  // push gh-pages FAILS again

        const onProgress = vi.fn();

        await expect(
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
        ).rejects.toThrow("git push failed");
      });
    });
  });

  // ==========================================================================
  // Incremental deploy: git fetch + parent gh-pages
  // ==========================================================================
  describe("incremental deploy", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);
    const mockListSiteFilesWithSizes = vi.mocked(listSiteFilesWithSizes);
    const mockShowToast = vi.mocked(showToast);

    function gitResult(success: boolean, stdout = "", stderr = ""): ExecuteResult {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    const REPO_MARKER = `https://github.com/${OWNER}/${REPO}.git`;

    beforeEach(() => {
      mockExecuteBinary.mockReset();
      mockListSiteFilesWithSizes.mockReset();
      mockListSiteFilesWithSizes.mockResolvedValue([]);
      mockShowToast.mockReset();
      mockShowToast.mockResolvedValue(undefined);
    });

    it("fetches remote refs before staging to enable delta compression", async () => {
      // Full deploy sequence with git fetch added after init
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
        .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "treeSha\n"))       // write-tree --prefix=.moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob siteblob\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(true, "ghPagesTip\n"))    // rev-parse refs/remotes/origin/gh-pages
        .mockResolvedValueOnce(gitResult(true, "prevTreeSha\n"))   // rev-parse ghPagesTip^{tree} (different tree)
        .mockResolvedValueOnce(gitResult(true, "orphanSha\n"))     // commit-tree with -p parent
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
        .mockResolvedValueOnce(gitResult(true, "[main abc] Deploy\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // push main

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify git fetch was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["fetch", "--depth=1", "origin"],
        })
      );

      // Verify fetch happens BEFORE git add
      const calls = mockExecuteBinary.mock.calls.map(c => c[0].args);
      const fetchIdx = calls.findIndex(args => args[0] === "fetch");
      const addIdx = calls.findIndex(args => args[0] === "add");
      expect(fetchIdx).toBeLessThan(addIdx);
    });

    it("continues deploy when fetch fails (first deploy, no remote)", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse --git-dir (no .git)
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(false))                   // git fetch fails (no remote yet)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "treeSha\n"))       // write-tree --prefix=.moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no remote)
        .mockResolvedValueOnce(gitResult(true, "orphanSha\n"))     // commit-tree (no parent)
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // git diff (changes)
        .mockResolvedValueOnce(gitResult(true, "[main abc] Deploy\n"))  // commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // push main

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Deploy should succeed despite fetch failure
      expect(result.commitSha).toBe("abc1234");
    });

    it("parents gh-pages commit to previous tip when remote ref exists", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
        .mockResolvedValueOnce(gitResult(true))                    // git fetch
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "siteTree\n"))      // write-tree --prefix=.moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob siteblob\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(true, "prevGhPagesTip\n"))  // rev-parse refs/remotes/origin/gh-pages
        .mockResolvedValueOnce(gitResult(true, "prevTreeSha\n"))   // rev-parse prevGhPagesTip^{tree} (different tree)
        .mockResolvedValueOnce(gitResult(true, "newOrphanSha\n"))  // commit-tree -p prevGhPagesTip
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large files
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // diff (changes)
        .mockResolvedValueOnce(gitResult(true, "[main abc] Deploy\n"))  // commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // push main

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify commit-tree uses -p with previous gh-pages tip
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["commit-tree", "modTree", "-p", "prevGhPagesTip", "-m", "Deploy site\n\nGenerated by moss"],
        })
      );
    });

    it("creates orphan commit when no previous gh-pages exists", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
        .mockResolvedValueOnce(gitResult(true))                    // git fetch
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
        // Site-only staging:
        .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
        .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
        .mockResolvedValueOnce(gitResult(true, "siteTree\n"))      // write-tree --prefix=.moss/build/generations/<id>/
        .mockResolvedValueOnce(gitResult(true, "nojekyllblob\n"))  // hash-object .nojekyll
        .mockResolvedValueOnce(gitResult(true, "100644 blob siteblob\tindex.html\n"))  // ls-tree
        .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages FAILS
        .mockResolvedValueOnce(gitResult(true, "orphanSha\n"))     // commit-tree (no -p)
        .mockResolvedValueOnce(gitResult(true))                    // push gh-pages
        // Deferred source backup:
        .mockResolvedValueOnce(gitResult(true, ""))                // find large files
        .mockResolvedValueOnce(gitResult(true))                    // git add --all
        .mockResolvedValueOnce(gitResult(false))                   // diff (changes)
        .mockResolvedValueOnce(gitResult(true, "[main abc] Deploy\n"))  // commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true));                   // push main

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify commit-tree WITHOUT -p (orphan commit)
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["commit-tree", "modTree", "-m", "Deploy site\n\nGenerated by moss"],
        })
      );
    });
  });

  // ==========================================================================
  // Incremental deploy: site-only staging + deferred source backup
  // ==========================================================================
  describe("incremental deploy (site-only staging)", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);
    const mockListSiteFilesWithSizes = vi.mocked(listSiteFilesWithSizes);
    const mockShowToast = vi.mocked(showToast);

    function gitResult(success: boolean, stdout = "", stderr = ""): ExecuteResult {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    const REPO_MARKER = `https://github.com/${OWNER}/${REPO}.git`;

    beforeEach(() => {
      mockExecuteBinary.mockReset();
      mockListSiteFilesWithSizes.mockReset();
      mockListSiteFilesWithSizes.mockResolvedValue([]);
      mockShowToast.mockReset();
      mockShowToast.mockResolvedValue(undefined);
    });

    /**
     * Set up mock sequence for incremental deploy (site-only staging).
     *
     * New sequence: rev-parse --git-dir, remote get-url origin, fetch --depth=1,
     *   .gitignore, rm -f index.lock, rm -f shallow.lock,
     *   readlink .moss/build/current, git add .moss/build/generations/<id>/,
     *   git write-tree --prefix=.moss/build/generations/<id>/, .nojekyll injection,
     *   rev-parse gh-pages tip, commit-tree, push gh-pages ONLY,
     *   then deferred: find(large files), git add --all, diff, commit, push main
     */
    function setupIncrementalDeployMocks(commitSha = "abc1234") {
      mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
          .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "siteTree123\n"))   // git write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyll000\n"))   // hash-object -w --stdin (.nojekyll)
          .mockResolvedValueOnce(gitResult(true, "100644 blob siteblob\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modifiedTree\n"))  // mktree (with .nojekyll)
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse refs/remotes/origin/gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan999\n"))     // git commit-tree (orphan, no parent)
          .mockResolvedValueOnce(gitResult(true))                    // git push gh-pages ONLY
          // Deferred source backup:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none found)
          .mockResolvedValueOnce(gitResult(true))                    // git add --all
          .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
          .mockResolvedValueOnce(gitResult(true, `[main ${commitSha}] Deploy site\n`))  // git commit
          .mockResolvedValueOnce(gitResult(true, commitSha + "\n"))  // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true));                   // git push main
      }

      it("stages only current generation dir before gh-pages push (not --all)", async () => {
        setupIncrementalDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Find all git add calls
        const addCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "add"
        );

        // First add call should be the resolved generation dir only (NOT --all, NOT .moss/build/site/)
        expect(addCalls.length).toBeGreaterThanOrEqual(1);
        expect(addCalls[0][0].args).toEqual(["add", `${GEN_DIR}/`]);
      });

      it("uses write-tree --prefix to get site tree SHA directly from index", async () => {
        setupIncrementalDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["write-tree", `--prefix=${GEN_DIR}/`],
          })
        );

        // Should NOT use rev-parse HEAD:.moss/site (old approach)
        const revParseSiteCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "rev-parse" &&
            call[0].args.includes("HEAD:.moss/site")
        );
        expect(revParseSiteCalls).toHaveLength(0);
      });

      it("pushes gh-pages before staging source files", async () => {
        setupIncrementalDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;

        // Find the first push call — it should be gh-pages only (no HEAD:refs/heads/main)
        const pushCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
        );
        expect(pushCalls.length).toBeGreaterThanOrEqual(1);
        const firstPush = pushCalls[0][0].args;
        expect(firstPush).toContain("orphan999:refs/heads/gh-pages");
        expect(firstPush).not.toContain("HEAD:refs/heads/main");

        // Find the git add --all call — it should come AFTER the first push
        const addAllIndex = mockExecuteBinary.mock.calls.findIndex(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "add" &&
            call[0].args.includes("--all")
        );
        const firstPushIndex = mockExecuteBinary.mock.calls.findIndex(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
        );
        expect(addAllIndex).toBeGreaterThan(firstPushIndex);
      });

      it("defers source backup to main branch after gh-pages deploy", async () => {
        setupIncrementalDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;

        // Should have two push calls: gh-pages first, then main
        const pushCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
        );
        expect(pushCalls).toHaveLength(2);

        // Second push should be main only
        const secondPush = pushCalls[1][0].args;
        expect(secondPush).toContain("HEAD:refs/heads/main");
        expect(secondPush).not.toContain("gh-pages");
      });

      it("succeeds even when source backup fails", async () => {
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin
          .mockResolvedValueOnce(gitResult(true))                    // git fetch --depth=1 origin
          .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/shallow.lock
          // Site-only staging:
          .mockResolvedValueOnce(gitResult(true, GEN_ABS + "\n"))    // readlink .moss/build/current → abs gen path
          .mockResolvedValueOnce(gitResult(true))                    // git add .moss/build/generations/<id>/
          .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock (iCloud race)
          .mockResolvedValueOnce(gitResult(true, "siteTree123\n"))   // write-tree --prefix=.moss/build/generations/<id>/
          // .nojekyll injection:
          .mockResolvedValueOnce(gitResult(true, "nojekyll000\n"))   // hash-object
          .mockResolvedValueOnce(gitResult(true, "100644 blob abc\tindex.html\n"))  // ls-tree
          .mockResolvedValueOnce(gitResult(true, "modTree\n"))       // mktree
          .mockResolvedValueOnce(gitResult(false))                   // rev-parse gh-pages (no prev)
          .mockResolvedValueOnce(gitResult(true, "orphan999\n"))     // commit-tree
          .mockResolvedValueOnce(gitResult(true))                    // push gh-pages (succeeds)
          // Deferred source backup FAILS:
          .mockResolvedValueOnce(gitResult(true, ""))                // find large files
          .mockResolvedValueOnce(gitResult(false, "", "fatal: error"));  // git add --all fails

        const onProgress = vi.fn();
        // Should NOT throw even though source backup failed
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });
        expect(result.orphanSha).toBe("orphan999");
      });

      it("reports Deployed! before starting source backup", async () => {
        setupIncrementalDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // "Deployed!" should be called
        expect(onProgress).toHaveBeenCalledWith(100, "Deployed!");

        // Find the index of the "Deployed!" call and the "git add --all" call
        const deployedCallIndex = onProgress.mock.calls.findIndex(
          (call) => call[0] === 100 && call[1] === "Deployed!"
        );
        // The source backup git add --all should come after Deployed!
        const addAllIndex = mockExecuteBinary.mock.calls.findIndex(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "add" &&
            call[0].args.includes("--all")
        );
        const ghPagesPushIndex = mockExecuteBinary.mock.calls.findIndex(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
        );
        // The git add --all should come AFTER the gh-pages push
        expect(addAllIndex).toBeGreaterThan(ghPagesPushIndex);
    });
  });

  // ==========================================================================
  // looksLikeCorruptGit
  // ==========================================================================
  describe("looksLikeCorruptGit", () => {
    it("detects 'Could not read' errors", () => {
      expect(looksLikeCorruptGit("error: Could not read 6077fdfa2120f56c44a1504a3d05deac53a83781")).toBe(true);
    });

    it("detects 'Failed to traverse parents' errors", () => {
      expect(looksLikeCorruptGit("fatal: Failed to traverse parents of commit 6e3a40c")).toBe(true);
    });

    it("detects 'bad object' errors", () => {
      expect(looksLikeCorruptGit("fatal: bad object HEAD")).toBe(true);
    });

    it("detects 'corrupt' in error messages", () => {
      expect(looksLikeCorruptGit("error: corrupt loose object '6077fdfa'")).toBe(true);
    });

    it("returns false for authentication errors", () => {
      expect(looksLikeCorruptGit("fatal: Authentication failed")).toBe(false);
    });

    it("returns false for rejection errors", () => {
      expect(looksLikeCorruptGit("error: failed to push some refs to 'https://github.com/...'")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(looksLikeCorruptGit("")).toBe(false);
    });
  });
});
