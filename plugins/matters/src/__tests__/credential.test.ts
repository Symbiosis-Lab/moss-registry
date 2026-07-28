/**
 * Tests for credential.ts — the single matters-credential owner.
 *
 * Covers:
 *   - authHeaderToken: stored-token-only path (old getAccessToken(false))
 *   - captureLogin: cookie-capture login path (old getAccessToken(true))
 *   - prepareWebviewAuth: projects auth.json token into the __access_token cookie
 *   - beginFreshLogin: clears stored token AND plugin cookies before fresh login
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @symbiosis-lab/moss-api ─────────────────────────────────────────────

const mockSetPluginCookie = vi.fn().mockResolvedValue(undefined);
const mockClearPluginCookies = vi.fn().mockResolvedValue(undefined);
const mockReadPluginFile = vi.fn();
const mockWritePluginFile = vi.fn().mockResolvedValue(undefined);
const mockPluginFileExists = vi.fn().mockResolvedValue(true);
const mockGetPluginCookie = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  readPluginFile: (...a: unknown[]) => mockReadPluginFile(...a),
  writePluginFile: (...a: unknown[]) => mockWritePluginFile(...a),
  pluginFileExists: (...a: unknown[]) => mockPluginFileExists(...a),
  getPluginCookie: (...a: unknown[]) => mockGetPluginCookie(...a),
  setPluginCookie: (...a: unknown[]) => mockSetPluginCookie(...a),
  clearPluginCookies: (...a: unknown[]) => mockClearPluginCookies(...a),
}));

import {
  authHeaderToken,
  captureLogin,
  prepareWebviewAuth,
  beginFreshLogin,
  clearTokenCache,
} from "../credential";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FUTURE = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
const PAST = Math.floor(Date.now() / 1000) - 24 * 3600;

function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.fakesig`;
}

function mockAuthFile(record: Record<string, unknown> | null) {
  mockPluginFileExists.mockResolvedValue(record !== null);
  mockReadPluginFile.mockResolvedValue(JSON.stringify(record ?? {}));
}

// ── authHeaderToken (old getAccessToken(false)) ───────────────────────────────

describe("authHeaderToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
    // Default: no stored token
    mockPluginFileExists.mockResolvedValue(false);
  });

  it("returns token from project storage when auth.json exists", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue(JSON.stringify({
      accessToken: "stored-project-token",
      savedAt: "2026-01-01T00:00:00Z",
    }));

    const result = await authHeaderToken();

    expect(result).toBe("stored-project-token");
    // Should NOT check cookies
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });

  it("returns null when no stored token", async () => {
    mockPluginFileExists.mockResolvedValue(false);

    const result = await authHeaderToken();

    expect(result).toBeNull();
    // Should NOT check cookies
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });

  it("returns null when auth.json exists but has no accessToken field", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue("{}");

    const result = await authHeaderToken();

    expect(result).toBeNull();
  });

  it("returns null when auth.json contains invalid JSON", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue("not-json");

    const result = await authHeaderToken();

    expect(result).toBeNull();
  });

  it("returns null when storage read throws an error", async () => {
    mockPluginFileExists.mockRejectedValue(new Error("storage read failed"));

    const result = await authHeaderToken();

    expect(result).toBeNull();
  });

  it("caches the stored token after first retrieval", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue(JSON.stringify({
      accessToken: "cached-stored-token",
    }));

    const result1 = await authHeaderToken();
    expect(result1).toBe("cached-stored-token");

    // Second call should use cache
    mockPluginFileExists.mockResolvedValue(false); // would return null if not cached
    const result2 = await authHeaderToken();

    expect(result2).toBe("cached-stored-token");
    expect(mockReadPluginFile).toHaveBeenCalledTimes(1);
  });

  it("clearTokenCache allows fresh retrieval from storage", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue(JSON.stringify({
      accessToken: "first-token",
    }));

    await authHeaderToken();
    clearTokenCache();

    mockReadPluginFile.mockResolvedValue(JSON.stringify({
      accessToken: "second-token",
    }));

    const result = await authHeaderToken();

    expect(result).toBe("second-token");
    expect(mockReadPluginFile).toHaveBeenCalledTimes(2);
  });

  it("does NOT check the global cookie (prevents cross-project leak)", async () => {
    // Simulate: no stored token for this project, but global cookie exists
    mockPluginFileExists.mockResolvedValue(false);
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "leaked-global-token" },
    ]);

    // authHeaderToken must NOT check cookies
    const result = await authHeaderToken();

    expect(result).toBeNull();
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });
});

// ── captureLogin (old getAccessToken(true)) ───────────────────────────────────

describe("captureLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
    mockWritePluginFile.mockResolvedValue(undefined);
    // Default: no stored token
    mockPluginFileExists.mockResolvedValue(false);
  });

  it("checks cookies when no stored token", async () => {
    mockPluginFileExists.mockResolvedValue(false);
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "cookie-token" },
    ]);

    const result = await captureLogin();

    expect(result).toBe("cookie-token");
    expect(mockGetPluginCookie).toHaveBeenCalled();
  });

  it("persists cookie token to project storage", async () => {
    mockPluginFileExists.mockResolvedValue(false);
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "cookie-to-store" },
    ]);

    await captureLogin();

    expect(mockWritePluginFile).toHaveBeenCalledWith(
      "auth.json",
      expect.stringContaining("cookie-to-store")
    );
  });

  it("returns undefined when getPluginCookie returns null (no context)", async () => {
    mockPluginFileExists.mockResolvedValue(false);
    mockGetPluginCookie.mockResolvedValue(null);

    const result = await captureLogin();

    expect(result).toBeUndefined();
  });

  it("returns null when cookie exists but __access_token is not present", async () => {
    mockPluginFileExists.mockResolvedValue(false);
    mockGetPluginCookie.mockResolvedValue([
      { name: "other_cookie", value: "some_value" },
    ]);

    const result = await captureLogin();

    expect(result).toBeNull();
  });

  it("still returns cookie token when auto-persist to storage fails", async () => {
    mockPluginFileExists.mockResolvedValue(false);
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "cookie-despite-storage-fail" },
    ]);
    mockWritePluginFile.mockRejectedValue(new Error("storage write failed"));

    const result = await captureLogin();

    expect(result).toBe("cookie-despite-storage-fail");
  });

  it("prefers stored token over cookie", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue(JSON.stringify({
      accessToken: "stored-token",
    }));

    const result = await captureLogin();

    expect(result).toBe("stored-token");
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });

  // Dead-token filter tests (matching session.test.ts coverage)
  it("rejects an expired-exp cookie: resolves null and does NOT write auth.json", async () => {
    mockAuthFile(null); // no stored record
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: fakeJwt({ exp: PAST }) },
    ]);
    expect(await captureLogin()).toBeNull();
    expect(mockWritePluginFile).not.toHaveBeenCalled();
  });

  it("rejects a cookie identical to the invalidatedAt-stamped record's token", async () => {
    const revoked = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: revoked, invalidatedAt: "2026-06-10T03:00:00.000Z" });
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: revoked },
    ]);
    expect(await captureLogin()).toBeNull();
    expect(mockWritePluginFile).not.toHaveBeenCalled();
  });

  it("accepts a fresh future-exp cookie different from the stamped token and persists it", async () => {
    const revoked = fakeJwt({ exp: FUTURE, id: "old" });
    const fresh = fakeJwt({ exp: FUTURE, id: "new" });
    mockAuthFile({ accessToken: revoked, invalidatedAt: "2026-06-10T03:00:00.000Z" });
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: fresh },
    ]);
    expect(await captureLogin()).toBe(fresh);
    expect(mockWritePluginFile).toHaveBeenCalledWith(
      "auth.json",
      expect.stringContaining(fresh)
    );
  });
});

// ── prepareWebviewAuth ────────────────────────────────────────────────────────

describe("prepareWebviewAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("projects the auth.json token into the __access_token cookie", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue(JSON.stringify({ accessToken: "tok-α" }));

    await prepareWebviewAuth();

    expect(mockSetPluginCookie).toHaveBeenCalledWith([{ name: "__access_token", value: "tok-α" }]);
  });

  it("is a no-op when there is no usable token", async () => {
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue("{}");

    await prepareWebviewAuth();

    expect(mockSetPluginCookie).not.toHaveBeenCalled();
  });

  it("is a no-op when auth file does not exist", async () => {
    mockPluginFileExists.mockResolvedValue(false);

    await prepareWebviewAuth();

    expect(mockSetPluginCookie).not.toHaveBeenCalled();
  });
});

// ── beginFreshLogin ───────────────────────────────────────────────────────────

describe("beginFreshLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("clears the stored token AND the cookies", async () => {
    await beginFreshLogin();

    // clearStoredToken writes "{}" to auth.json
    expect(mockWritePluginFile).toHaveBeenCalledWith("auth.json", "{}");
    // clearPluginCookies clears the matters-domain cookies
    expect(mockClearPluginCookies).toHaveBeenCalled();
  });
});
