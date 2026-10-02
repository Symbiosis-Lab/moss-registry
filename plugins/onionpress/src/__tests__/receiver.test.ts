/**
 * Unit tests for the OnionPress receiver client.
 *
 * The host-fn surface (`executeBinary`) is mocked — these tests never shell out.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the moss-api host-fn surface used by receiver.ts
vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: vi.fn(),
}));

import { executeBinary } from "@symbiosis-lab/moss-api";
import type { ExecuteResult } from "@symbiosis-lab/moss-api";

import {
  discoverReceiver,
  generationId,
  baseUrlFor,
  packGeneration,
  uploadGeneration,
  commitGeneration,
  cleanupTar,
  fetchStatus,
  waitForReachability,
  receiverSupportsReachability,
  receiverSupportsMultipartUpload,
} from "../receiver";

const mockExecuteBinary = vi.mocked(executeBinary);

/** Build an ExecuteResult. */
function exec(success: boolean, stdout = "", stderr = ""): ExecuteResult {
  return { success, exitCode: success ? 0 : 1, stdout, stderr };
}

/** A well-formed `/status` body. */
function statusBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    onion_address: "abcdef1234567890.onion",
    current_generation: null,
    receiver_version: "1",
    ...overrides,
  });
}

/** URL string passed to a curl invocation (last arg for GET, matching arg for POST). */
function urlArgOf(call: { args: string[] }): string {
  return call.args[call.args.length - 1];
}

beforeEach(() => {
  mockExecuteBinary.mockReset();
});

// ============================================================================
// Pure helpers
// ============================================================================

describe("generationId", () => {
  it("formats as moss-<unix_seconds>", () => {
    expect(generationId(1_699_999_999_000)).toBe("moss-1699999999");
  });
});

describe("baseUrlFor", () => {
  it("builds the loopback REST base URL for a port", () => {
    expect(baseUrlFor(18080)).toBe("http://127.0.0.1:18080/wp-json/onionpress/v1");
  });
});

// ============================================================================
// Port discovery
// ============================================================================

describe("discoverReceiver", () => {
  it("returns the first port whose /status carries receiver_version", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true, statusBody()));

    const endpoint = await discoverReceiver();

    expect(endpoint).not.toBeNull();
    expect(endpoint!.port).toBe(8080);
    expect(endpoint!.baseUrl).toBe("http://127.0.0.1:8080/wp-json/onionpress/v1");
    expect(endpoint!.status.receiver_version).toBe("1");
    expect(endpoint!.status.onion_address).toBe("abcdef1234567890.onion");
    // Stops at the first responder — no further probes.
    expect(mockExecuteBinary).toHaveBeenCalledTimes(1);
  });

  it("skips ports that do not answer (curl error) and picks the next live one", async () => {
    mockExecuteBinary
      .mockResolvedValueOnce(exec(false, "", "curl: (7) Failed to connect")) // 8080 down
      .mockResolvedValueOnce(exec(true, statusBody())); // 18080 up

    const endpoint = await discoverReceiver();

    expect(endpoint!.port).toBe(18080);
    expect(mockExecuteBinary).toHaveBeenCalledTimes(2);
    expect(urlArgOf(mockExecuteBinary.mock.calls[1][0])).toContain(":18080");
  });

  it("probes ports in the contract order 8080,18080,28080,38080,48080", async () => {
    // All five fail → we can read back the exact probe order.
    for (let i = 0; i < 5; i++) mockExecuteBinary.mockResolvedValueOnce(exec(false));

    await discoverReceiver();

    const probedPorts = mockExecuteBinary.mock.calls.map((c) => {
      const m = urlArgOf(c[0]).match(/127\.0\.0\.1:(\d+)/);
      return m ? Number(m[1]) : -1;
    });
    expect(probedPorts).toEqual([8080, 18080, 28080, 38080, 48080]);
  });

  it("skips a port that answers with non-JSON (a different service)", async () => {
    mockExecuteBinary
      .mockResolvedValueOnce(exec(true, "<html><body>not onionpress</body></html>")) // 8080
      .mockResolvedValueOnce(exec(true, statusBody())); // 18080

    const endpoint = await discoverReceiver();
    expect(endpoint!.port).toBe(18080);
  });

  it("skips JSON that lacks receiver_version", async () => {
    // 8080 answers JSON without the discriminator; nothing else responds.
    mockExecuteBinary
      .mockResolvedValueOnce(exec(true, JSON.stringify({ onion_address: "x.onion" })))
      .mockResolvedValue(exec(false));

    const endpoint = await discoverReceiver();
    expect(endpoint).toBeNull();
  });

  it("returns null when no port responds", async () => {
    mockExecuteBinary.mockResolvedValue(exec(false));

    const endpoint = await discoverReceiver();

    expect(endpoint).toBeNull();
    expect(mockExecuteBinary).toHaveBeenCalledTimes(5);
  });

  it("uses curl -sS with a bounded timeout for the probe", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true, statusBody()));
    await discoverReceiver();

    const call = mockExecuteBinary.mock.calls[0][0];
    expect(call.binaryPath).toBe("curl");
    expect(call.args).toContain("-sS");
    expect(call.args).toContain("-m");
    expect(urlArgOf(call)).toBe("http://127.0.0.1:8080/wp-json/onionpress/v1/status");
  });
});

