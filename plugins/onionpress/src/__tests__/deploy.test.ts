/**
 * Unit tests for the OnionPress deploy hook (main.ts).
 *
 * The receiver client and the moss-api-backed utils are both mocked — the hook
 * is exercised in isolation, never shelling out.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DeployContext, ReceiverEndpoint } from "../types";

// ── Mock the receiver client ──────────────────────────────────────────────
vi.mock("../receiver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../receiver")>();
  return {
    discoverReceiver: vi.fn(),
    generationId: vi.fn(() => "moss-123"),
    packGeneration: vi.fn(),
    uploadGeneration: vi.fn(),
    commitGeneration: vi.fn(),
    cleanupTar: vi.fn(),
    waitForReachability: vi.fn(),
    // Real implementation — pure version-string comparison, no host-fn calls.
    receiverSupportsReachability: actual.receiverSupportsReachability,
  };
});

// ── Mock the plugin utils (moss-api wrappers) ─────────────────────────────
vi.mock("../utils", () => ({
  setCurrentHookName: vi.fn(),
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  showToast: vi.fn().mockResolvedValue(undefined),
}));

import {
  discoverReceiver,
  packGeneration,
  uploadGeneration,
  commitGeneration,
  cleanupTar,
  waitForReachability,
} from "../receiver";
import { showToast, reportError } from "../utils";
import { deploy } from "../main";

const mockDiscover = vi.mocked(discoverReceiver);
const mockPack = vi.mocked(packGeneration);
const mockUpload = vi.mocked(uploadGeneration);
const mockCommit = vi.mocked(commitGeneration);
const mockCleanup = vi.mocked(cleanupTar);
const mockWaitForReachability = vi.mocked(waitForReachability);
const mockShowToast = vi.mocked(showToast);
const mockReportError = vi.mocked(reportError);

/** A discovered receiver on the default single-user port. */
function endpoint(overrides: Partial<ReceiverEndpoint> = {}): ReceiverEndpoint {
  return {
    port: 8080,
    baseUrl: "http://127.0.0.1:8080/wp-json/onionpress/v1",
    status: {
      onion_address: "abcdef1234567890.onion",
      current_generation: null,
      receiver_version: "1.1",
      onion_reachable: null,
      onion_http_code: null,
    },
    ...overrides,
  };
}

/** Minimal DeployContext — the hook ignores its content. */
const CONTEXT = {
  project_info: {},
  config: {},
  site_files: ["index.html"],
} as unknown as DeployContext;

beforeEach(() => {
  vi.clearAllMocks();
  mockPack.mockResolvedValue("/tmp/moss-123.tar");
  mockUpload.mockResolvedValue(undefined);
  mockCommit.mockResolvedValue({ ok: true, url: "http://abcdef1234567890.onion/" });
  mockCleanup.mockResolvedValue(undefined);
  mockWaitForReachability.mockResolvedValue({ reachable: true, httpCode: "301" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Happy path
// ============================================================================

describe("deploy — success", () => {
  beforeEach(() => {
    mockDiscover.mockResolvedValue(endpoint());
  });

  it("runs discover → pack → upload → commit in order and cleans up the tar", async () => {
    const result = await deploy(CONTEXT);

    expect(result.success).toBe(true);
    expect(mockPack).toHaveBeenCalledWith("moss-123");
    expect(mockUpload).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/wp-json/onionpress/v1",
      "moss-123",
      "/tmp/moss-123.tar",
    );
    expect(mockCommit).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/wp-json/onionpress/v1",
      "moss-123",
    );
    expect(mockCleanup).toHaveBeenCalledWith("/tmp/moss-123.tar");
  });

  it("returns DeploymentInfo carrying the onion url and method 'onionpress'", async () => {
    const result = await deploy(CONTEXT);

    expect(result.deployment).toBeDefined();
    expect(result.deployment!.method).toBe("onionpress");
    expect(result.deployment!.url).toBe("http://abcdef1234567890.onion/");
    expect(result.deployment!.metadata.onion_address).toBe("abcdef1234567890.onion");
    expect(result.deployment!.metadata.generation).toBe("moss-123");
    expect(result.deployment!.metadata.port).toBe("8080");
    expect(result.deployment!.metadata.receiver_version).toBe("1.1");
    expect(typeof result.deployment!.deployed_at).toBe("string");
  });

  it("shows a success toast with a clickable onion URL", async () => {
    await deploy(CONTEXT);

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        actions: [{ label: "View site", url: "http://abcdef1234567890.onion/" }],
      }),
    );
  });
});

// ============================================================================
// No receiver
// ============================================================================

describe("deploy — no receiver", () => {
  it("fails with a Start-OnionPress toast and never packs or commits", async () => {
    mockDiscover.mockResolvedValue(null);

    const result = await deploy(CONTEXT);

    expect(result.success).toBe(false);
    expect(mockPack).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
    expect(mockShowToast.mock.calls[0][0]).toMatchObject({
      message: expect.stringContaining("OnionPress"),
    });
  });
});

