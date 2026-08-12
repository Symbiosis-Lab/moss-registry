import { describe, it, expect } from "vitest";
import { categorizeError } from "../errors";

describe("categorizeError", () => {
  it("maps daemon/connection-refused errors", () => {
    expect(categorizeError("connect ECONNREFUSED 127.0.0.1:5001")).toBe("IPFS daemon not running");
    expect(categorizeError("The IPFS daemon is not running")).toBe("IPFS daemon not running");
    // A bare number containing 5001 must not trigger the daemon bucket.
    expect(categorizeError("upload rejected: 15001 files exceeds plan")).not.toBe(
      "IPFS daemon not running",
    );
  });

  it("maps auth errors with a provider-neutral label", () => {
    expect(categorizeError("Pinata authentication failed (HTTP 401).")).toBe(
      "Authentication failed",
    );
    expect(categorizeError("invalid jwt")).toBe("Authentication failed");
    // A Kubo RPC 403 must not be labeled as a Pinata problem.
    expect(categorizeError("IPFS add failed (HTTP 403): access denied")).toBe(
      "Authentication failed",
    );
  });

  it("maps timeouts", () => {
    expect(categorizeError("Request timed out")).toMatch(/still be pinning/);
  });

  it("maps generic network errors", () => {
    expect(categorizeError("network unreachable")).toBe("Network error");
  });

  it("truncates long, uncategorized messages", () => {
    const long = "x".repeat(80);
    expect(categorizeError(long)).toBe("x".repeat(50) + "...");
  });

  it("passes short messages through", () => {
    expect(categorizeError("boom")).toBe("boom");
  });
});