// ============================================================================
// Pack
// ============================================================================

describe("packGeneration", () => {
  it("tars the current-generation contents to /tmp/<genId>.tar and follows the symlink", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true));

    const tarPath = await packGeneration("moss-42");

    expect(tarPath).toBe("/tmp/moss-42.tar");
    expect(mockExecuteBinary).toHaveBeenCalledWith(
      expect.objectContaining({
        binaryPath: "tar",
        args: ["-cf", "/tmp/moss-42.tar", "-C", ".moss/build/current", "."],
        workingDir: ".",
      }),
    );
  });

  it("packs with COPYFILE_DISABLE=1 so bsdtar emits no AppleDouble members", async () => {
    // Regression: without this, Apple's tar writes a `._<name>` sibling for every
    // entry carrying an xattr (moss build output all carries com.apple.provenance).
    // Apple's tar re-absorbs them on extract, but the receiver unpacks with
    // PharData on Linux and publishes them as junk files.
    mockExecuteBinary.mockResolvedValueOnce(exec(true));

    await packGeneration("moss-42");

    expect(mockExecuteBinary.mock.calls[0][0].env).toEqual({ COPYFILE_DISABLE: "1" });
  });

  it("throws a build-first error when tar fails", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(false, "", "tar: .moss/build/current: No such file"));

    await expect(packGeneration("moss-42")).rejects.toThrow("Run a build first");
  });
});

// ============================================================================
// Upload
// ============================================================================

describe("uploadGeneration", () => {
  const BASE = "http://127.0.0.1:8080/wp-json/onionpress/v1";

  it("with no receiver version (legacy default), POSTs the raw tar as application/x-tar", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true, JSON.stringify({ ok: true, generation: "moss-42" })));

    await uploadGeneration(BASE, "moss-42", "/tmp/moss-42.tar");

    const call = mockExecuteBinary.mock.calls[0][0];
    expect(call.binaryPath).toBe("curl");
    expect(call.args).toEqual([
      "-sS",
      "-X",
      "POST",
      "--data-binary",
      "@/tmp/moss-42.tar",
      "-H",
      "Content-Type: application/x-tar",
      `${BASE}/generation?id=moss-42`,
    ]);
  });

  it("against a receiver_version < 1.2, POSTs the legacy raw body (unchanged)", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true, JSON.stringify({ ok: true, generation: "moss-42" })));

    await uploadGeneration(BASE, "moss-42", "/tmp/moss-42.tar", "1.1");

    const call = mockExecuteBinary.mock.calls[0][0];
    expect(call.args).toContain("--data-binary");
    expect(call.args).not.toContain("-F");
  });

  it("against a receiver_version >= 1.2, POSTs multipart with the tar in a `tar` part", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true, JSON.stringify({ ok: true, generation: "moss-42" })));

    await uploadGeneration(BASE, "moss-42", "/tmp/moss-42.tar", "1.2");

    const call = mockExecuteBinary.mock.calls[0][0];
    expect(call.binaryPath).toBe("curl");
    expect(call.args).toEqual([
      "-sS",
      "-X",
      "POST",
      "-F",
      "tar=@/tmp/moss-42.tar",
      `${BASE}/generation?id=moss-42`,
    ]);
    // curl must set its own multipart boundary — never override Content-Type.
    expect(call.args).not.toContain("-H");
  });

  it("throws when the receiver replies ok:false (so the deploy aborts before commit)", async () => {
    mockExecuteBinary.mockResolvedValueOnce(
      exec(true, JSON.stringify({ ok: false, error: "path traversal rejected" })),
    );

    await expect(uploadGeneration(BASE, "moss-42", "/tmp/moss-42.tar")).rejects.toThrow(
      "path traversal rejected",
    );
  });

  it("throws when curl itself fails", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(false, "", "curl: (52) Empty reply from server"));

    await expect(uploadGeneration(BASE, "moss-42", "/tmp/moss-42.tar")).rejects.toThrow(
      "Upload to OnionPress failed",
    );
  });
});

