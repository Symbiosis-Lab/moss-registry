/**
 * Tests for idempotent configure_domain hook
 *
 * The orchestrator calls configure_domain multiple times:
 * 1. After DNS is configured (site may not be live yet)
 * 2. After the site is verified live via HTTP 200
 *
 * The hook must check current state and do only the next needed step:
 * - Phase 1: CNAME not set -> set it (without HTTPS enforcement)
 * - Phase 2: CNAME set, no HTTPS -> enforce HTTPS
 * - Phase 3: Fully configured -> no-op
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Hoisted setup — runs before vi.mock factories and module imports
// ============================================================================

const { mockGetPages, mockSetCustomDomain, mockEnforceHttps } = vi.hoisted(() => {
  // Provide `window` for main.ts module-scope plugin registration
  // (main.ts: window.GithubPlugin = GithubPlugin)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = globalThis;

  return {
    mockGetPages: vi.fn(),
    mockSetCustomDomain: vi.fn(),
    mockEnforceHttps: vi.fn(),
  };
});

// ============================================================================
// Mocks — must be declared before imports (vi.mock is hoisted)
// ============================================================================

vi.mock("../github-api", () => ({
  getPages: (...args: unknown[]) => mockGetPages(...args),
  setCustomDomain: (...args: unknown[]) => mockSetCustomDomain(...args),
  enforceHttps: (...args: unknown[]) => mockEnforceHttps(...args),
  // Stubs for other exports that main.ts imports
  checkPagesStatus: vi.fn(),
  ensurePagesSource: vi.fn(),
  GITHUB_API_BASE: "https://api.github.com",
  GITHUB_API_HEADERS: {},
}));

vi.mock("../github-deploy", () => ({
  getOriginOwnerRepo: vi.fn().mockResolvedValue({ owner: "testuser", repo: "testrepo" }),
  verifyRepoExists: vi.fn(),
  deployViaGitPush: vi.fn(),
}));

vi.mock("../token", () => ({
  getToken: vi.fn().mockResolvedValue("test-token-123"),
  getTokenFromGit: vi.fn().mockResolvedValue(null),
  storeToken: vi.fn(),
}));

vi.mock("../auth", () => ({
  promptLogin: vi.fn(),
  validateToken: vi.fn(),
  hasRequiredScopes: vi.fn(),
}));

vi.mock("../repo-setup", () => ({
  ensureGitHubRepo: vi.fn(),
}));

vi.mock("../git", () => ({
  buildPagesUrl: vi.fn().mockReturnValue("https://testuser.github.io/testrepo"),
  parseGitHubUrl: vi.fn(),
}));

vi.mock("../utils", () => ({
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  setCurrentHookName: vi.fn(),
  showToast: vi.fn(),
  closeBrowser: vi.fn(),
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  getTauriCore: () => ({
    invoke: vi.fn().mockResolvedValue("/usr/bin/git"),
  }),
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  dismissToast: vi.fn(),
  closeBrowser: vi.fn(),
  getPluginCookie: vi.fn(),
  setPluginCookie: vi.fn(),
  executeBinary: vi.fn(),
  listSiteFilesWithSizes: vi.fn(),
}));

// ============================================================================
// Import the function under test (after mocks are set up)
// ============================================================================

import { configure_domain } from "../main";
import type { ConfigureDomainContext } from "../types";

// ============================================================================
// Test Helpers
// ============================================================================

function makeContext(domain: string): ConfigureDomainContext {
  return {
    domain,
    deployment: {
      method: "github-pages",
      url: "https://testuser.github.io/testrepo",
      deployed_at: "2026-01-01T00:00:00Z",
      metadata: {},
    },
    project_info: {
      name: "test-project",
      version: "1.0.0",
    } as ConfigureDomainContext["project_info"],
    config: {},
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("configure_domain (idempotent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: setCustomDomain succeeds
    mockSetCustomDomain.mockResolvedValue(true);
  });

  // --------------------------------------------------------------------------
  // 1. Pages not enabled
  // --------------------------------------------------------------------------
  it("returns failure when GitHub Pages is not enabled", async () => {
    mockGetPages.mockResolvedValue(null);

    const result = await configure_domain(makeContext("example.com"));

    expect(result.success).toBe(false);
    expect(result.message).toContain("Deploy first");
    expect(mockSetCustomDomain).not.toHaveBeenCalled();
    expect(mockEnforceHttps).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 2. CNAME not set
  // --------------------------------------------------------------------------
  it("sets CNAME when pages exist but cname is null", async () => {
    mockGetPages.mockResolvedValue({ cname: null, https_enforced: false });

    const result = await configure_domain(makeContext("example.com"));

    expect(result.success).toBe(true);
    expect(mockSetCustomDomain).toHaveBeenCalledWith("testuser", "testrepo", "test-token-123", "example.com");
    expect(mockEnforceHttps).not.toHaveBeenCalled();
    expect(result.message).toContain("example.com");
  });

  // --------------------------------------------------------------------------
  // 3. CNAME wrong
  // --------------------------------------------------------------------------
  it("sets CNAME when current cname differs from requested domain", async () => {
    mockGetPages.mockResolvedValue({ cname: "old.com", https_enforced: false });

    const result = await configure_domain(makeContext("new.com"));

    expect(result.success).toBe(true);
    expect(mockSetCustomDomain).toHaveBeenCalledWith("testuser", "testrepo", "test-token-123", "new.com");
    expect(mockEnforceHttps).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 4. CNAME set, HTTPS not enforced, enforce succeeds
  // --------------------------------------------------------------------------
  it("enforces HTTPS when CNAME is set but HTTPS is not enforced", async () => {
    mockGetPages.mockResolvedValue({ cname: "example.com", https_enforced: false });
    mockEnforceHttps.mockResolvedValue(true);

    const result = await configure_domain(makeContext("example.com"));

    expect(result.success).toBe(true);
    expect(result.message).toContain("HTTPS enforced");
    expect(mockSetCustomDomain).not.toHaveBeenCalled();
    expect(mockEnforceHttps).toHaveBeenCalledWith("testuser", "testrepo", "test-token-123");
  });

  // --------------------------------------------------------------------------
  // 5. CNAME set, HTTPS not enforced, enforce fails (cert pending)
  // --------------------------------------------------------------------------
  it("returns success with pending message when HTTPS enforcement fails (cert not ready)", async () => {
    mockGetPages.mockResolvedValue({ cname: "example.com", https_enforced: false });
    mockEnforceHttps.mockResolvedValue(false);

    const result = await configure_domain(makeContext("example.com"));

    // This is NOT a failure — cert will come eventually, orchestrator will retry
    expect(result.success).toBe(true);
    expect(result.message).toContain("pending");
    expect(mockSetCustomDomain).not.toHaveBeenCalled();
    expect(mockEnforceHttps).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 6. Fully configured — no-op
  // --------------------------------------------------------------------------
  it("returns success without making API calls when fully configured", async () => {
    mockGetPages.mockResolvedValue({ cname: "example.com", https_enforced: true });

    const result = await configure_domain(makeContext("example.com"));

    expect(result.success).toBe(true);
    expect(result.message).toContain("already configured");
    expect(mockSetCustomDomain).not.toHaveBeenCalled();
    expect(mockEnforceHttps).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 7. Case-insensitive domain comparison
  // --------------------------------------------------------------------------
  it("treats domain comparison as case-insensitive", async () => {
    mockGetPages.mockResolvedValue({ cname: "Example.COM", https_enforced: true });

    const result = await configure_domain(makeContext("example.com"));

    // Should NOT try to set CNAME — domain matches (case-insensitive)
    expect(result.success).toBe(true);
    expect(mockSetCustomDomain).not.toHaveBeenCalled();
    expect(mockEnforceHttps).not.toHaveBeenCalled();
    expect(result.message).toContain("already configured");
  });

  // --------------------------------------------------------------------------
  // 8. setCustomDomain throws an error
  // --------------------------------------------------------------------------
  it("returns failure when setCustomDomain throws", async () => {
    mockGetPages.mockResolvedValue({ cname: null, https_enforced: false });
    mockSetCustomDomain.mockRejectedValue(new Error("GitHub Pages API error (500): Internal Server Error"));

    const result = await configure_domain(makeContext("example.com"));

    expect(result.success).toBe(false);
    expect(result.message).toContain("GitHub Pages API error");
  });

  // --------------------------------------------------------------------------
  // 9. getPages throws a network error
  // --------------------------------------------------------------------------
  it("returns failure when getPages throws a network error", async () => {
    mockGetPages.mockRejectedValue(new Error("fetch failed"));

    const result = await configure_domain(makeContext("example.com"));

    expect(result.success).toBe(false);
    expect(result.message).toContain("fetch failed");
  });
});