// ============================================================================
// Upload failure aborts before commit
// ============================================================================

describe("deploy — failed upload aborts before commit", () => {
  it("does not call commit when /generation fails, still cleans up, and reports the error", async () => {
    mockDiscover.mockResolvedValue(endpoint());
    mockUpload.mockRejectedValue(new Error("OnionPress rejected the upload: path traversal rejected"));

    const result = await deploy(CONTEXT);

    expect(result.success).toBe(false);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
    // The tar was created before the failed upload — it must still be removed.
    expect(mockCleanup).toHaveBeenCalledWith("/tmp/moss-123.tar");
    expect(mockReportError).toHaveBeenCalled();
    expect(result.message).toContain("path traversal rejected");
  });
});

// ============================================================================
// Reachability confirmation (moss#917)
// ============================================================================

describe("deploy — reachability confirmation", () => {
  beforeEach(() => {
    mockDiscover.mockResolvedValue(endpoint());
  });

  it("says the site is live when the receiver confirms it", async () => {
    mockWaitForReachability.mockResolvedValue({ reachable: true, httpCode: "301" });

    const result = await deploy(CONTEXT);

    expect(result.success).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Your site is live.", variant: "success" }),
    );
    expect(result.deployment!.metadata.onion_reachable).toBe("true");
    expect(result.deployment!.metadata.liveness).toBe("live");
  });

  it("says NOT live — and predicts nothing — when the receiver confirms it isn't", async () => {
    // `takeover` means OnionHeaven answered, not the site: a 302 to a Wayback
    // snapshot that predates the post the user just published (moss#917).
    mockWaitForReachability.mockResolvedValue({ reachable: false, httpCode: "takeover" });

    const result = await deploy(CONTEXT);

    // The publish itself still succeeded — only the liveness claim changes.
    expect(result.success).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "info",
        message: expect.stringContaining("isn't live yet"),
        actions: [{ label: "View site", url: "http://abcdef1234567890.onion/" }],
      }),
    );
    const [{ message }] = mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1];
    expect(message).not.toMatch(/within a minute|should resolve/i);
    expect(result.deployment!.metadata.liveness).toBe("not-live");
  });

  it("claims neither way when the poll window elapses without an answer", async () => {
    // The COMMON case: descriptor publication routinely outlasts the poll
    // window. It used to show the plain success toast, which claimed live on
    // no evidence; moss settles the verdict after the publish instead.
    mockWaitForReachability.mockResolvedValue({ reachable: null, httpCode: null });

    const result = await deploy(CONTEXT);

    expect(result.success).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Published. Checking whether your site is live…",
        variant: "info",
      }),
    );
    expect(result.deployment!.metadata.onion_reachable).toBe("unknown");
    expect(result.deployment!.metadata.liveness).toBe("checking");
  });

  it("waits on the endpoint's base URL, after commit", async () => {
    await deploy(CONTEXT);

    expect(mockWaitForReachability).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/wp-json/onionpress/v1",
    );
    const commitOrder = mockCommit.mock.invocationCallOrder[0];
    const waitOrder = mockWaitForReachability.mock.invocationCallOrder[0];
    expect(waitOrder).toBeGreaterThan(commitOrder);
  });

  it("skips the poll entirely against a receiver older than 1.1 — it would never resolve", async () => {
    mockDiscover.mockResolvedValue(endpoint({
      status: {
        onion_address: "abcdef1234567890.onion",
        current_generation: null,
        receiver_version: "1",
        onion_reachable: null,
        onion_http_code: null,
      },
    }));

    const result = await deploy(CONTEXT);

    expect(mockWaitForReachability).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.deployment!.metadata.onion_reachable).toBe("unknown");
    // Same "we don't know" as any other unresolved check — an old receiver is
    // a reason we can't answer, not a reason to answer yes.
    expect(result.deployment!.metadata.liveness).toBe("checking");
  });
});

// ============================================================================
// Heartbeat
// ============================================================================

describe("deploy — inactivity-watchdog heartbeat", () => {
  it("schedules a 10s heartbeat during deploy and clears it on completion", async () => {
    mockDiscover.mockResolvedValue(endpoint());
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    await deploy(CONTEXT);

    // Scheduled with the shared heartbeat interval (10_000 ms).
    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    // Cleared with the exact handle setInterval returned (no leaked timer).
    const handle = setSpy.mock.results[0].value;
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });

  it("clears the heartbeat even when the deploy throws", async () => {
    mockDiscover.mockResolvedValue(endpoint());
    mockCommit.mockRejectedValue(new Error("commit blew up"));
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const result = await deploy(CONTEXT);

    expect(result.success).toBe(false);
    const handle = setSpy.mock.results[0].value;
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });
});
