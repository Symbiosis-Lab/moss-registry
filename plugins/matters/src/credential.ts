/**
 * Matters credential — the single owner of this folder's matters login.
 *
 * `auth.json` (per-folder plugin storage) is the source of truth. The two
 * credentials a folder uses are both projections of it:
 *   - the `x-access-token` HTTP header for API calls (authHeaderToken)
 *   - the global `__access_token` cookie for matters.town webviews (prepareWebviewAuth)
 *
 * The global cookie is never a durable store — it is set just-in-time from
 * auth.json before a webview, cleared before a fresh login, and read exactly
 * once (capturing a fresh login back into auth.json).
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
  getPluginCookie,
  setPluginCookie,
  clearPluginCookies,
} from "@symbiosis-lab/moss-api";
import { accessTokenCookieName } from "./domain";

// ============================================================================
// Token storage (auth.json = SSOT)
// ============================================================================

const AUTH_FILE = "auth.json";

let cachedAccessToken: string | null = null;

/**
 * Clear the cached access token
 */
export function clearTokenCache(): void {
  cachedAccessToken = null;
}

/**
 * Load a USABLE access token from project-scoped plugin storage.
 *
 * Credential supply, not session evidence: returns null for expired or
 * server-invalidated tokens so no caller (graphqlQuery, and critically the
 * login flow's waitForToken poll, which reads storage FIRST) can pick up a
 * dead credential. getSessionState reads the raw record instead.
 */
export async function loadStoredToken(): Promise<string | null> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return null;
  if (isRecordDead(record)) return null;
  return record.accessToken;
}

/**
 * Save access token to project-scoped plugin storage.
 * This makes the token survive across sessions and scopes it to this project.
 */
export async function saveStoredToken(token: string): Promise<void> {
  const data = { accessToken: token, savedAt: new Date().toISOString() };
  await writePluginFile(AUTH_FILE, JSON.stringify(data, null, 2));
  console.log("💾 Access token saved to project storage");
}

/**
 * Remove stored access token from project storage.
 */
export async function clearStoredToken(): Promise<void> {
  cachedAccessToken = null;
  try {
    await writePluginFile(AUTH_FILE, "{}");
  } catch {
    // Ignore write failures
  }
}

// ============================================================================
// Session state
// ============================================================================

/**
 * Decode the `exp` claim from a JWT, in milliseconds since epoch.
 *
 * No signature verification: we are reading our own stored credential to
 * predict whether the server will accept it, not authenticating anyone.
 * Returns null when the token is not a decodable JWT or has no numeric exp,
 * in which case the caller must fall back to runtime detection.
 */
export function decodeJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export type SessionState = "valid" | "expired" | "none";

/** Tokens within this margin of expiry count as expired (clock skew). */
const EXPIRY_SKEW_MS = 60_000;

interface AuthRecord {
  accessToken?: string;
  savedAt?: string;
  /** Stamped when the server rejected the token (TOKEN_INVALID). */
  invalidatedAt?: string;
  /** Stamped when the expired-session nudge was shown for this record. */
  nudgedAt?: string;
}

async function loadAuthRecord(): Promise<AuthRecord | null> {
  try {
    const exists = await pluginFileExists(AUTH_FILE);
    if (!exists) return null;
    return JSON.parse(await readPluginFile(AUTH_FILE)) as AuthRecord;
  } catch {
    return null;
  }
}

/** A record whose token the server would reject (past exp or server-stamped). */
function isRecordDead(record: AuthRecord): boolean {
  if (record.invalidatedAt) return true;
  if (typeof record.accessToken !== "string") return false;
  const expMs = decodeJwtExpiryMs(record.accessToken);
  return expMs !== null && expMs <= Date.now() + EXPIRY_SKEW_MS;
}

/**
 * Honest session check: distinguishes a usable token ("valid"), a token the
 * server will reject ("expired": past JWT exp or server-stamped invalid),
 * and no token at all ("none"). Replaces the old presence-only check that
 * logged AUTHENTICATED for a 30-days-dead token. Reads the RAW record:
 * the expired token stays on disk as the "session expired" marker.
 */
export async function getSessionState(): Promise<SessionState> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return "none";

  if (record.invalidatedAt) {
    console.log(`🔑 Token present but server-invalidated at ${record.invalidatedAt}`);
    return "expired";
  }

  const expMs = decodeJwtExpiryMs(record.accessToken);
  if (expMs === null) {
    console.log("🔑 Token present (not a decodable JWT; assuming valid, runtime check will verify)");
    return "valid";
  }
  if (expMs <= Date.now() + EXPIRY_SKEW_MS) {
    console.log(`🔑 Token present but EXPIRED since ${new Date(expMs).toISOString()}`);
    return "expired";
  }
  console.log(`🔑 Token present, expires ${new Date(expMs).toISOString()}`);
  return "valid";
}

/**
 * The server rejected the token (TOKEN_INVALID/UNAUTHENTICATED). Stamp the
 * auth record so every later check is offline; keep the token so "expired
 * session" stays distinguishable from "never logged in" (they route
 * differently). A fresh login overwrites the whole record via
 * saveStoredToken, clearing the stamp.
 */
export async function markSessionInvalidated(): Promise<void> {
  cachedAccessToken = null;
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") {
    // Nothing to invalidate. Stamping {invalidatedAt} alone would diverge
    // the checks: getSessionState would say "none" while isRecordDead says
    // dead. Clearing the cache above is still wanted.
    return;
  }
  record.invalidatedAt = new Date().toISOString();
  try {
    await writePluginFile(AUTH_FILE, JSON.stringify(record, null, 2));
  } catch {
    // Best-effort: the runtime backstop fires again on the next request.
  }
}

