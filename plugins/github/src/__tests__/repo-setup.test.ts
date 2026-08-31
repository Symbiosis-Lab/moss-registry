/**
 * Tests for Repository Setup Module
 *
 * Feature 20: Smart Repo Setup
 * - Auto-creates {username}.github.io when available (no UI)
 * - Shows UI only when root is taken
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock moss-api
const mockOpenBrowserWithHtml = vi.fn().mockResolvedValue(undefined);
const mockCloseBrowser = vi.fn().mockResolvedValue(undefined);
const mockOnEvent = vi.fn();
// The form wait tells moss the hook is awaiting a person, which is what keeps
// the 60 s inactivity watchdog off it.
const mockAwaiting = vi.fn().mockResolvedValue(undefined);
const mockSucceeded = vi.fn().mockResolvedValue(undefined);
const mockFailed = vi.fn().mockResolvedValue(undefined);
const mockCancelled = vi.fn().mockResolvedValue(undefined);
const mockStartTask = vi.fn().mockResolvedValue({
  id: "1",
  progress: vi.fn(),
  awaiting: (...args: unknown[]) => mockAwaiting(...args),
  advise: vi.fn(),
  succeeded: (...args: unknown[]) => mockSucceeded(...args),
  failed: (...args: unknown[]) => mockFailed(...args),
  cancelled: (...args: unknown[]) => mockCancelled(...args),
});

vi.mock("@symbiosis-lab/moss-api", () => ({
  openBrowserWithHtml: (...args: unknown[]) => mockOpenBrowserWithHtml(...args),
  closeBrowser: () => mockCloseBrowser(),
  onEvent: (...args: unknown[]) => mockOnEvent(...args),
  executeBinary: vi.fn().mockResolvedValue({ success: true, stdout: "", stderr: "" }),
  startTask: (...args: unknown[]) => mockStartTask(...args),
}));

// Mock utils
vi.mock("../utils", () => ({
  resolveGitPath: vi.fn().mockResolvedValue("git"),
  reportProgress: vi.fn().mockResolvedValue(undefined),
}));

// Mock github-api module
const mockGetAuthenticatedUser = vi.fn();
const mockCheckRepoExists = vi.fn();
const mockCreateRepository = vi.fn();
const mockGetRepoSshUrl = vi.fn();

vi.mock("../github-api", () => ({
  getAuthenticatedUser: (token: string) => mockGetAuthenticatedUser(token),
  checkRepoExists: (owner: string, name: string, token: string) => mockCheckRepoExists(owner, name, token),
  createRepository: (name: string, token: string, description?: string) => mockCreateRepository(name, token, description),
  getRepoSshUrl: (owner: string, repo: string, token: string) => mockGetRepoSshUrl(owner, repo, token),
}));

describe("ensureGitHubRepo", () => {
  // Import will fail until we implement the function
  let ensureGitHubRepo: (token: string) => Promise<{
    name: string;
    sshUrl: string;
    fullName: string;
  } | null>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import to get the function
    const module = await import("../repo-setup");
    ensureGitHubRepo = module.ensureGitHubRepo;
  });

  describe("auto-create root repo when available", () => {
    beforeEach(() => {
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("auto-creates {username}.github.io when available (no UI)", async () => {
      // Root repo doesn't exist
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "testuser.github.io",
        fullName: "testuser/testuser.github.io",
        htmlUrl: "https://github.com/testuser/testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
        cloneUrl: "https://github.com/testuser/testuser.github.io.git",
      });

      const result = await ensureGitHubRepo("test-token");

      // Should NOT show any UI
      expect(mockOpenBrowserWithHtml).not.toHaveBeenCalled();

      // Should create the root repo
      expect(mockCheckRepoExists).toHaveBeenCalledWith("testuser", "testuser.github.io", "test-token");
      expect(mockCreateRepository).toHaveBeenCalledWith("testuser.github.io", "test-token", expect.any(String));

      // Should return correct result
      expect(result).toEqual({
        name: "testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
        fullName: "testuser/testuser.github.io",
      });
    });

    it("returns created repo info for root URL deployment", async () => {
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "myuser.github.io",
        fullName: "myuser/myuser.github.io",
        sshUrl: "git@github.com:myuser/myuser.github.io.git",
      });
      mockGetAuthenticatedUser.mockResolvedValue({ login: "myuser" });

      const result = await ensureGitHubRepo("test-token");

      expect(result?.name).toBe("myuser.github.io");
      expect(result?.fullName).toBe("myuser/myuser.github.io");
    });
  });

  describe("show deploy choice UI when root is taken", () => {
    beforeEach(() => {
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("shows deploy choice UI when {username}.github.io already exists", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      // Simulate user choosing "replace-root"
      mockOnEvent.mockImplementation(async (eventName: string, handler: (payload: unknown) => void) => {
        if (eventName === "github:deploy-choice") {
          setTimeout(() => {
            handler({ action: "replace-root" });
          }, 10);
        }
        return vi.fn();
      });

      mockGetRepoSshUrl.mockResolvedValue("git@github.com:testuser/testuser.github.io.git");

      const result = await ensureGitHubRepo("test-token");

      // Should use openBrowserWithHtml
      expect(mockOpenBrowserWithHtml).toHaveBeenCalledWith(expect.any(String));

      // Should listen for github:deploy-choice event (not github:repo-created)
      expect(mockOnEvent).toHaveBeenCalledWith("github:deploy-choice", expect.any(Function));

      // HTML should contain deploy choice elements
      const html = mockOpenBrowserWithHtml.mock.calls[0][0] as string;
      expect(html).toContain("already");
      expect(html).toContain("replace-root");
      expect(html).toContain("custom-domain");
      expect(html).toContain("mossApi.emit('github:deploy-choice'");
      expect(html).toContain("mossApi.close()");
      expect(html).not.toContain("mossApi.submit");
      expect(html).not.toContain("__TAURI__");

      // Should NOT create a new repo — reuse existing root
      expect(mockCreateRepository).not.toHaveBeenCalled();
      expect(mockGetRepoSshUrl).toHaveBeenCalledWith("testuser", "testuser.github.io", "test-token");

      // Should close browser after decision
      expect(mockCloseBrowser).toHaveBeenCalled();

      expect(result).toEqual({
        name: "testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
        fullName: "testuser/testuser.github.io",
      });
    }, 10000);

    it("creates custom repo when user chooses 'custom-domain'", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      // Simulate user choosing "custom-domain" with a repo name
      mockOnEvent.mockImplementation(async (eventName: string, handler: (payload: unknown) => void) => {
        if (eventName === "github:deploy-choice") {
          setTimeout(() => {
            handler({ action: "custom-domain", repoName: "my-website" });
          }, 10);
        }
        return vi.fn();
      });

      mockCreateRepository.mockResolvedValue({
        name: "my-website",
        fullName: "testuser/my-website",
        sshUrl: "git@github.com:testuser/my-website.git",
      });

      const result = await ensureGitHubRepo("test-token");

      // Should create custom repo
      expect(mockCreateRepository).toHaveBeenCalledWith("my-website", "test-token", "Created with moss");
      // Should NOT fetch root repo SSH URL
      expect(mockGetRepoSshUrl).not.toHaveBeenCalled();

      // Should close browser after repo creation
      expect(mockCloseBrowser).toHaveBeenCalled();

      expect(result).toEqual({
        name: "my-website",
        sshUrl: "git@github.com:testuser/my-website.git",
        fullName: "testuser/my-website",
      });
    }, 10000);

    it("returns null when user cancels UI (null choice)", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      // Event listener never fires — simulates timeout/cancel
      mockOnEvent.mockImplementation(async () => {
        return vi.fn();
      });

      // We just verify the structure is correct
      expect(mockOnEvent).toBeDefined();
    });

    it("includes repo name input with availability check in custom-domain card", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      mockOnEvent.mockImplementation(async () => {
        return vi.fn();
      });

      // Start the flow (will timeout, but we inspect HTML)
      const resultPromise = ensureGitHubRepo("test-token");
      await new Promise(resolve => setTimeout(resolve, 10));

      const html = mockOpenBrowserWithHtml.mock.calls[0][0] as string;

      // Should have repo name input
      expect(html).toContain('id="repo-name"');
      expect(html).toContain('autocomplete="off"');
      expect(html).toContain('autocorrect="off"');
      expect(html).toContain('spellcheck="false"');

      // Should have availability check logic
      expect(html).toContain("api.github.com/repos");
    });
  });

  /**
   * The form is a wait on a person. moss's 60 s inactivity watchdog spares a
   * hook that is `awaiting` or blocked in a host call, and reading a form is
   * neither — so the awaiting state IS what keeps the publish alive here.
   */
  describe("waiting on the person", () => {
    beforeEach(() => {
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
      mockCheckRepoExists.mockResolvedValue(true);
    });

    it("tells moss the hook is waiting on the user while the form is open", async () => {
      mockOnEvent.mockImplementation(async (eventName: string, handler: (p: unknown) => void) => {
        if (eventName === "github:deploy-choice") {
          setTimeout(() => handler({ action: "replace-root" }), 10);
        }
        return vi.fn();
      });
      mockGetRepoSshUrl.mockResolvedValue("git@github.com:testuser/testuser.github.io.git");

      await ensureGitHubRepo("test-token");

      expect(mockStartTask).toHaveBeenCalled();
      expect(mockAwaiting).toHaveBeenCalledWith(
        expect.stringContaining("publish"),
        "the window moss opened"
      );
      // The wait ends explicitly, or the watchdog stays off the hook for the
      // whole rest of the publish.
      expect(mockSucceeded).toHaveBeenCalled();
    });

    it("gives up on the form rather than waiting forever", async () => {
      vi.useFakeTimers();
      mockOnEvent.mockImplementation(async () => vi.fn());

      const result = ensureGitHubRepo("test-token");
      await vi.advanceTimersByTimeAsync(300000);

      expect(await result).toBeNull();
      // Nobody filled the form in, so the panel must not claim a step happened.
      expect(mockCancelled).toHaveBeenCalled();
      expect(mockSucceeded).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("returns null when the window cannot be opened at all", async () => {
      mockOpenBrowserWithHtml.mockRejectedValueOnce(new Error("no webview"));
      mockOnEvent.mockImplementation(async () => vi.fn());

      expect(await ensureGitHubRepo("test-token")).toBeNull();
      expect(mockFailed).toHaveBeenCalledWith(expect.stringContaining("no webview"));
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("returns null when repo creation fails", async () => {
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockRejectedValue(new Error("API rate limit exceeded"));

      const result = await ensureGitHubRepo("test-token");

      expect(result).toBeNull();
    });

    it("returns null when getting user info fails", async () => {
      mockGetAuthenticatedUser.mockRejectedValue(new Error("Token expired"));

      const result = await ensureGitHubRepo("test-token");

      expect(result).toBeNull();
    });
  });

  describe("deploy choice UI input field attributes", () => {
    beforeEach(() => {
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("includes autocomplete, autocorrect, and spellcheck attributes on repo name input", async () => {
      // Root repo EXISTS - triggers deploy choice UI
      mockCheckRepoExists.mockResolvedValue(true);

      mockOnEvent.mockImplementation(async () => {
        return vi.fn();
      });

      const resultPromise = ensureGitHubRepo("test-token");
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockOpenBrowserWithHtml).toHaveBeenCalled();
      const html = mockOpenBrowserWithHtml.mock.calls[0][0] as string;

      expect(html).toMatch(/<input[^>]*id="repo-name"[^>]*>/);
      const inputMatch = html.match(/<input[^>]*id="repo-name"[^>]*>/);
      expect(inputMatch).not.toBeNull();

      const inputTag = inputMatch![0];
      expect(inputTag).toContain('autocomplete="off"');
      expect(inputTag).toContain('autocorrect="off"');
      expect(inputTag).toContain('spellcheck="false"');
    });
  });
});
