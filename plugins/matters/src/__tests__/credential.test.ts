/**
 * Tests for credential.ts — the single matters-credential owner.
 *
 * Covers:
 *   - the one-shot migration off the plaintext `auth.json` (verify, then empty)
 *   - the account-keyed store slot, and the pending slot a first login uses
 *   - authHeaderToken: stored-token-only path (old getAccessToken(false))
 *   - captureLogin: cookie-capture login path (old getAccessToken(true))
 *   - prepareWebviewAuth: projects the stored token into the __access_token cookie
 *   - beginFreshLogin: clears stored token AND plugin cookies before fresh login
 *
 * The dead-token filter (expired exp, invalidatedAt-stamped) is session.test.ts's,
 * not repeated here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as keystore from "./helpers/secret-store-mock";

// ── Mock @symbiosis-lab/moss-api ─────────────────────────────────────────────
//
// Plugin storage is a real in-memory filesystem here, because credential.ts now
// reads three different files (auth.json, auth-state.json, config.json) and a
// path-blind mock cannot tell which one a test meant.

const files = new Map<string, string>();

const mockSetPluginCookie = vi.fn().mockResolvedValue(undefined);
const mockClearPluginCookies = vi.fn().mockResolvedValue(undefined);
const mockGetPluginCookie = vi.fn();
const mockReadPluginFile = vi.fn<(path: string) => Promise<string>>();
const mockWritePluginFile = vi.fn<(path: string, content: string) => Promise<void>>();
const mockPluginFileExists = vi.fn<(path: string) => Promise<boolean>>();

vi.mock("@symbiosis-lab/moss-api", () => ({
  readPluginFile: (...a: [string]) => mockReadPluginFile(...a),
  writePluginFile: (...a: [string, string]) => mockWritePluginFile(...a),
  pluginFileExists: (...a: [string]) => mockPluginFileExists(...a),
  getPluginCookie: (...a: unknown[]) => mockGetPluginCookie(...a),
  setPluginCookie: (...a: unknown[]) => mockSetPluginCookie(...a),
  clearPluginCookies: (...a: unknown[]) => mockClearPluginCookies(...a),
  getSecret: (key: string) => keystore.getSecret(key),
  setSecret: (key: string, value: string) => keystore.setSecret(key, value),
}));

import {
  authHeaderToken,
  captureLogin,
  prepareWebviewAuth,
  beginFreshLogin,
  bindStoredToken,
  getSessionState,
  clearTokenCache,
  resetMigrationForTests,
} from "../credential";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FUTURE = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;

function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.fakesig`;
}

/** The plaintext file an upgrading user has on disk. */
function legacyAuthFile(record: Record<string, unknown>) {
  files.set("auth.json", JSON.stringify(record, null, 2));
}

function bindFolderTo(userName: string) {
  files.set("config.json", JSON.stringify({ boundUserName: userName, userName }));
}

function readFile(path: string): Record<string, unknown> | undefined {
  const raw = files.get(path);
  return raw === undefined ? undefined : JSON.parse(raw);
}

beforeEach(() => {
  // restore, not clear: a test that makes a write fail or spies on the store
  // must not leak that into the next one.
  vi.restoreAllMocks();
  files.clear();
  mockSetPluginCookie.mockResolvedValue(undefined);
  mockClearPluginCookies.mockResolvedValue(undefined);
  mockReadPluginFile.mockImplementation(async (path) => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`no such plugin file: ${path}`);
    return content;
  });
  mockWritePluginFile.mockImplementation(async (path, content) => {
    files.set(path, content);
  });
  mockPluginFileExists.mockImplementation(async (path) => files.has(path));
  keystore.resetSecretStore();
  clearTokenCache();
  resetMigrationForTests();
});

// ── Migration off auth.json ───────────────────────────────────────────────────

