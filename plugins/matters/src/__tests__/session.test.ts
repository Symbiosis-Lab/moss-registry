import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK exactly like api.test.ts does (api.ts imports it at module top).
vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    getPluginCookie: vi.fn(),
    httpPost: vi.fn(),
    pluginFileExists: vi.fn(),
    readPluginFile: vi.fn(),
    writePluginFile: vi.fn(),
  };
});

import { decodeJwtExpiryMs } from "../credential";

/** Build an unsigned JWT with the given payload (header/sig are ignored by the decoder). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.fakesig`;
}

describe("decodeJwtExpiryMs", () => {
  it("returns exp in milliseconds for a JWT with numeric exp", () => {
    expect(decodeJwtExpiryMs(fakeJwt({ exp: 1777777777, id: "x" }))).toBe(1777777777000);
  });

  it("returns null when exp is missing", () => {
    expect(decodeJwtExpiryMs(fakeJwt({ id: "x" }))).toBeNull();
  });

  it("returns null when exp is not a number", () => {
    expect(decodeJwtExpiryMs(fakeJwt({ exp: "tomorrow" }))).toBeNull();
  });

  it("returns null for a non-JWT opaque token", () => {
    expect(decodeJwtExpiryMs("not-a-jwt-token")).toBeNull();
  });

  it("returns null for a JWT with an undecodable payload", () => {
    expect(decodeJwtExpiryMs("aGVhZGVy.!!!notbase64!!!.sig")).toBeNull();
  });

  it("decodes base64url payloads (- and _ characters, no padding)", () => {
    const jwt = fakeJwt({ exp: 2000000000, u: "??>>" });
    expect(decodeJwtExpiryMs(jwt)).toBe(2000000000000);
  });
});

import {
  getSessionState,
  markSessionInvalidated,
  shouldNudgeSessionExpired,
  loadStoredToken,
  saveStoredToken,
  clearTokenCache,
  captureLogin,
} from "../credential";
import {
  getPluginCookie,
  pluginFileExists,
  readPluginFile,
  writePluginFile,
} from "@symbiosis-lab/moss-api";

const FUTURE = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
const PAST = Math.floor(Date.now() / 1000) - 24 * 3600;
const WITHIN_SKEW = Math.floor(Date.now() / 1000) + 30; // < 60s skew margin

function mockAuthFile(record: Record<string, unknown> | null) {
  vi.mocked(pluginFileExists).mockResolvedValue(record !== null);
  vi.mocked(readPluginFile).mockResolvedValue(JSON.stringify(record ?? {}));
}

describe("getSessionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("returns 'none' when no auth file exists", async () => {
    mockAuthFile(null);
    expect(await getSessionState()).toBe("none");
  });

  it("returns 'none' when the record has no accessToken", async () => {
    mockAuthFile({ savedAt: "2026-01-01" });
    expect(await getSessionState()).toBe("none");
  });

  it("returns 'valid' for an unexpired JWT", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: FUTURE }) });
    expect(await getSessionState()).toBe("valid");
  });

  it("returns 'expired' for an expired JWT, with an honest log line", async () => {
    const logSpy = vi.spyOn(console, "log");
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    expect(await getSessionState()).toBe("expired");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("EXPIRED");
    logSpy.mockRestore();
  });

  it("returns 'expired' for a JWT expiring within the 60s skew margin", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: WITHIN_SKEW }) });
    expect(await getSessionState()).toBe("expired");
  });

  it("returns 'expired' when invalidatedAt is stamped, even if exp is future", async () => {
    mockAuthFile({
      accessToken: fakeJwt({ exp: FUTURE }),
      invalidatedAt: "2026-06-10T03:00:00.000Z",
    });
    expect(await getSessionState()).toBe("expired");
  });

  it("returns 'valid' for an undecodable token (runtime backstop will catch it)", async () => {
    mockAuthFile({ accessToken: "opaque-non-jwt-token" });
    expect(await getSessionState()).toBe("valid");
  });
});

describe("loadStoredToken dead-token filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("returns the token for a valid record", async () => {
    const token = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: token });
    expect(await loadStoredToken()).toBe(token);
  });

  it("returns null for an expired JWT (login flow must not 'find' a dead token)", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    expect(await loadStoredToken()).toBeNull();
  });

  it("returns null for an invalidatedAt-stamped record", async () => {
    mockAuthFile({
      accessToken: fakeJwt({ exp: FUTURE }),
      invalidatedAt: "2026-06-10T03:00:00.000Z",
    });
    expect(await loadStoredToken()).toBeNull();
  });

  it("returns an opaque non-JWT token unchanged (cannot judge locally)", async () => {
    mockAuthFile({ accessToken: "opaque-non-jwt-token" });
    expect(await loadStoredToken()).toBe("opaque-non-jwt-token");
  });
});

describe("captureLogin cookie-branch dead-token filter (login poll)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
  });

  it("rejects an expired-exp cookie: resolves null and does NOT write auth.json", async () => {
    mockAuthFile(null); // no stored record
    vi.mocked(getPluginCookie).mockResolvedValue([
      { name: "__access_token", value: fakeJwt({ exp: PAST }) },
    ]);
    expect(await captureLogin()).toBeNull();
    expect(vi.mocked(writePluginFile)).not.toHaveBeenCalled();
  });

  it("rejects a cookie identical to the invalidatedAt-stamped record's token", async () => {
    // Server-revoked token: future exp, cookie still live in the shared
    // WebKit store. The exp check can't catch it; identity to the stamped
    // record must.
    const revoked = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: revoked, invalidatedAt: "2026-06-10T03:00:00.000Z" });
    vi.mocked(getPluginCookie).mockResolvedValue([
      { name: "__access_token", value: revoked },
    ]);
    expect(await captureLogin()).toBeNull();
    expect(vi.mocked(writePluginFile)).not.toHaveBeenCalled();
  });

  it("accepts a fresh future-exp cookie different from the stamped token and persists it", async () => {
    const revoked = fakeJwt({ exp: FUTURE, id: "old" });
    const fresh = fakeJwt({ exp: FUTURE, id: "new" });
    mockAuthFile({ accessToken: revoked, invalidatedAt: "2026-06-10T03:00:00.000Z" });
    vi.mocked(getPluginCookie).mockResolvedValue([
      { name: "__access_token", value: fresh },
    ]);
    expect(await captureLogin()).toBe(fresh);
    expect(vi.mocked(writePluginFile)).toHaveBeenCalledWith(
      "auth.json",
      expect.stringContaining(fresh)
    );
  });
});

describe("markSessionInvalidated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("skips the file write when there is no token to invalidate", async () => {
    mockAuthFile(null);
    await markSessionInvalidated();
    expect(vi.mocked(writePluginFile)).not.toHaveBeenCalled();
  });

  it("stamps invalidatedAt while preserving the token", async () => {
    const token = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: token });
    vi.mocked(writePluginFile).mockResolvedValue(undefined);

    await markSessionInvalidated();

    const [file, content] = vi.mocked(writePluginFile).mock.calls[0];
    expect(file).toBe("auth.json");
    const written = JSON.parse(content as string);
    expect(written.accessToken).toBe(token);
    expect(typeof written.invalidatedAt).toBe("string");
  });

  it("saveStoredToken clears previous stamps (fresh login resets)", async () => {
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
    await saveStoredToken("fresh-token");
    const [, content] = vi.mocked(writePluginFile).mock.calls[0];
    const written = JSON.parse(content as string);
    expect(written.accessToken).toBe("fresh-token");
    expect(written.invalidatedAt).toBeUndefined();
    expect(written.nudgedAt).toBeUndefined();
  });
});

describe("shouldNudgeSessionExpired (persisted once-per-expiry-event throttle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("nudges the first time and stamps nudgedAt", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
    expect(await shouldNudgeSessionExpired()).toBe(true);
    const [file, content] = vi.mocked(writePluginFile).mock.calls[0];
    expect(file).toBe("auth.json");
    expect(JSON.parse(content as string).nudgedAt).toBeTruthy();
  });

  it("does not nudge again once nudgedAt is stamped", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }), nudgedAt: "2026-06-10T03:00:00.000Z" });
    expect(await shouldNudgeSessionExpired()).toBe(false);
    expect(vi.mocked(writePluginFile)).not.toHaveBeenCalled();
  });

  it("does not nudge when there is no session at all", async () => {
    mockAuthFile(null);
    expect(await shouldNudgeSessionExpired()).toBe(false);
  });
});

import { MattersAuthError, graphqlQuery, graphqlQueryPublic } from "../api";
import { httpPost } from "@symbiosis-lab/moss-api";

function mockHttpResponse(status: number, bodyObj: unknown) {
  const text = JSON.stringify(bodyObj);
  vi.mocked(httpPost).mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    contentType: "application/json",
    body: new TextEncoder().encode(text),
    text: () => text,
  });
}

const TOKEN_INVALID_BODY = {
  errors: [{ message: "token invalid", extensions: { code: "TOKEN_INVALID" } }],
};

describe("graphqlQuery auth-error detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
    mockAuthFile({ accessToken: fakeJwt({ exp: FUTURE }) });
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
  });

  it("throws MattersAuthError on 500 + TOKEN_INVALID body (real Matters shape)", async () => {
    mockHttpResponse(500, TOKEN_INVALID_BODY);
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toBeInstanceOf(MattersAuthError);
  });

  it("stamps invalidatedAt when an auth error is detected", async () => {
    mockHttpResponse(500, TOKEN_INVALID_BODY);
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toThrow();
    const writes = vi.mocked(writePluginFile).mock.calls.filter(([f]) => f === "auth.json");
    expect(writes.length).toBe(1);
    expect(JSON.parse(writes[0][1] as string).invalidatedAt).toBeTruthy();
  });

  it("throws MattersAuthError on 200 + UNAUTHENTICATED errors array", async () => {
    mockHttpResponse(200, {
      errors: [{ message: "unauthenticated", extensions: { code: "UNAUTHENTICATED" } }],
      data: null,
    });
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toBeInstanceOf(MattersAuthError);
  });

  it("throws a generic error carrying a body snippet for non-auth failures", async () => {
    mockHttpResponse(502, { error: "upstream connect error before downstream thing" });
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toThrow(
      /GraphQL request failed \(502\): .*upstream connect error/
    );
  });

  it("still throws the first GraphQL error message for 200 + non-auth errors", async () => {
    mockHttpResponse(200, {
      errors: [{ message: "invalid globalId", extensions: { code: "BAD_USER_INPUT" } }],
      data: null,
    });
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toThrow("invalid globalId");
  });

  it("returns data unchanged on success", async () => {
    mockHttpResponse(200, { data: { viewer: { id: "abc" } } });
    await expect(graphqlQuery("query { viewer { id } }")).resolves.toEqual({
      viewer: { id: "abc" },
    });
  });

  it("keeps body evidence when a 200 response is not JSON", async () => {
    const text = "<html>oops</html>";
    vi.mocked(httpPost).mockResolvedValue({
      status: 200,
      ok: true,
      contentType: "text/html",
      body: new TextEncoder().encode(text),
      text: () => text,
    });
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toThrow(/oops/);
  });
});

describe("graphqlQueryPublic (token-less path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
    mockAuthFile({ accessToken: fakeJwt({ exp: FUTURE }) }); // a valid session exists...
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
  });

  it("auth-code body does NOT stamp the session and is NOT a MattersAuthError", async () => {
    mockHttpResponse(500, TOKEN_INVALID_BODY);
    const err = await graphqlQueryPublic("query { user { id } }").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MattersAuthError);
    expect(vi.mocked(writePluginFile)).not.toHaveBeenCalled(); // valid session untouched
  });

  it("carries a body snippet on failures", async () => {
    mockHttpResponse(502, { error: "bad gateway from upstream" });
    await expect(graphqlQueryPublic("query { user { id } }")).rejects.toThrow(
      /GraphQL request failed \(502\): .*bad gateway/
    );
  });

  it("returns data on success", async () => {
    mockHttpResponse(200, { data: { user: { id: "u1" } } });
    await expect(graphqlQueryPublic("query { user { id } }")).resolves.toEqual({
      user: { id: "u1" },
    });
  });
});