describe("receiverSupportsMultipartUpload", () => {
  it("is false for versions below 1.2", () => {
    expect(receiverSupportsMultipartUpload("1")).toBe(false);
    expect(receiverSupportsMultipartUpload("1.0")).toBe(false);
    expect(receiverSupportsMultipartUpload("1.1")).toBe(false);
  });

  it("is true for 1.2 and above", () => {
    expect(receiverSupportsMultipartUpload("1.2")).toBe(true);
    expect(receiverSupportsMultipartUpload("1.3")).toBe(true);
    expect(receiverSupportsMultipartUpload("2")).toBe(true);
    expect(receiverSupportsMultipartUpload("2.0")).toBe(true);
  });

  it("treats missing or unparseable versions as legacy", () => {
    expect(receiverSupportsMultipartUpload(undefined)).toBe(false);
    expect(receiverSupportsMultipartUpload(null)).toBe(false);
    expect(receiverSupportsMultipartUpload("")).toBe(false);
    expect(receiverSupportsMultipartUpload("not-a-version")).toBe(false);
  });

  it("compares numerically, not lexicographically (\"1.10\" > \"1.2\")", () => {
    expect(receiverSupportsMultipartUpload("1.10")).toBe(true);
  });
});

// ============================================================================
// Commit
// ============================================================================

describe("commitGeneration", () => {
  const BASE = "http://127.0.0.1:8080/wp-json/onionpress/v1";

  it("POSTs {generation} as JSON and returns the onion url", async () => {
    mockExecuteBinary.mockResolvedValueOnce(
      exec(true, JSON.stringify({ ok: true, url: "http://abcdef1234567890.onion/" })),
    );

    const result = await commitGeneration(BASE, "moss-42");

    expect(result).toEqual({ ok: true, url: "http://abcdef1234567890.onion/" });
    const call = mockExecuteBinary.mock.calls[0][0];
    expect(call.args).toContain("Content-Type: application/json");
    expect(call.args).toContain('{"generation":"moss-42"}');
    expect(urlArgOf(call)).toBe(`${BASE}/commit`);
  });

  it("throws when the receiver replies ok:false", async () => {
    mockExecuteBinary.mockResolvedValueOnce(
      exec(true, JSON.stringify({ ok: false, error: "reserved name collision" })),
    );

    await expect(commitGeneration(BASE, "moss-42")).rejects.toThrow("reserved name collision");
  });

  it("throws when ok:true but no url is returned", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true, JSON.stringify({ ok: true })));

    await expect(commitGeneration(BASE, "moss-42")).rejects.toThrow("did not confirm");
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe("cleanupTar", () => {
  it("removes the tar with rm -f", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true));

    await cleanupTar("/tmp/moss-42.tar");

    expect(mockExecuteBinary).toHaveBeenCalledWith(
      expect.objectContaining({ binaryPath: "rm", args: ["-f", "/tmp/moss-42.tar"] }),
    );
  });

  it("never throws even if rm fails", async () => {
    mockExecuteBinary.mockRejectedValueOnce(new Error("boom"));

    await expect(cleanupTar("/tmp/moss-42.tar")).resolves.toBeUndefined();
  });
});

// ============================================================================
// Reachability (moss#917)
// ============================================================================

const BASE_URL = "http://127.0.0.1:8080/wp-json/onionpress/v1";