describe("migration off the plaintext auth.json", () => {
  it("moves the token into the keystore, keeps the stamps, and empties the file", async () => {
    bindFolderTo("alice");
    const token = fakeJwt({ exp: FUTURE });
    legacyAuthFile({ accessToken: token, savedAt: "2026-01-01T00:00:00Z" });

    expect(await authHeaderToken()).toBe(token);

    expect(keystore.secretStore.get("access_token:alice")).toBe(token);
    expect(readFile("auth-state.json")).toEqual({ savedAt: "2026-01-01T00:00:00Z" });
    // The plaintext copy is gone — `.moss/plugins/` is inside the user's repo
    // and syncs to whatever holds the vault.
    expect(files.get("auth.json")).toBe("{}");
  });

  it("carries invalidatedAt through, so an expired session stays expired", async () => {
    bindFolderTo("alice");
    legacyAuthFile({
      accessToken: fakeJwt({ exp: FUTURE }),
      invalidatedAt: "2026-06-10T03:00:00.000Z",
      nudgedAt: "2026-06-10T03:00:01.000Z",
    });

    // Dead for supply purposes, but the stamps survive the move.
    expect(await authHeaderToken()).toBeNull();
    expect(readFile("auth-state.json")).toEqual({
      invalidatedAt: "2026-06-10T03:00:00.000Z",
      nudgedAt: "2026-06-10T03:00:01.000Z",
    });
  });

  it("keeps auth.json when the store does not read the token back", async () => {
    bindFolderTo("alice");
    const token = fakeJwt({ exp: FUTURE });
    legacyAuthFile({ accessToken: token });
    // The store accepted the write and lost it. Deleting first would strand
    // the user with no token anywhere and a forced re-login.
    vi.spyOn(keystore, "getSecret").mockResolvedValue(null);

    expect(await authHeaderToken()).toBe(token);
    expect(JSON.parse(files.get("auth.json")!).accessToken).toBe(token);
  });

  it("keeps auth.json AND its stamps when the stamp file cannot be written", async () => {
    bindFolderTo("alice");
    const token = fakeJwt({ exp: FUTURE });
    // Server-revoked: only the stamp says so, and the stamp is the half that
    // fails to move. If the record then read as token-without-stamp, a dead
    // session would report "valid" — the presence-only bug the tri-state
    // replaced.
    legacyAuthFile({ accessToken: token, invalidatedAt: "2026-06-10T03:00:00.000Z" });
    mockWritePluginFile.mockRejectedValue(new Error("disk full"));

    expect(await getSessionState()).toBe("expired");
    expect(await authHeaderToken()).toBeNull();
    expect(JSON.parse(files.get("auth.json")!).accessToken).toBe(token);
  });

  it("does not overwrite a token another folder on the same account already moved", async () => {
    // Two folders bound to @alice share one store slot. The second folder to
    // upgrade carries a months-old auth.json; the store's copy is the live one.
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "live-token");
    legacyAuthFile({ accessToken: "stale-token" });

    expect(await authHeaderToken()).toBe("live-token");
    expect(keystore.secretStore.get("access_token:alice")).toBe("live-token");
    // Drained anyway: leaving the plaintext copy would defeat the migration.
    expect(files.get("auth.json")).toBe("{}");
  });

  it("waits for the binding rather than draining into the app-global pending slot", async () => {
    const token = fakeJwt({ exp: FUTURE });
    legacyAuthFile({ accessToken: token });

    // Unbound: the pending slot is shared by every unbound folder, so a second
    // account's upgrade would overwrite this one with both files already gone.
    expect(await authHeaderToken()).toBe(token);
    expect(keystore.secretStore.get("access_token")).toBeUndefined();
    expect(JSON.parse(files.get("auth.json")!).accessToken).toBe(token);

    // The process hook binds before it reads, so the next read migrates.
    bindFolderTo("alice");
    clearTokenCache();
    expect(await authHeaderToken()).toBe(token);
    expect(keystore.secretStore.get("access_token:alice")).toBe(token);
    expect(files.get("auth.json")).toBe("{}");
  });

  it("runs once, not once per read", async () => {
    bindFolderTo("alice");
    legacyAuthFile({ accessToken: fakeJwt({ exp: FUTURE }) });

    await authHeaderToken();
    clearTokenCache();
    await authHeaderToken();

    const emptied = mockWritePluginFile.mock.calls.filter(
      ([path, content]) => path === "auth.json" && content === "{}"
    );
    expect(emptied).toHaveLength(1);
  });

  it("writes nothing for a folder that never had an auth.json", async () => {
    expect(await authHeaderToken()).toBeNull();
    expect(mockWritePluginFile).not.toHaveBeenCalled();
  });

  it("leaves an already-emptied auth.json alone", async () => {
    files.set("auth.json", "{}");
    expect(await authHeaderToken()).toBeNull();
    expect(mockWritePluginFile).not.toHaveBeenCalled();
  });
});

// ── The store key is the account, not the folder ─────────────────────────────

describe("account-keyed storage", () => {
  it("a folder bound to another account does not see this folder's token", async () => {
    keystore.secretStore.set("access_token:alice", fakeJwt({ exp: FUTURE }));
    bindFolderTo("bob");

    // The store is app-global; only the key keeps two bound accounts apart.
    expect(await authHeaderToken()).toBeNull();
  });

  it("a first login parks the token in the pending slot until the account is known", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "fresh-token" },
    ]);

    await captureLogin();

    // No boundUserName yet: the profile fetch that discovers it needs this token.
    expect(keystore.secretStore.get("access_token")).toBe("fresh-token");

    await bindStoredToken("carol");

    expect(keystore.secretStore.get("access_token:carol")).toBe("fresh-token");
    expect(keystore.secretStore.has("access_token")).toBe(false);
  });

  it("a second account's login never lands in the first account's slot", async () => {
    // Folder bound to @alice, session expired, the user signs in as @bob. The
    // config still says alice for the whole capture — it is affirmBinding-
    // FromProfile, after the profile fetch, that rebinds it.
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "alice-token");
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "bob-token" },
    ]);

    await beginFreshLogin();
    expect(await captureLogin()).toBe("bob-token");

    // @alice's slot is every alice-bound folder's credential; bob's token must
    // not become it.
    expect(keystore.secretStore.has("access_token:alice")).toBe(false);
    expect(keystore.secretStore.get("access_token")).toBe("bob-token");

    await bindStoredToken("bob");
    expect(keystore.secretStore.get("access_token:bob")).toBe("bob-token");
    expect(keystore.secretStore.has("access_token")).toBe(false);
  });

  it("binding again is a no-op once the pending slot is empty", async () => {
    keystore.secretStore.set("access_token:carol", "already-bound");

    await bindStoredToken("carol");

    expect(keystore.secretStore.get("access_token:carol")).toBe("already-bound");
  });
});

