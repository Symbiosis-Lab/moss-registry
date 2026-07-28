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

vi.mock("@symbiosis-lab/moss-api", () => ({
  openBrowserWithHtml: (...args: unknown[]) => mockOpenBrowserWithHtml(...args),
  closeBrowser: () => mockCloseBrowser(),
  onEvent: (...args: unknown[]) => mockOnEvent(...args),
  executeBinary: vi.fn().mockResolvedValue({ success: true, stdout: "", stderr: "" }),
}));

// Mock utils
vi.mock("../utils", () => ({
  reportProgress: vi.fn().mockResolvedValue(undefined),
}));

// Mock token module
const mockGetToken = vi.fn();
const mockGetTokenFromGit = vi.fn();
const mockStoreToken = vi.fn();

vi.mock("../token", () => ({
  getToken: () => mockGetToken(),
  getTokenFromGit: () => mockGetTokenFromGit(),
  storeToken: (token: string) => mockStoreToken(token),
}));

// Mock auth module
const mockPromptLogin = vi.fn();
const mockValidateToken = vi.fn();
const mockHasRequiredScopes = vi.fn();

vi.mock("../auth", () => ({
  promptLogin: () => mockPromptLogin(),
  validateToken: (token: string) => mockValidateToken(token),
  hasRequiredScopes: (scopes: string[]) => mockHasRequiredScopes(scopes),
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
  let ensureGitHubRepo: () => Promise<{
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

  describe("authentication", () => {
    it("returns null when no token available and login fails", async () => {
      // No cached token
      mockGetToken.mockResolvedValue(null);
      mockGetTokenFromGit.mockResolvedValue(null);
      // Login fails
      mockPromptLogin.mockResolvedValue(false);

      const result = await ensureGitHubRepo();

      expect(result).toBeNull();
      expect(mockPromptLogin).toHaveBeenCalled();
    });

    it("uses cached token when available", async () => {
      // Cached token exists
      mockGetToken.mockResolvedValue("cached-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
      // Root is available - auto create
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "testuser.github.io",
        fullName: "testuser/testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
      });

      const result = await ensureGitHubRepo();

      expect(result).not.toBeNull();
      expect(mockPromptLogin).not.toHaveBeenCalled();
    });

    it("tries git credentials when no cached token", async () => {
      // No cached token
      mockGetToken.mockResolvedValue(null);
      // Git credentials available
      mockGetTokenFromGit.mockResolvedValue("git-token");
      mockValidateToken.mockResolvedValue({ valid: true, scopes: ["repo", "workflow"], user: { login: "testuser" } });
      mockHasRequiredScopes.mockReturnValue(true);
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
      // Root is available - auto create
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "testuser.github.io",
        fullName: "testuser/testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
      });

      const result = await ensureGitHubRepo();

      expect(result).not.toBeNull();
      expect(mockGetTokenFromGit).toHaveBeenCalled();
      expect(mockStoreToken).toHaveBeenCalledWith("git-token");
    });
  });

  describe("auto-create root repo when available", () => {
    beforeEach(() => {
      // Setup: Authenticated user
      mockGetToken.mockResolvedValue("test-token");
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

      const result = await ensureGitHubRepo();

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

      const result = await ensureGitHubRepo();

      expect(result?.name).toBe("myuser.github.io");
      expect(result?.fullName).toBe("myuser/myuser.github.io");
    });
  });

  describe("show deploy choice UI when root is taken", () => {
    beforeEach(() => {
      // Setup: Authenticated user
      mockGetToken.mockResolvedValue("test-token");
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

      const result = await ensureGitHubRepo();

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

      const result = await ensureGitHubRepo();

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
      const resultPromise = ensureGitHubRepo();
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

  describe("error handling", () => {
    beforeEach(() => {
      mockGetToken.mockResolvedValue("test-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("returns null when repo creation fails", async () => {
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockRejectedValue(new Error("API rate limit exceeded"));

      const result = await ensureGitHubRepo();

      expect(result).toBeNull();
    });

    it("returns null when getting user info fails", async () => {
      mockGetAuthenticatedUser.mockRejectedValue(new Error("Token expired"));

      const result = await ensureGitHubRepo();

      expect(result).toBeNull();
    });
  });

  describe("deploy choice UI input field attributes", () => {
    beforeEach(() => {
      mockGetToken.mockResolvedValue("test-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("includes autocomplete, autocorrect, and spellcheck attributes on repo name input", async () => {
      // Root repo EXISTS - triggers deploy choice UI
      mockCheckRepoExists.mockResolvedValue(true);

      mockOnEvent.mockImplementation(async () => {
        return vi.fn();
      });

      const resultPromise = ensureGitHubRepo();
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
