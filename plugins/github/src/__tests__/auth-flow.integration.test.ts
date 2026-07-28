/**
 * Integration tests for GitHub OAuth Device Flow authentication
 *
 * Tests the complete authentication flow including:
 * - Device code request
 * - Token polling with various response states
 * - Token validation and scope checking
 * - Credential storage
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 *
 * NOTE: Some tests require moss-api >= 0.5.4 with browser/dialog tracking fixes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";

// Check if browser tracking with setters is available (requires moss-api >= 0.5.4)
// Try to set isOpen - if it fails, the setters aren't available
const testCtx = setupMockTauri();
let hasBrowserSetters = false;
try {
  // @ts-ignore - testing if setter exists
  testCtx.browserTracker.isOpen = true;
  hasBrowserSetters = testCtx.browserTracker.isOpen === true;
} catch {
  hasBrowserSetters = false;
}
testCtx.cleanup();

// Mock the utils module to prevent actual IPC calls
vi.mock("../utils", () => ({
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined), // Don't actually wait
}));

// Import after mocking
import {
  requestDeviceCode,
  pollForToken,
  validateToken,
  checkAuthentication,
  promptLogin,
  hasRequiredScopes,
  CLIENT_ID,
  REQUIRED_SCOPES,
} from "../auth";

// Import token cache clear function
import { clearTokenCache } from "../token";

// Import the mock fetch helper for GitHub API
import {
  createMockFetch,
  setupGitHubApiMocks,
  defaultDeviceCodeResponse,
  defaultTokenResponse,
  defaultUserResponse,
  authorizationPendingResponse,
  expiredTokenResponse,
  accessDeniedResponse,
} from "../../test-helpers/mock-github-api";

// Store original fetch to restore later
const originalFetch = global.fetch;

// Mock fetch for individual tests
let mockFetch: ReturnType<typeof vi.fn>;

describe("GitHub OAuth Device Flow", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();
    // Reset mockFetch to a vi.fn() for tests that need custom mock
    mockFetch = vi.fn();
    // Clear token cache to ensure test isolation
    clearTokenCache();
  });

  afterEach(() => {
    ctx.cleanup();
    // Restore original fetch
    global.fetch = originalFetch;
  });

  // ==========================================================================
  // Device Code Request Tests
  // ==========================================================================
  // Uses ctx.urlConfig.setResponse() to mock httpPost Tauri IPC calls

  describe("requestDeviceCode", () => {
    it("successfully requests a device code from GitHub", async () => {
      const mockResponse = {
        device_code: "test-device-code-123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      };

      ctx.urlConfig.setResponse("https://github.com/login/device/code", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify(mockResponse)),
      });

      const result = await requestDeviceCode();

      expect(result.device_code).toBe("test-device-code-123");
      expect(result.user_code).toBe("ABCD-1234");
      expect(result.verification_uri).toBe("https://github.com/login/device");
    });

    // Note: "includes required scopes in request" test was removed because
    // we can't verify request body content with Tauri IPC mocking.
    // The scopes are verified by GitHub's actual API response.

    it("throws error on HTTP failure", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/device/code", {
        status: 500,
        ok: false,
        bodyBase64: btoa("Internal Server Error"),
      });

      await expect(requestDeviceCode()).rejects.toThrow("Failed to request device code");
    });

    it("throws error on GitHub API error response", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/device/code", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          error: "invalid_client",
          error_description: "Client ID is invalid",
        })),
      });

      await expect(requestDeviceCode()).rejects.toThrow("GitHub error: Client ID is invalid");
    });
  });

  // ==========================================================================
  // Token Polling Tests
  // ==========================================================================
  // Uses ctx.urlConfig.setResponse() to mock httpPost Tauri IPC calls

  describe("pollForToken", () => {
    it("returns access token on success", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          access_token: "gho_xxxxxxxxxxxx",
          token_type: "bearer",
          scope: "repo,workflow",
        })),
      });

      const result = await pollForToken("device-code-123", 5);

      expect(result.access_token).toBe("gho_xxxxxxxxxxxx");
    });

    it("returns authorization_pending when user hasn't authorized", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          error: "authorization_pending",
          error_description: "The authorization request is still pending",
        })),
      });

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("authorization_pending");
      expect(result.access_token).toBeUndefined();
    });

    it("returns slow_down when polling too frequently", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          error: "slow_down",
          error_description: "Please slow down",
          interval: 10,
        })),
      });

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("slow_down");
    });

    it("returns expired_token when device code expires", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          error: "expired_token",
          error_description: "The device code has expired",
        })),
      });

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("expired_token");
    });

    it("returns access_denied when user denies authorization", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          error: "access_denied",
          error_description: "The user denied the authorization request",
        })),
      });

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("access_denied");
    });

    it("throws error on HTTP failure", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 503,
        ok: false,
        bodyBase64: btoa("Service Unavailable"),
      });

      await expect(pollForToken("device-code-123", 5)).rejects.toThrow(
        "Failed to poll for token"
      );
    });
  });

  // ==========================================================================
  // Token Validation Tests
  // ==========================================================================

  describe("validateToken", () => {
    it("validates token and returns user info", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          login: "testuser",
          id: 12345,
          avatar_url: "https://github.com/avatars/testuser",
        }),
        headers: new Headers({
          "X-OAuth-Scopes": "repo, workflow, user",
        }),
      });
      global.fetch = mockFetch;

      const result = await validateToken("gho_validtoken");

      expect(result.valid).toBe(true);
      expect(result.user?.login).toBe("testuser");
      expect(result.scopes).toContain("repo");
      expect(result.scopes).toContain("workflow");
    });

    it("returns invalid for unauthorized token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
      global.fetch = mockFetch;

      const result = await validateToken("gho_invalidtoken");

      expect(result.valid).toBe(false);
      expect(result.user).toBeUndefined();
    });

    it("handles network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      global.fetch = mockFetch;

      const result = await validateToken("gho_anytoken");

      expect(result.valid).toBe(false);
    });

    it("parses empty scopes header correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({}),
      });
      global.fetch = mockFetch;

      const result = await validateToken("gho_validtoken");

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual([]);
    });
  });

  // ==========================================================================
  // Scope Validation Tests
  // ==========================================================================

  describe("hasRequiredScopes", () => {
    it("returns true when repo scope is present", () => {
      expect(hasRequiredScopes(["repo"])).toBe(true);
      expect(hasRequiredScopes(["repo", "user"])).toBe(true);
      expect(hasRequiredScopes(["repo", "workflow", "user"])).toBe(true);
    });

    it("returns false when repo scope is missing", () => {
      expect(hasRequiredScopes(["workflow"])).toBe(false);
      expect(hasRequiredScopes(["user", "gist"])).toBe(false);
    });

    it("returns false with empty scopes", () => {
      expect(hasRequiredScopes([])).toBe(false);
    });
  });

  // ==========================================================================
  // Check Authentication Tests
  // ==========================================================================

  describe("checkAuthentication", () => {
    it("returns authenticated state when valid token exists", async () => {
      // Setup: Token exists in plugin cookie storage
      // Note: setupMockTauri uses "test-plugin" and "/test/project" as defaults
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_validtoken", domain: "github.com" },
      ]);

      // Mock token validation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser", id: 12345 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(true);
      expect(result.username).toBe("testuser");
      expect(result.scopes).toContain("repo");
    });

    it("returns unauthenticated when no token exists", async () => {
      // Setup: No token in cookie storage (default empty state)
      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(false);
    });

    it("returns unauthenticated and clears invalid token", async () => {
      // Setup: Token exists but is invalid
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_expiredtoken", domain: "github.com" },
      ]);

      // Mock token validation failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(false);
    });

    it("returns unauthenticated when token lacks required scopes", async () => {
      // Setup: Token exists with insufficient scopes
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_limitedtoken", domain: "github.com" },
      ]);

      // Mock token validation - valid but missing repo scope
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({ "X-OAuth-Scopes": "user, gist" }), // Missing repo
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(false);
    });
  });

  // ==========================================================================
  // Full Login Flow Tests
  // ==========================================================================

  describe("promptLogin", () => {
    // Requires moss-api >= 0.5.4 with browser tracking setters
    it.skipIf(!hasBrowserSetters)("successfully completes device flow authentication", async () => {
      // Setup GitHub API mocks using ctx.urlConfig (for httpPost)
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1, // Short interval for test
        },
        tokenResponse: {
          access_token: "gho_newtoken",
          token_type: "bearer",
          scope: "repo,workflow",
        },
      });

      // Token is stored in cookie storage (no git credential mock needed)

      const result = await promptLogin();

      expect(result).toBe(true);
      // Now uses system browser instead of action panel (Bug 9 fix)
      expect(ctx.browserTracker.systemBrowserUrls).toContain("https://github.com/login/device");
    });

    it("fails when user denies authorization", async () => {
      // Mock device code request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        }),
      });

      // Mock token poll - access denied
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: "access_denied" }),
      });
      global.fetch = mockFetch;

      const result = await promptLogin();

      expect(result).toBe(false);
    });

    it("fails when device code expires", async () => {
      // Mock device code request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        }),
      });

      // Mock token poll - expired
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: "expired_token" }),
      });
      global.fetch = mockFetch;

      const result = await promptLogin();

      expect(result).toBe(false);
    });

    it("opens system browser with verification_uri_complete when present", async () => {
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "TEST-CODE",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=TEST-CODE",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_newtoken",
          scope: "repo,workflow",
        },
      });

      await promptLogin();

      expect(ctx.browserTracker.systemBrowserUrls).toHaveLength(1);
      expect(ctx.browserTracker.systemBrowserUrls[0]).toBe(
        "https://github.com/login/device?user_code=TEST-CODE"
      );
    });

    // Requires moss-api >= 0.5.4 with browser tracking setters
    it.skipIf(!hasBrowserSetters)("stores token in cookie storage on success", async () => {
      // Setup GitHub API mocks using ctx.urlConfig (for httpPost)
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_storedtoken",
          scope: "repo,workflow",
        },
      });

      const result = await promptLogin();

      expect(result).toBe(true);

      // Verify token was stored in cookie storage
      const cookies = ctx.cookieStorage.getCookies(ctx.pluginName, ctx.projectPath);
      const tokenCookie = cookies.find((c) => c.name === "__github_access_token");
      expect(tokenCookie?.value).toBe("gho_storedtoken");
    });

    it("handles network errors during device code request", async () => {
      // Setup URL to return error status (simulates network error)
      ctx.urlConfig.setResponse("https://github.com/login/device/code", {
        status: 0, // Network error
        ok: false,
        bodyBase64: "",
      });

      const result = await promptLogin();

      expect(result).toBe(false);
    });

    it("opens auth UI panel with the user code", async () => {
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=ABCD-1234",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_token",
          scope: "repo,workflow",
        },
      });

      await promptLogin();

      // Auth UI panel was opened via openBrowserWithHtml
      expect(ctx.browserTracker.htmlContent).toHaveLength(1);
      const html = ctx.browserTracker.htmlContent[0];
      expect(html).toContain("ABCD-1234"); // User code displayed
      expect(html).toContain("Authorize moss on GitHub");
      expect(html).toContain("Copy code");
      expect(html).toContain("github:auth-cancel");
      expect(html).toContain("github:auth-state");
    });

    it("prefers verification_uri_complete for system browser URL", async () => {
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "TEST-CODE",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=TEST-CODE",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_newtoken",
          scope: "repo,workflow",
        },
      });

      await promptLogin();

      expect(ctx.browserTracker.systemBrowserUrls).toHaveLength(1);
      expect(ctx.browserTracker.systemBrowserUrls[0]).toBe(
        "https://github.com/login/device?user_code=TEST-CODE"
      );
    });

    it("falls back to verification_uri when complete is absent", async () => {
      ctx.urlConfig.setResponse("https://github.com/login/device/code", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          device_code: "test-device-code",
          user_code: "TEST-CODE",
          verification_uri: "https://github.com/login/device",
          // verification_uri_complete intentionally absent
          expires_in: 900,
          interval: 1,
        })),
      });
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          access_token: "gho_newtoken",
          scope: "repo,workflow",
        })),
      });

      await promptLogin();

      expect(ctx.browserTracker.systemBrowserUrls[0]).toBe("https://github.com/login/device");
    });

    it("closes auth UI panel on success", async () => {
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=ABCD-1234",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_token",
          scope: "repo,workflow",
        },
      });

      await promptLogin();

      // Auth UI panel should be closed after successful auth
      expect(ctx.browserTracker.closeCount).toBeGreaterThanOrEqual(1);
    });

  });

  // ==========================================================================
  // Bug 8: Git credential helper integration
  // ==========================================================================
  describe("checkAuthentication with git credentials (Bug 8)", () => {
    it("checks git credential helper when no plugin cookie exists", async () => {
      // Setup: No token in cookie storage (default empty state)
      // But git credential helper has a valid token
      ctx.binaryConfig.setResult("git credential fill", {
        success: true,
        exitCode: 0,
        stdout: "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghp_gittoken\n",
        stderr: "",
      });

      // Mock token validation for the git token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "gituser", id: 67890 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      // Should be authenticated using git token
      expect(result.isAuthenticated).toBe(true);
      expect(result.username).toBe("gituser");
    });

    it("stores git token in plugin cookies for faster future access", async () => {
      // Setup: No token in cookie storage
      // Git credential helper has a valid token
      ctx.binaryConfig.setResult("git credential fill", {
        success: true,
        exitCode: 0,
        stdout: "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghp_cached\n",
        stderr: "",
      });

      // Mock token validation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      await checkAuthentication();

      // Token should be stored in cookies for faster future access
      const cookies = ctx.cookieStorage.getCookies(ctx.pluginName, ctx.projectPath);
      const tokenCookie = cookies.find((c) => c.name === "__github_access_token");
      expect(tokenCookie?.value).toBe("ghp_cached");
    });

    it("prefers plugin cookie token over git token when both exist", async () => {
      // Setup: Token exists in cookie storage
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_cookietoken", domain: "github.com" },
      ]);

      // Git credential helper also has a token (should not be checked)
      ctx.binaryConfig.setResult("git credential fill", {
        success: true,
        exitCode: 0,
        stdout: "protocol=https\nhost=github.com\npassword=ghp_gittoken\n",
        stderr: "",
      });

      // Mock token validation - only cookie token validation should be called
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "cookieuser", id: 11111 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      // Should use cookie token, not git token
      expect(result.isAuthenticated).toBe(true);
      expect(result.username).toBe("cookieuser");
      // Should NOT have called git credential fill (verify fetch was only called once)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
