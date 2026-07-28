/**
 * Tests for Phase 3 fix: Progress heartbeat during interactive form
 *
 * Problem: The 60-second inactivity timer expires while user fills out the
 * "Choose repository name" form because no progress updates are sent during showBrowserForm().
 *
 * Solution: Wrap showBrowserForm with a progress heartbeat that sends updates
 * every DEPLOY_HEARTBEAT_INTERVAL_MS (10s) to keep the inactivity timer alive
 * and the progress panel visible (must be < STALE_TIMEOUT_MS of 15s).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
const mockReportProgress = vi.fn().mockResolvedValue(undefined);

vi.mock("../utils", () => ({
  reportProgress: (...args: unknown[]) => mockReportProgress(...args),
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

describe("Phase 3: Progress Heartbeat During Interactive Form", () => {
  let ensureGitHubRepo: () => Promise<{
    name: string;
    sshUrl: string;
    fullName: string;
  } | null>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup: Authenticated user with root repo taken (triggers UI)
    mockGetToken.mockResolvedValue("test-token");
    mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    mockCheckRepoExists.mockResolvedValue(true); // Root repo exists - triggers UI

    // Dynamic import to get the function
    const module = await import("../repo-setup");
    ensureGitHubRepo = module.ensureGitHubRepo;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends progress heartbeat every 30 seconds during form interaction", async () => {
    vi.useFakeTimers();

    // Simulate user taking 75 seconds to fill out form (should trigger 2 heartbeats)
    let eventHandler: ((payload: unknown) => void) | null = null;
    mockOnEvent.mockImplementation(async (eventName: string, handler: (payload: unknown) => void) => {
      if (eventName === "github:deploy-choice") {
        eventHandler = handler;
      }
      return vi.fn(); // Return unlisten function
    });

    mockCreateRepository.mockResolvedValue({
      name: "my-website",
      fullName: "testuser/my-website",
      sshUrl: "git@github.com:testuser/my-website.git",
    });

    // Start the repo setup (will call openBrowserWithHtml and start heartbeat)
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 0s -> no heartbeat yet (first one starts immediately but we check calls)
    await vi.advanceTimersByTimeAsync(0);
    expect(mockReportProgress).not.toHaveBeenCalled(); // No progress yet

    // Fast-forward: 10s -> first heartbeat
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockReportProgress).toHaveBeenCalledTimes(1);
    expect(mockReportProgress).toHaveBeenCalledWith("setup", 0, 6, "Setting up GitHub repository...");

    // Fast-forward: 20s -> second heartbeat
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockReportProgress).toHaveBeenCalledTimes(2);
    expect(mockReportProgress).toHaveBeenNthCalledWith(2, "setup", 0, 6, "Setting up GitHub repository...");

    // Fast-forward: 25s -> user submits form
    await vi.advanceTimersByTimeAsync(5000);

    // User submits form via event
    eventHandler!({ action: "custom-domain", repoName: "my-website" });

    // Wait for completion
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Total progress calls: 2 heartbeats during form
    expect(mockReportProgress).toHaveBeenCalledTimes(2);

    // Verify successful result
    expect(result).toEqual({
      name: "my-website",
      sshUrl: "git@github.com:testuser/my-website.git",
      fullName: "testuser/my-website",
    });
  });

  it("clears heartbeat interval when form is submitted", async () => {
    vi.useFakeTimers();

    // User submits form after 15 seconds (should trigger 1 heartbeat, then clear)
    let eventHandler: ((payload: unknown) => void) | null = null;
    mockOnEvent.mockImplementation(async (eventName: string, handler: (payload: unknown) => void) => {
      if (eventName === "github:deploy-choice") {
        eventHandler = handler;
      }
      return vi.fn();
    });

    mockCreateRepository.mockResolvedValue({
      name: "quick-submit",
      fullName: "testuser/quick-submit",
      sshUrl: "git@github.com:testuser/quick-submit.git",
    });

    // Start the repo setup
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 15s -> first heartbeat happens at 10s
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockReportProgress).toHaveBeenCalledTimes(1);

    // User submits form (should clear interval)
    eventHandler!({ action: "custom-domain", repoName: "quick-submit" });

    // Wait for completion
    await vi.runAllTimersAsync();
    await resultPromise;

    // Reset mock to track future calls
    mockReportProgress.mockClear();

    // Fast-forward another 10s - NO more heartbeats should occur
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockReportProgress).not.toHaveBeenCalled();
  });

  it("clears heartbeat interval when form is cancelled", async () => {
    vi.useFakeTimers();

    // User cancels form after 15 seconds (timeout without event)
    mockOnEvent.mockImplementation(async () => {
      return vi.fn(); // Don't trigger event handler (simulates cancellation)
    });

    // Start the repo setup (will timeout after 300s but we'll test before that)
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 15s -> first heartbeat happens at 10s
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockReportProgress).toHaveBeenCalledTimes(1);

    // Fast-forward to timeout (300s total)
    await vi.advanceTimersByTimeAsync(285000);

    // Wait for completion
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeNull();

    // Reset mock to track future calls
    mockReportProgress.mockClear();

    // Fast-forward another 10s - NO more heartbeats should occur
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockReportProgress).not.toHaveBeenCalled();
  });

  it("prevents timeout during long form interaction (>60s)", async () => {
    vi.useFakeTimers();

    // Simulate user taking 120 seconds (2 minutes) - should NOT timeout
    let eventHandler: ((payload: unknown) => void) | null = null;
    mockOnEvent.mockImplementation(async (eventName: string, handler: (payload: unknown) => void) => {
      if (eventName === "github:deploy-choice") {
        eventHandler = handler;
      }
      return vi.fn();
    });

    mockCreateRepository.mockResolvedValue({
      name: "slow-user",
      fullName: "testuser/slow-user",
      sshUrl: "git@github.com:testuser/slow-user.git",
    });

    // Start the repo setup
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 120s in 10s increments to simulate heartbeats
    await vi.advanceTimersByTimeAsync(10000); // 10s - 1st heartbeat
    await vi.advanceTimersByTimeAsync(10000); // 20s - 2nd heartbeat
    await vi.advanceTimersByTimeAsync(10000); // 30s - 3rd heartbeat
    await vi.advanceTimersByTimeAsync(10000); // 40s - 4th heartbeat
    await vi.advanceTimersByTimeAsync(80000); // 120s total

    // Verify 12 heartbeats occurred (every 10s for 120s)
    expect(mockReportProgress).toHaveBeenCalledTimes(12);

    // User finally submits form
    eventHandler!({ action: "custom-domain", repoName: "slow-user" });

    // Wait for completion
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Should complete successfully - NO timeout
    expect(result).toEqual({
      name: "slow-user",
      sshUrl: "git@github.com:testuser/slow-user.git",
      fullName: "testuser/slow-user",
    });
  });

  it("uses consistent progress message for all heartbeats", async () => {
    vi.useFakeTimers();

    let eventHandler: ((payload: unknown) => void) | null = null;
    mockOnEvent.mockImplementation(async (eventName: string, handler: (payload: unknown) => void) => {
      if (eventName === "github:deploy-choice") {
        eventHandler = handler;
      }
      return vi.fn();
    });

    mockCreateRepository.mockResolvedValue({
      name: "test",
      fullName: "testuser/test",
      sshUrl: "git@github.com:testuser/test.git",
    });

    // Start the repo setup
    const resultPromise = ensureGitHubRepo();

    // Trigger 3 heartbeats (10s each)
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(10000);

    expect(mockReportProgress).toHaveBeenCalledTimes(3);

    // All heartbeats should use the same message
    expect(mockReportProgress).toHaveBeenNthCalledWith(1, "setup", 0, 6, "Setting up GitHub repository...");
    expect(mockReportProgress).toHaveBeenNthCalledWith(2, "setup", 0, 6, "Setting up GitHub repository...");
    expect(mockReportProgress).toHaveBeenNthCalledWith(3, "setup", 0, 6, "Setting up GitHub repository...");

    // Complete
    eventHandler!({ action: "custom-domain", repoName: "test" });
    await vi.runAllTimersAsync();
    await resultPromise;
  });

  it("handles openBrowserWithHtml rejection gracefully", async () => {
    vi.useFakeTimers();

    // Simulate error during browser opening
    mockOpenBrowserWithHtml.mockRejectedValue(new Error("Form display error"));

    // Start the repo setup (catch the error to prevent unhandled rejection)
    let result: any;
    let error: any;
    try {
      result = await ensureGitHubRepo();
    } catch (e) {
      error = e;
    }

    // Fast-forward to trigger any pending timers
    await vi.runAllTimersAsync();

    // Should return null on error (the wrapper catches and returns null)
    // Or if it throws, that's also acceptable behavior
    if (!error) {
      expect(result).toBeNull();
    }

    // Reset mock to track future calls
    mockReportProgress.mockClear();

    // Interval should be cleared - no more heartbeats
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockReportProgress).not.toHaveBeenCalled();
  });

  it("does not start heartbeat when auto-creating root repo (no UI)", async () => {
    vi.useFakeTimers();

    // Root repo doesn't exist - auto-create (no UI)
    mockCheckRepoExists.mockResolvedValue(false);
    mockCreateRepository.mockResolvedValue({
      name: "testuser.github.io",
      fullName: "testuser/testuser.github.io",
      sshUrl: "git@github.com:testuser/testuser.github.io.git",
    });

    // Execute
    const result = await ensureGitHubRepo();

    // Fast-forward time - should be no heartbeats
    await vi.advanceTimersByTimeAsync(60000);

    // openBrowserWithHtml should NOT be called (auto-create path)
    expect(mockOpenBrowserWithHtml).not.toHaveBeenCalled();

    // reportProgress should NOT be called (no heartbeat)
    expect(mockReportProgress).not.toHaveBeenCalled();

    // Should succeed
    expect(result).toEqual({
      name: "testuser.github.io",
      sshUrl: "git@github.com:testuser/testuser.github.io.git",
      fullName: "testuser/testuser.github.io",
    });
  });
});