/**
 * Once-per-expiry-event throttle for the "session expired" toast, persisted
 * in the auth record (NOT module state: the off-webview engine migration
 * allows per-build contexts, under which module flags reset every build and
 * sync_on_build would toast every build). Fresh login rewrites the record,
 * clearing nudgedAt, so the next expiry event nudges again.
 */
export async function shouldNudgeSessionExpired(): Promise<boolean> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return false;
  if (record.nudgedAt) return false;
  record.nudgedAt = new Date().toISOString();
  try {
    await writePluginFile(AUTH_FILE, JSON.stringify(record, null, 2));
  } catch {
    // Failing to persist means we may nudge again next build; harmless.
  }
  return true;
}

// ============================================================================
// Credential projections
// ============================================================================

/**
 * Read a USABLE token for the `x-access-token` API header. Project storage
 * only (no cookie) — the API never authenticates via the cookie. Returns null
 * when there is no usable stored token (caller must trigger login).
 */
export async function authHeaderToken(): Promise<string | null> {
  if (cachedAccessToken !== null) {
    return cachedAccessToken;
  }
  try {
    const storedToken = await loadStoredToken();
    if (storedToken) {
      console.log("🔑 Using stored access token from project storage");
      cachedAccessToken = storedToken;
      return cachedAccessToken;
    }
  } catch {
    // No usable stored token.
  }
  return null;
}

/**
 * Login-only: capture the freshly-set `__access_token` cookie into auth.json.
 *
 * Reads stored storage FIRST (so a still-valid token short-circuits), then the
 * global WebKit cookie. Used only by the waitForToken login poll.
 *
 * @returns
 *   - `string`    - the access token if found
 *   - `null`      - no token found (but plugin context was available)
 *   - `undefined` - no plugin context (e.g., hook ended, window closed)
 */
export async function captureLogin(): Promise<string | null | undefined> {
  const fromStorage = await authHeaderToken();
  if (fromStorage) return fromStorage;

  try {
    console.log("🍪 Checking cookies for access token (login flow)...");
    const cookies = await getPluginCookie();

    // null means "no plugin context" - signal caller to stop
    if (cookies === null) {
      console.log("⚠️ No plugin context - cannot get cookies");
      return undefined;
    }

    const tokenCookie = cookies.find((c) => c.name === accessTokenCookieName());

    if (tokenCookie) {
      console.log(`Found __access_token cookie (length: ${tokenCookie.value?.length ?? 0})`);
      // Dead-cookie filter: the shared WebKit store can still hold a token
      // the server has revoked (matches the invalidatedAt-stamped record) or
      // one whose exp already passed. Capturing it here would persist it via
      // saveStoredToken (erasing the invalidatedAt stamp) and end the login
      // poll with a dead credential, looping the user out of re-login. A
      // rejected cookie behaves as "no token found" so the poll keeps
      // waiting for the fresh one.
      const value = tokenCookie.value;
      const currentRecord = await loadAuthRecord();
      if (isRecordDead({ accessToken: value })) {
        console.warn("🍪 Ignoring expired __access_token cookie (stale login state)");
      } else if (currentRecord?.invalidatedAt && currentRecord.accessToken === value) {
        console.warn("🍪 Ignoring __access_token cookie matching the server-invalidated token");
      } else {
        cachedAccessToken = value;

        // Immediately persist to project storage so future calls don't need cookies
        try {
          await saveStoredToken(value);
        } catch (e) {
          console.warn(`Failed to persist token to storage: ${e}`);
        }
      }
    } else {
      console.warn("__access_token cookie NOT found");
    }

    return cachedAccessToken;
  } catch (error) {
    console.error(`❌ Failed to capture login token: ${error}`);
    return null;
  }
}

/**
 * Project this folder's auth.json token into the global `__access_token` cookie
 * so a matters.town webview authenticates as the BOUND account. The cookie is
 * the webview's only credential (matters-web reads it via auto-send to
 * server.matters.town — verified 2026-06-23). The manifest domain (.matters.town)
 * + http_only are applied by the Rust write path, so the browser auto-sends it.
 * Best-effort: a write failure must not abort the syndication flow. No-op when
 * there is no usable token.
 */
export async function prepareWebviewAuth(): Promise<void> {
  const token = await authHeaderToken();
  if (!token) {
    console.warn("⚠️ prepareWebviewAuth: no usable token; webview will be unauthenticated");
    return;
  }
  try {
    await setPluginCookie([{ name: accessTokenCookieName(), value: token }]);
  } catch (e) {
    console.warn(`⚠️ prepareWebviewAuth: failed to set matters cookie: ${e}`);
  }
}

/**
 * Force-fresh login: clear THIS folder's stored token AND the matters-domain
 * cookies before opening the login webview, so the login screen is genuine and
 * only a freshly-logged-in token can be captured (getAccessToken/captureLogin
 * read the stored token before the cookie). Cookie-clear failure is non-fatal.
 */
export async function beginFreshLogin(): Promise<void> {
  await clearStoredToken();
  try {
    await clearPluginCookies();
  } catch (e) {
    console.warn(`⚠️ Failed to clear matters cookies before login: ${e}`);
  }
}
