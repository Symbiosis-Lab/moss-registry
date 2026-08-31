import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK exactly like api.test.ts does (api.ts imports it at module top).
import * as keystore from "./helpers/secret-store-mock";

vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    getPluginCookie: vi.fn(),
    httpPost: vi.fn(),
    pluginFileExists: vi.fn(),
    readPluginFile: vi.fn(),
    writePluginFile: vi.fn(),
    // The token lives in moss's keystore now; the real pair reaches Tauri.
    getSecret: (key: string) => keystore.getSecret(key),
    setSecret: (key: string, value: string) => keystore.setSecret(key, value),
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
  authHeaderToken,
  clearTokenCache,
  resetMigrationForTests,
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

/**
 * Seed the pre-keystore `auth.json` a real upgrading user has on disk. Every
 * read goes through the migration, so this exercises it on every case below —
 * which is the point: the migration runs once, on real users' data.
 */
function mockAuthFile(record: Record<string, unknown> | null) {
  vi.mocked(pluginFileExists).mockResolvedValue(record !== null);
  vi.mocked(readPluginFile).mockResolvedValue(JSON.stringify(record ?? {}));
}

/** The stamps file, isolated from the writes the migration itself makes. */
function stateWrites() {
  return vi.mocked(writePluginFile).mock.calls.filter(([f]) => f === "auth-state.json");
}

function resetCredentialState() {
  vi.clearAllMocks();
  clearTokenCache();
  resetMigrationForTests();
  keystore.resetSecretStore();
  vi.mocked(writePluginFile).mockResolvedValue(undefined);
}

describe("getSessionState", () => {
  beforeEach(() => {
    resetCredentialState();
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

describe("authHeaderToken dead-token filtering", () => {
  beforeEach(() => {
    resetCredentialState();
  });

  it("returns the token for a valid record", async () => {
    const token = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: token });
    expect(await authHeaderToken()).toBe(token);
  });

  it("returns null for an expired JWT (login flow must not 'find' a dead token)", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    expect(await authHeaderToken()).toBeNull();
  });

  it("returns null for an invalidatedAt-stamped record", async () => {
    mockAuthFile({
      accessToken: fakeJwt({ exp: FUTURE }),
      invalidatedAt: "2026-06-10T03:00:00.000Z",
    });
    expect(await authHeaderToken()).toBeNull();
  });

  it("returns an opaque non-JWT token unchanged (cannot judge locally)", async () => {
    mockAuthFile({ accessToken: "opaque-non-jwt-token" });
    expect(await authHeaderToken()).toBe("opaque-non-jwt-token");
  });
});

describe("captureLogin cookie-branch dead-token filter (login poll)", () => {
  beforeEach(() => {
    resetCredentialState();
  });

  it("rejects an expired-exp cookie: resolves null and does NOT write auth.json", async () => {
    mockAuthFile(null); // no stored record
    vi.mocked(getPluginCookie).mockResolvedValue([
      { name: "__access_token", value: fakeJwt({ exp: PAST }) },
    ]);
    expect(await captureLogin()).toBeNull();
    expect(keystore.secretStore.get("access_token")).toBeUndefined();
  });

  it("rejects a cookie identical to the invalidatedAt-stamped record's token", async () => {
    // Server-revoked token: future exp, cookie still live in the shared
    // WebKit store. The exp check can't catch it; identity to the stamped
    // record must.
    const revoked = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: revoked, invalidatedAt: "2026-06-10T03:00:00.000Z" });
    keystore.secretStore.set("access_token", revoked);
    vi.mocked(getPluginCookie).mockResolvedValue([
      { name: "__access_token", value: revoked },
    ]);
    expect(await captureLogin()).toBeNull();
    // The revoked token stays; the cookie did not overwrite it.
    expect(keystore.secretStore.get("access_token")).toBe(revoked);
  });

  it("accepts a fresh future-exp cookie different from the stamped token and persists it", async () => {
    const revoked = fakeJwt({ exp: FUTURE, id: "old" });
    const fresh = fakeJwt({ exp: FUTURE, id: "new" });
    mockAuthFile({ accessToken: revoked, invalidatedAt: "2026-06-10T03:00:00.000Z" });
    vi.mocked(getPluginCookie).mockResolvedValue([
      { name: "__access_token", value: fresh },
    ]);
    expect(await captureLogin()).toBe(fresh);
    expect(keystore.secretStore.get("access_token")).toBe(fresh);
    // Nothing the plugin writes to disk may carry the token.
    for (const [, content] of vi.mocked(writePluginFile).mock.calls) {
      expect(content as string).not.toContain(fresh);
    }
  });
});

describe("markSessionInvalidated", () => {
  beforeEach(() => {
    resetCredentialState();
  });

  it("skips the stamp write when there is no token to invalidate", async () => {
    mockAuthFile(null);
    await markSessionInvalidated();
    expect(stateWrites()).toHaveLength(0);
  });

  it("stamps invalidatedAt without touching the stored token", async () => {
    const token = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: token });
    keystore.secretStore.set("access_token", token);

    await markSessionInvalidated();

    const written = JSON.parse(stateWrites().at(-1)![1] as string);
    expect(typeof written.invalidatedAt).toBe("string");
    // The secret stays put: "expired" must stay distinguishable from
    // "never logged in", and the two route differently.
    expect(keystore.secretStore.get("access_token")).toBe(token);
    // And no stamp file ever carries the secret.
    expect(written.accessToken).toBeUndefined();
  });
});

describe("shouldNudgeSessionExpired (persisted once-per-expiry-event throttle)", () => {
  beforeEach(() => {
    resetCredentialState();
  });

  it("nudges the first time and stamps nudgedAt", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
    expect(await shouldNudgeSessionExpired()).toBe(true);
    expect(JSON.parse(stateWrites().at(-1)![1] as string).nudgedAt).toBeTruthy();
  });

  it("does not nudge again once nudgedAt is stamped", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }), nudgedAt: "2026-06-10T03:00:00.000Z" });
    expect(await shouldNudgeSessionExpired()).toBe(false);
    // The migration writes the stamps through untouched; nothing re-nudges.
    for (const [, content] of stateWrites()) {
      expect(JSON.parse(content as string).nudgedAt).toBe("2026-06-10T03:00:00.000Z");
    }
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
    resetCredentialState();
    mockAuthFile({ accessToken: fakeJwt({ exp: FUTURE }) });
  });

  it("throws MattersAuthError on 500 + TOKEN_INVALID body (real Matters shape)", async () => {
    mockHttpResponse(500, TOKEN_INVALID_BODY);
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toBeInstanceOf(MattersAuthError);
  });

  it("stamps invalidatedAt when an auth error is detected", async () => {
    mockHttpResponse(500, TOKEN_INVALID_BODY);
    await expect(graphqlQuery("query { viewer { id } }")).rejects.toThrow();
    const writes = stateWrites();
    expect(JSON.parse(writes.at(-1)![1] as string).invalidatedAt).toBeTruthy();
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
    resetCredentialState();
    mockAuthFile({ accessToken: fakeJwt({ exp: FUTURE }) }); // a valid session exists...
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
