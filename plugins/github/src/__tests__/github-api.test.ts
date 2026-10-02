/**
 * Tests for GitHub API Module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAuthenticatedUser,
  checkRepoNameAvailable,
  createRepository,
  isValidRepoName,
  ensurePagesSource,
  setCustomDomain,
  type GitHubUser,
  type CreatedRepository,
} from "../github-api";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// github-api.ts no longer imports from utils — no mock needed

describe("GitHub API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("isValidRepoName", () => {
    it("accepts valid repo names", () => {
      expect(isValidRepoName("my-repo")).toBe(true);
      expect(isValidRepoName("my_repo")).toBe(true);
      expect(isValidRepoName("my.repo")).toBe(true);
      expect(isValidRepoName("MyRepo123")).toBe(true);
      expect(isValidRepoName("a")).toBe(true);
      expect(isValidRepoName("123")).toBe(true);
    });

    it("rejects empty names", () => {
      expect(isValidRepoName("")).toBe(false);
    });

    it("rejects names starting with a period", () => {
      expect(isValidRepoName(".hidden")).toBe(false);
    });

    it("rejects names with invalid characters", () => {
      expect(isValidRepoName("my repo")).toBe(false);
      expect(isValidRepoName("my/repo")).toBe(false);
      expect(isValidRepoName("my@repo")).toBe(false);
      expect(isValidRepoName("my#repo")).toBe(false);
    });

    it("rejects names longer than 100 characters", () => {
      expect(isValidRepoName("a".repeat(101))).toBe(false);
      expect(isValidRepoName("a".repeat(100))).toBe(true);
    });
  });

  describe("getAuthenticatedUser", () => {
    it("returns user information on success", async () => {
      const mockUser: GitHubUser = {
        login: "testuser",
        id: 12345,
        avatar_url: "https://github.com/testuser.png",
        html_url: "https://github.com/testuser",
        name: "Test User",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUser),
      });

      const user = await getAuthenticatedUser("test-token");

      expect(user).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("throws error on invalid token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(getAuthenticatedUser("bad-token")).rejects.toThrow(
        "Invalid or expired token"
      );
    });

    it("throws error on other failures", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(getAuthenticatedUser("test-token")).rejects.toThrow(
        "Failed to get user: 500"
      );
    });
  });

  describe("checkRepoNameAvailable", () => {
    beforeEach(() => {
      // Mock getAuthenticatedUser response for all tests
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                login: "testuser",
                id: 12345,
                avatar_url: "",
                html_url: "",
              }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });
    });

    it("returns available=true when repo doesn't exist", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: "testuser" }),
          });
        }
        if (url === "https://api.github.com/repos/testuser/new-repo") {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });

      const result = await checkRepoNameAvailable("new-repo", "test-token");

      expect(result.available).toBe(true);
    });

    it("returns available=false when repo exists", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: "testuser" }),
          });
        }
        if (url === "https://api.github.com/repos/testuser/existing-repo") {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });

      const result = await checkRepoNameAvailable("existing-repo", "test-token");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("exists");
    });

    it("returns available=false for invalid name without API call", async () => {
      const result = await checkRepoNameAvailable("invalid name", "test-token");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("invalid");
      // Should not have made any API calls for invalid name
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles API errors gracefully", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: "testuser" }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });

      const result = await checkRepoNameAvailable("some-repo", "test-token");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("error");
    });
  });

  describe("createRepository", () => {
    it("creates a repository successfully", async () => {
      const mockRepo = {
        name: "my-new-repo",
        full_name: "testuser/my-new-repo",
        html_url: "https://github.com/testuser/my-new-repo",
        ssh_url: "git@github.com:testuser/my-new-repo.git",
        clone_url: "https://github.com/testuser/my-new-repo.git",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRepo),
      });

      const result = await createRepository("my-new-repo", "test-token");

      expect(result).toEqual({
        name: "my-new-repo",
        fullName: "testuser/my-new-repo",
        htmlUrl: "https://github.com/testuser/my-new-repo",
        sshUrl: "git@github.com:testuser/my-new-repo.git",
        cloneUrl: "https://github.com/testuser/my-new-repo.git",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user/repos",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"my-new-repo"'),
        })
      );
    });

    it("includes description when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "my-repo",
            full_name: "user/my-repo",
            html_url: "",
            ssh_url: "",
            clone_url: "",
          }),
      });

      await createRepository("my-repo", "test-token", "My description");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.description).toBe("My description");
    });

    it("creates public repositories", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "my-repo",
            full_name: "user/my-repo",
            html_url: "",
            ssh_url: "",
            clone_url: "",
          }),
      });

      await createRepository("my-repo", "test-token");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.private).toBe(false);
    });

    it("creates repository without auto_init (no useless initial commit)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "my-repo",
            full_name: "user/my-repo",
            html_url: "",
            ssh_url: "",
            clone_url: "",
          }),
      });

      await createRepository("my-repo", "test-token");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.auto_init).toBe(false);
    });

    it("throws error on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            message: "Repository creation failed: Name already exists",
          }),
      });

      await expect(
        createRepository("existing-repo", "test-token")
      ).rejects.toThrow("Repository creation failed: Name already exists");
    });
  });

  // ============================================================================
  // Feature 21: checkPagesStatus() tests
  // ============================================================================
  describe("checkPagesStatus", () => {
    // Import will fail until we implement the function
    let checkPagesStatus: (
      owner: string,
      repo: string,
      token: string
    ) => Promise<{ status: string; url: string }>;

    beforeEach(async () => {
      const module = await import("../github-api");
      checkPagesStatus = module.checkPagesStatus;
      mockFetch.mockReset();
    });

    it("returns 'built' when site is live", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built" }),
      });

      const result = await checkPagesStatus("testuser", "testuser.github.io", "test-token");

      expect(result.status).toBe("built");
      expect(result.url).toBe("https://testuser.github.io/");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/testuser.github.io/pages/builds/latest",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("returns 'building' when deployment in progress", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "building" }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("building");
      expect(result.url).toBe("https://testuser.github.io/my-repo");
    });

    it("returns 'errored' when deployment failed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "errored" }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("errored");
    });

    it("returns 'unknown' on 404 (no Pages configured)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("unknown");
      expect(result.url).toBe("");
    });

    it("returns 'unknown' on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("unknown");
      expect(result.url).toBe("");
    });

    it("generates correct URL for root repo (username.github.io)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built" }),
      });

      const result = await checkPagesStatus("testuser", "testuser.github.io", "test-token");

      // Root repo URL should have trailing slash, no repo path
      expect(result.url).toBe("https://testuser.github.io/");
    });

    it("generates correct URL for project repo", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built" }),
      });

      const result = await checkPagesStatus("testuser", "my-project", "test-token");

      // Project repo URL should include repo name as path
      expect(result.url).toBe("https://testuser.github.io/my-project");
    });

    // Bug 2: commit field extraction
    it("returns commit SHA from API response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built", commit: "abc123def456" }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.commit).toBe("abc123def456");
    });

    it("returns undefined commit when API response has no commit field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "building" }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.commit).toBeUndefined();
    });

    // Bug 3: error field extraction
    it("returns error message from API response when build errored", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          status: "errored",
          error: { message: "Build failed: invalid config" },
        }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("errored");
      expect(result.error).toBe("Build failed: invalid config");
    });

    it("returns undefined error when no error object in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built" }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.error).toBeUndefined();
    });
  });

  // ============================================================================
  // Feature 20: checkRepoExists() tests
  // ============================================================================
  describe("checkRepoExists", () => {
    // Import will fail until we implement the function
    let checkRepoExists: (owner: string, name: string, token: string) => Promise<boolean>;

    beforeEach(async () => {
      // Dynamic import to get the function
      const module = await import("../github-api");
      checkRepoExists = module.checkRepoExists;
      mockFetch.mockReset();
    });

    it("returns true when repo exists (200 response)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/testuser.github.io",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("returns false when repo doesn't exist (404 response)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(false);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(false);
    });

    it("returns false on other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(false);
    });
  });

  // ============================================================================
  // ensurePagesSource() tests
  // ============================================================================
  describe("ensurePagesSource", () => {
    it("creates Pages when not enabled (404)", async () => {
      // GET /pages → 404 (not enabled)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // POST /pages → 201 (created)
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });

      const result = await ensurePagesSource("testuser", "my-repo", "test-token", "gh-pages");

      expect(result).toEqual({ configured: true, wasCreated: true });

      // Verify GET was called first
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/my-repo/pages",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );

      // Verify POST was called with correct source
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/my-repo/pages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ source: { branch: "gh-pages", path: "/" } }),
        })
      );
    });

    it("updates Pages when source branch is wrong", async () => {
      // GET /pages → 200, source is main
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ source: { branch: "main", path: "/" } }),
      });
      // PUT /pages → 200 (updated)
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await ensurePagesSource("testuser", "my-repo", "test-token", "gh-pages");

      expect(result).toEqual({ configured: true, wasCreated: false });

      // Verify PUT was called to update
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/my-repo/pages",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ source: { branch: "gh-pages", path: "/" } }),
        })
      );
    });

    it("no-ops when Pages already configured correctly", async () => {
      // GET /pages → 200, source is already gh-pages
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ source: { branch: "gh-pages", path: "/" } }),
      });

      const result = await ensurePagesSource("testuser", "my-repo", "test-token", "gh-pages");

      expect(result).toEqual({ configured: true, wasCreated: false });
      // Only one call (GET), no PUT
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns configured: false when POST fails", async () => {
      // GET /pages → 404
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // POST /pages → 422 (error)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Validation failed"),
      });

      const result = await ensurePagesSource("testuser", "my-repo", "test-token", "gh-pages");

      expect(result).toEqual({ configured: false, wasCreated: false });
    });

    it("returns configured: false when PUT fails", async () => {
      // GET /pages → 200, wrong branch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ source: { branch: "main", path: "/" } }),
      });
      // PUT /pages → 500 (error)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal server error"),
      });

      const result = await ensurePagesSource("testuser", "my-repo", "test-token", "gh-pages");

      expect(result).toEqual({ configured: false, wasCreated: false });
    });

    it("returns configured: false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await ensurePagesSource("testuser", "my-repo", "test-token", "gh-pages");

      expect(result).toEqual({ configured: false, wasCreated: false });
    });
  });

  // ============================================================================
  // getRepoSshUrl() tests
  // ============================================================================
  describe("getRepoSshUrl", () => {
    let getRepoSshUrl: (owner: string, repo: string, token: string) => Promise<string>;

    beforeEach(async () => {
      const module = await import("../github-api");
      getRepoSshUrl = module.getRepoSshUrl;
      mockFetch.mockReset();
    });

    it("returns ssh_url from the API response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ssh_url: "git@github.com:alice/alice.github.io.git",
        }),
      });

      const sshUrl = await getRepoSshUrl("alice", "alice.github.io", "test-token");

      expect(sshUrl).toBe("git@github.com:alice/alice.github.io.git");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/alice/alice.github.io",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("throws when repo is not found (404)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        getRepoSshUrl("alice", "nonexistent", "test-token")
      ).rejects.toThrow("Repo not found: alice/nonexistent");
    });

    it("throws on other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        getRepoSshUrl("alice", "alice.github.io", "test-token")
      ).rejects.toThrow("Repo not found: alice/alice.github.io");
    });
  });

  // ============================================================================
  // setCustomDomain() — 404 retry behavior
  // ============================================================================
  describe("setCustomDomain", () => {
    const pagesUrl = "https://api.github.com/repos/testuser/my-repo/pages";

    it("returns true when first PUT succeeds", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await setCustomDomain("testuser", "my-repo", "test-token", "example.com");

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns true when first PUT returns 404 and retry succeeds", async () => {
      // First PUT (with https_enforced) → 404
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // Retry PUT (without https_enforced) → 200
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await setCustomDomain("testuser", "my-repo", "test-token", "example.com");

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns true when both PUTs return 404 (cert not yet provisioned)", async () => {
      // First PUT (with https_enforced) → 404
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // Retry PUT (without https_enforced) → 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('{"message":"The certificate does not exist yet"}'),
      });

      const result = await setCustomDomain("testuser", "my-repo", "test-token", "example.com");

      // Should NOT throw — CNAME is set despite the 404
      expect(result).toBe(true);
    });

    it("throws when first PUT returns 404 and retry returns 500", async () => {
      // First PUT (with https_enforced) → 404
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // Retry PUT (without https_enforced) → 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(
        setCustomDomain("testuser", "my-repo", "test-token", "example.com")
      ).rejects.toThrow("GitHub Pages API error (500)");
    });

    it("throws when first PUT returns non-retryable error", async () => {
      // First PUT → 403 (not retryable)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(
        setCustomDomain("testuser", "my-repo", "test-token", "example.com")
      ).rejects.toThrow("GitHub Pages API error (403)");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