describe("fetchStatus", () => {
  it("parses onion_reachable/onion_http_code when the receiver sends them", async () => {
    mockExecuteBinary.mockResolvedValueOnce(
      exec(true, statusBody({ receiver_version: "1.1", onion_reachable: true, onion_http_code: "301" })),
    );

    const status = await fetchStatus(BASE_URL);

    expect(status!.onion_reachable).toBe(true);
    expect(status!.onion_http_code).toBe("301");
  });

  it("treats a false reachable value as a real answer, not absence", async () => {
    mockExecuteBinary.mockResolvedValueOnce(
      exec(true, statusBody({ receiver_version: "1.1", onion_reachable: false, onion_http_code: "takeover" })),
    );

    const status = await fetchStatus(BASE_URL);

    expect(status!.onion_reachable).toBe(false);
    expect(status!.onion_http_code).toBe("takeover");
  });

  it("defaults to null when the receiver omits the fields (older build)", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(true, statusBody()));

    const status = await fetchStatus(BASE_URL);

    expect(status!.onion_reachable).toBeNull();
    expect(status!.onion_http_code).toBeNull();
  });

  it("returns null when curl fails", async () => {
    mockExecuteBinary.mockResolvedValueOnce(exec(false));

    expect(await fetchStatus(BASE_URL)).toBeNull();
  });

  it("returns null, rather than throwing, when executeBinary rejects outright", async () => {
    // This runs post-commit — the site is already live. A rejection here
    // (not just a success:false result) must degrade to "unknown", never
    // propagate and get mistaken for a failed publish (moss#917).
    mockExecuteBinary.mockRejectedValueOnce(new Error("called outside a hook"));

    await expect(fetchStatus(BASE_URL)).resolves.toBeNull();
  });
});

describe("receiverSupportsReachability", () => {
  it("is false for a pre-1.1 receiver (\"1\")", () => {
    expect(receiverSupportsReachability("1")).toBe(false);
  });

  it("is true at exactly 1.1", () => {
    expect(receiverSupportsReachability("1.1")).toBe(true);
  });

  it("is true for anything newer", () => {
    expect(receiverSupportsReachability("1.2")).toBe(true);
    expect(receiverSupportsReachability("2")).toBe(true);
    expect(receiverSupportsReachability("2.0")).toBe(true);
  });

  it("is false for 1.0 explicitly", () => {
    expect(receiverSupportsReachability("1.0")).toBe(false);
  });
});

describe("waitForReachability", () => {
  it("returns immediately once onion_reachable resolves true", async () => {
    const fetchStatusFn = vi.fn().mockResolvedValue({
      onion_address: "x.onion",
      current_generation: null,
      receiver_version: "1.1",
      onion_reachable: true,
      onion_http_code: "301",
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const outcome = await waitForReachability(BASE_URL, { fetchStatusFn, sleep });

    expect(outcome).toEqual({ reachable: true, httpCode: "301" });
    expect(fetchStatusFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("polls at the given interval while onion_reachable is still null", async () => {
    const fetchStatusFn = vi
      .fn()
      .mockResolvedValueOnce({
        onion_address: "x.onion",
        current_generation: null,
        receiver_version: "1.1",
        onion_reachable: null,
        onion_http_code: null,
      })
      .mockResolvedValueOnce({
        onion_address: "x.onion",
        current_generation: null,
        receiver_version: "1.1",
        onion_reachable: false,
        onion_http_code: "000:rc=28",
      });
    const sleep = vi.fn().mockResolvedValue(undefined);
    // now() called once for the deadline, then before each loop-continue check.
    const now = vi.fn().mockReturnValue(0);

    const outcome = await waitForReachability(BASE_URL, {
      fetchStatusFn,
      sleep,
      now,
      timeoutMs: 10_000,
      intervalMs: 2_000,
    });

    expect(outcome).toEqual({ reachable: false, httpCode: "000:rc=28" });
    expect(fetchStatusFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("gives up at the timeout and reports null rather than guessing", async () => {
    const fetchStatusFn = vi.fn().mockResolvedValue({
      onion_address: "x.onion",
      current_generation: null,
      receiver_version: "1.1",
      onion_reachable: null,
      onion_http_code: null,
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    // Deadline reached on the second check.
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10_001);

    const outcome = await waitForReachability(BASE_URL, {
      fetchStatusFn,
      sleep,
      now,
      timeoutMs: 10_000,
      intervalMs: 2_000,
    });

    expect(outcome).toEqual({ reachable: null, httpCode: null });
  });

  it("also reports null when the receiver never answers at all", async () => {
    const fetchStatusFn = vi.fn().mockResolvedValue(null);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(10_001);

    const outcome = await waitForReachability(BASE_URL, {
      fetchStatusFn,
      sleep,
      now,
      timeoutMs: 10_000,
    });

    expect(outcome).toEqual({ reachable: null, httpCode: null });
  });
});