// ── authHeaderToken ───────────────────────────────────────────────────────────

describe("authHeaderToken", () => {
  it("returns the stored token without touching cookies", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "stored-project-token");

    expect(await authHeaderToken()).toBe("stored-project-token");
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });

  it("returns null when there is no stored token", async () => {
    expect(await authHeaderToken()).toBeNull();
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });

  it("returns null when the stored token was erased to the empty string", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "");

    expect(await authHeaderToken()).toBeNull();
  });

  it("returns null when the stamp file contains invalid JSON", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "tok");
    files.set("auth-state.json", "not-json");

    // A corrupt stamp file must not lose the token.
    expect(await authHeaderToken()).toBe("tok");
  });

  it("caches the stored token after first retrieval", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "cached-stored-token");

    expect(await authHeaderToken()).toBe("cached-stored-token");
    keystore.secretStore.clear();
    expect(await authHeaderToken()).toBe("cached-stored-token");
  });

  it("clearTokenCache allows fresh retrieval from storage", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "first-token");
    await authHeaderToken();

    clearTokenCache();
    keystore.secretStore.set("access_token:alice", "second-token");

    expect(await authHeaderToken()).toBe("second-token");
  });

  it("does NOT check the global cookie (prevents cross-project leak)", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "leaked-global-token" },
    ]);

    expect(await authHeaderToken()).toBeNull();
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });
});

// ── captureLogin ──────────────────────────────────────────────────────────────

describe("captureLogin", () => {
  it("checks cookies when no stored token", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "cookie-token" },
    ]);

    expect(await captureLogin()).toBe("cookie-token");
    expect(mockGetPluginCookie).toHaveBeenCalled();
  });

  it("persists the cookie token to the keystore, never to a file", async () => {
    bindFolderTo("alice");
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "cookie-to-store" },
    ]);

    await captureLogin();

    // The pending slot, not @alice's: who just signed in is not known yet.
    expect(keystore.secretStore.get("access_token")).toBe("cookie-to-store");
    for (const [, content] of mockWritePluginFile.mock.calls) {
      expect(content).not.toContain("cookie-to-store");
    }
  });

  it("returns undefined when getPluginCookie returns null (no context)", async () => {
    mockGetPluginCookie.mockResolvedValue(null);
    expect(await captureLogin()).toBeUndefined();
  });

  it("returns null when cookie exists but __access_token is not present", async () => {
    mockGetPluginCookie.mockResolvedValue([{ name: "other_cookie", value: "v" }]);
    expect(await captureLogin()).toBeNull();
  });

  it("still returns the cookie token when the store write fails", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "cookie-despite-storage-fail" },
    ]);
    vi.spyOn(keystore, "setSecret").mockRejectedValue(new Error("storage write failed"));

    expect(await captureLogin()).toBe("cookie-despite-storage-fail");
  });

  it("prefers the stored token over the cookie", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "stored-token");

    expect(await captureLogin()).toBe("stored-token");
    expect(mockGetPluginCookie).not.toHaveBeenCalled();
  });
});

// ── prepareWebviewAuth ────────────────────────────────────────────────────────

describe("prepareWebviewAuth", () => {
  it("projects the stored token into the __access_token cookie", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "tok-α");

    await prepareWebviewAuth();

    expect(mockSetPluginCookie).toHaveBeenCalledWith([
      { name: "__access_token", value: "tok-α" },
    ]);
  });

  it("is a no-op when there is no usable token", async () => {
    await prepareWebviewAuth();
    expect(mockSetPluginCookie).not.toHaveBeenCalled();
  });
});

// ── beginFreshLogin ───────────────────────────────────────────────────────────

describe("beginFreshLogin", () => {
  it("clears the stored token, the stamps AND the cookies", async () => {
    bindFolderTo("alice");
    keystore.secretStore.set("access_token:alice", "old-token");
    files.set("auth-state.json", JSON.stringify({ invalidatedAt: "2026-06-10" }));

    await beginFreshLogin();

    expect(keystore.secretStore.has("access_token:alice")).toBe(false);
    expect(readFile("auth-state.json")).toEqual({});
    expect(mockClearPluginCookies).toHaveBeenCalled();
  });

  it("also empties a leftover auth.json, so a failed migration cannot resurrect the old token", async () => {
    bindFolderTo("alice");
    legacyAuthFile({ accessToken: "stale-plaintext-token" });

    await beginFreshLogin();

    expect(files.get("auth.json")).toBe("{}");
    expect(await authHeaderToken()).toBeNull();
  });

  it("does not create an auth.json for a folder that never had one", async () => {
    await beginFreshLogin();
    expect(files.has("auth.json")).toBe(false);
  });
});
