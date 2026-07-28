/**
 * Unit tests for authentication module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hasRequiredScopes, CLIENT_ID, REQUIRED_SCOPES } from "../auth";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";

// Track httpPost calls for header verification
let httpPostCalls: Array<{ url: string; body: any; options: any }> = [];

// Mock the moss-api module to track httpPost calls
vi.mock("@symbiosis-lab/moss-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symbiosis-lab/moss-api")>();
  return {
    ...actual,
    httpPost: vi.fn(async (url: string, body: any, options: any) => {
      httpPostCalls.push({ url, body, options });
      return actual.httpPost(url, body, options);
    }),
  };
});

// Mock the utils module to prevent actual IPC calls
vi.mock("../utils", () => ({
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

describe("auth", () => {
  describe("configuration", () => {
    it("has a valid client ID", () => {
      expect(CLIENT_ID).toBeDefined();
      expect(CLIENT_ID.length).toBeGreaterThan(10);
      // GitHub OAuth client IDs start with "Ov23"
      expect(CLIENT_ID).toMatch(/^Ov/);
    });

    it("requires repo scope for gh-pages deployment", () => {
      // gh-pages deployment pushes directly - no GitHub Actions needed
      expect(REQUIRED_SCOPES).toContain("repo");
      expect(REQUIRED_SCOPES).not.toContain("workflow");
    });
  });

  describe("hasRequiredScopes", () => {
    it("returns true when all required scopes are present", () => {
      const scopes = ["repo", "user"];
      expect(hasRequiredScopes(scopes)).toBe(true);
    });

    it("returns true with exact required scopes", () => {
      const scopes = ["repo"];
      expect(hasRequiredScopes(scopes)).toBe(true);
    });

    it("returns false when repo scope is missing", () => {
      const scopes = ["user", "gist"];
      expect(hasRequiredScopes(scopes)).toBe(false);
    });

    it("returns true with additional scopes beyond repo", () => {
      const scopes = ["repo", "workflow", "user"];
      expect(hasRequiredScopes(scopes)).toBe(true);
    });

    it("returns false with empty scopes", () => {
      expect(hasRequiredScopes([])).toBe(false);
    });

    it("returns false with unrelated scopes only", () => {
      const scopes = ["user", "read:org", "gist"];
      expect(hasRequiredScopes(scopes)).toBe(false);
    });
  });

  // ==========================================================================
  // Phase 1: Origin Header Tests
  // ==========================================================================
  describe("OAuth requests include Origin header", () => {
    let ctx: MockTauriContext;

    beforeEach(() => {
      ctx = setupMockTauri();
      httpPostCalls = []; // Reset tracking
    });

    afterEach(() => {
      ctx.cleanup();
    });

    it("requestDeviceCode includes Origin header", async () => {
      // Setup mock response
      ctx.urlConfig.setResponse("https://github.com/login/device/code", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          device_code: "test-device-code",
          user_code: "TEST-CODE",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        })),
      });

      const { requestDeviceCode } = await import("../auth");
      await requestDeviceCode();

      // Find the call to device code URL
      const deviceCodeCall = httpPostCalls.find(
        call => call.url === "https://github.com/login/device/code"
      );

      expect(deviceCodeCall).toBeDefined();
      expect(deviceCodeCall?.options?.headers?.Origin).toBe("https://github.com");
    });

    it("pollForToken includes Origin header", async () => {
      // Setup mock response
      ctx.urlConfig.setResponse("https://github.com/login/oauth/access_token", {
        status: 200,
        ok: true,
        bodyBase64: btoa(JSON.stringify({
          access_token: "gho_test_token",
          token_type: "bearer",
          scope: "repo",
        })),
      });

      const { pollForToken } = await import("../auth");
      await pollForToken("test-device-code", 5);

      // Find the call to token URL
      const tokenCall = httpPostCalls.find(
        call => call.url === "https://github.com/login/oauth/access_token"
      );

      expect(tokenCall).toBeDefined();
      expect(tokenCall?.options?.headers?.Origin).toBe("https://github.com");
    });
  });
});
