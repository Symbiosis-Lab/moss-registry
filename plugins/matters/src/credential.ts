/**
 * Matters credential — the single owner of this folder's matters login.
 *
 * The access token lives in moss's keystore, not in a file. `.moss/plugins/` is
 * inside the user's repo, is not gitignored, and is `CloudPolicy::Synced`, so a
 * token kept there is a token that gets committed and uploaded to whatever syncs
 * the vault — for one folder we know of, a shared Google Drive. ADR-032 already
 * settled this for signing keys, as custody rather than restriction; a token
 * somebody else issued the user is the same argument one shape down, which is
 * what `setSecret` is for. The gate is per-KEY: a plugin may not write a slot
 * its manifest declared as one moss asks the user for. matters declares none —
 * every token here came back from a login it ran — so all of these writes are
 * its own.
 *
 * The store is app-global — `Scope` has `System` and `Plugin(name)` and no
 * project dimension, deliberately, because a per-vault store re-introduces the
 * shared-folder problem. matters' token is per-ACCOUNT, so the key carries the
 * account: `access_token:<boundUserName>`. Two folders bound to one account
 * share a token (correct); two folders bound to two accounts do not (also
 * correct, and what `prepareWebviewAuth` depends on).
 *
 * Which account a token belongs to is decided in exactly ONE place. A capture
 * never knows whose token it holds — logging in as a second account happens
 * while the config still names the first — so every capture writes the PENDING
 * slot, and `bindStoredToken(userName)`, called once the profile fetch says who
 * just signed in, is the only writer of `access_token:<user>`. No capture can
 * therefore file a credential under the wrong account; `tokenKey()` is left
 * deriving a key only to read this folder's token, or to erase it on logout.
 *
 * What is left in plugin storage is `auth-state.json`, three timestamps and no
 * secret. They have to live somewhere: the keystore holds an opaque string, and
 * `getSessionState` must keep "expired" distinguishable from "never logged in"
 * because the two route differently.
 *
 * The two credentials a folder uses are both projections of the stored token:
 *   - the `x-access-token` HTTP header for API calls (authHeaderToken)
 *   - the global `__access_token` cookie for matters.town webviews (prepareWebviewAuth)
 *
 * The global cookie is never a durable store — it is set just-in-time before a
 * webview, cleared before a fresh login, and read exactly once (capturing a
 * fresh login back into the keystore).
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
  getPluginCookie,
  setPluginCookie,
  clearPluginCookies,
  getSecret,
  setSecret,
} from "@symbiosis-lab/moss-api";
import { accessTokenCookieName } from "./domain";
import { getConfig } from "./config";

// ============================================================================
// Token storage (moss keystore = SSOT)
// ============================================================================

/** Pre-keystore plaintext token file. Read once, by the migration, then emptied. */
const LEGACY_AUTH_FILE = "auth.json";

/** Non-secret companion: the three stamps the keystore cannot carry. */
const STATE_FILE = "auth-state.json";

const TOKEN_KEY_PREFIX = "access_token:";

/**
 * Where a token sits between "captured" and "we know whose it is". A first
 * login has no `boundUserName` yet — the profile fetch that discovers it needs
 * the token — so the token is parked here and `bindStoredToken` moves it under
 * the account key as soon as the binding is affirmed.
 */
const PENDING_TOKEN_KEY = "access_token";

let cachedAccessToken: string | null = null;

/**
 * Clear the cached access token
 */
export function clearTokenCache(): void {
  cachedAccessToken = null;
}

/**
 * The store key for this folder's token: the bound account, or the pending slot
 * when the folder is not bound yet.
 */
async function tokenKey(): Promise<string> {
  const { boundUserName } = await getConfig();
  return boundUserName ? `${TOKEN_KEY_PREFIX}${boundUserName}` : PENDING_TOKEN_KEY;
}

/**
 * Read a secret, treating the empty string as absent.
 *
 * The engine seam has a get, a set and a reject arm — there is no delete. So
 * "forget this token" is written as the empty string, and `rejectSecret` is not
 * borrowed for it: rejecting means the SERVER refused the credential, which is a
 * different fact from "this slot is no longer the right home for it".
 */
async function readSecret(key: string): Promise<string | null> {
  const value = await getSecret(key);
  return value ? value : null;
}

/**
 * Load a USABLE access token, migrating a pre-keystore folder on the way.
 *
 * Credential supply, not session evidence: returns null for expired or
 * server-invalidated tokens so no caller (graphqlQuery, and critically the
 * login flow's waitForToken poll, which reads storage FIRST) can pick up a
 * dead credential. getSessionState reads the raw record instead.
 */
async function loadStoredToken(): Promise<string | null> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return null;
  if (isRecordDead(record)) return null;
  return record.accessToken;
}

/**
 * Park a freshly captured token in the PENDING slot.
 *
 * Never the account key: at capture time the config still names whoever was
 * signed in BEFORE this login, so deriving a key here writes the new account's
 * live token into the old account's slot. `bindStoredToken` promotes it once
 * the profile fetch says whose it is; until then `captureLogin`'s in-memory
 * cache is what serves that fetch.
 */
async function parkCapturedToken(token: string): Promise<void> {
  await setSecret(PENDING_TOKEN_KEY, token);
  await saveAuthState({ savedAt: new Date().toISOString() });
  console.log("💾 Access token saved to the moss keystore");
}

/**
 * Move a token captured before the folder was bound under the account's own
 * key. No-op unless a first login left one in the pending slot.
 */
export async function bindStoredToken(userName: string): Promise<void> {
  // A blank name would key the token to `access_token:`, a slot every unnamed
  // folder would then share — the collapse this keying exists to prevent.
  if (!userName) return;
  const pending = await readSecret(PENDING_TOKEN_KEY);
  if (!pending) return;
  await setSecret(`${TOKEN_KEY_PREFIX}${userName}`, pending);
  await setSecret(PENDING_TOKEN_KEY, "");
  console.log(`🔑 Token now keyed to @${userName}`);
}

/**
 * Forget this folder's stored token and its stamps.
 */
async function clearStoredToken(): Promise<void> {
  cachedAccessToken = null;
  try {
    await setSecret(await tokenKey(), "");
    // Also the pending slot: an unbound folder whose first login captured a
    // token but never got a profile back would otherwise short-circuit the
    // retry with the stale one (captureLogin reads storage first).
    await setSecret(PENDING_TOKEN_KEY, "");
    await saveAuthState({});
    // A folder whose migration failed still has its token in auth.json, and
    // loadAuthRecord still reads it. Leaving it here would resurrect the old
    // token straight after a "fresh" login. Only touched when it exists, so a
    // post-migration folder never grows the file back.
    if (await pluginFileExists(LEGACY_AUTH_FILE)) {
      await writePluginFile(LEGACY_AUTH_FILE, "{}");
    }
  } catch {
    // Ignore write failures
  }
}

// ============================================================================
// Migration off the plaintext auth.json (2026-08-30)
// ============================================================================

let migration: Promise<void> | null = null;

/**
 * Move a pre-keystore folder's token into the store, once.
 *
 * The order is the whole point: write, read both halves BACK, and only then
 * empty the plaintext file. Delete-before-verify strands a user whose store
 * write failed, and this runs on real users' data exactly once — there is no
 * second chance to fix a bug in it. If any step fails, `auth.json` is left
 * intact; `loadAuthRecord` then reads whichever halves landed and takes the
 * rest from the file, so the worst case is today's behaviour rather than a
 * forced re-login or a token that lost its invalidatedAt on the way.
 *
 * The file is emptied rather than deleted because the plugin seam has no delete
 * verb; `{}` is what `clearStoredToken` has always written, and it holds nothing
 * an attacker wants.
 */
async function migrateLegacyAuthFile(): Promise<boolean> {
  const legacy = await readLegacyRecord();
  if (!legacy) return true;
  if (typeof legacy.accessToken !== "string" || legacy.accessToken === "") {
    // Nothing secret in it (an emptied file, or one this migration already
    // drained). Leave it alone rather than writing for the sake of writing.
    return true;
  }

  const { boundUserName } = await getConfig();
  if (!boundUserName) {
    // No account to key it to yet. Parking it in the pending slot would make
    // that app-global slot durable — two unbound folders on two accounts would
    // overwrite each other there, with both auth.json files already drained.
    // The process hook binds before it reads, so the normal path migrates on
    // the same run, one step later.
    return false;
  }
  const key = `${TOKEN_KEY_PREFIX}${boundUserName}`;
  const state = stampsOf(legacy);

  try {
    if (await readSecret(key)) {
      // Another folder on this account already moved a token here, and it is
      // the one every folder on the account now authenticates with. Drain the
      // plaintext copy anyway — that is the point of the migration — but leave
      // the store, and its stamps, alone: they describe a different token.
      await writePluginFile(LEGACY_AUTH_FILE, "{}");
      console.log("🔐 Matters token already in the keystore for this account; auth.json drained");
      return true;
    }
    await setSecret(key, legacy.accessToken);
    await saveAuthState(state);

    if ((await getSecret(key)) !== legacy.accessToken) {
      console.warn("🔐 Migration: keystore did not read back the token; keeping auth.json");
      return true;
    }
    const readBack = await loadAuthState();
    if (!stampsMatch(readBack, state)) {
      console.warn("🔐 Migration: auth-state.json did not read back; keeping auth.json");
      return true;
    }

    await writePluginFile(LEGACY_AUTH_FILE, "{}");
    console.log("🔐 Matters token moved from auth.json into the moss keystore");
  } catch (e) {
    console.warn(`🔐 Migration off auth.json failed (keeping the file): ${e}`);
  }
  return true;
}

/** Run the migration at most once per plugin context, before any token read. */
function ensureMigrated(): Promise<void> {
  migration ??= migrateLegacyAuthFile().then((settled) => {
    // An unbound folder has no account key to migrate into, so it did not
    // settle: forget the attempt, and the first read after binding retries.
    if (!settled) migration = null;
  });
  return migration;
}

/** Test seam: forget that the migration ran. */
export function resetMigrationForTests(): void {
  migration = null;
}

function stampsMatch(a: AuthState, b: AuthState): boolean {
  return (
    a.savedAt === b.savedAt &&
    a.invalidatedAt === b.invalidatedAt &&
    a.nudgedAt === b.nudgedAt
  );
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

/** The non-secret half: when the token was saved, refused, and nudged about. */
interface AuthState {
  savedAt?: string;
  /** Stamped when the server rejected the token (TOKEN_INVALID). */
  invalidatedAt?: string;
  /** Stamped when the expired-session nudge was shown for this token. */
  nudgedAt?: string;
}

interface AuthRecord extends AuthState {
  accessToken?: string;
}

async function readJsonFile<T>(name: string): Promise<T | null> {
  try {
    const exists = await pluginFileExists(name);
    if (!exists) return null;
    return JSON.parse(await readPluginFile(name)) as T;
  } catch {
    return null;
  }
}

async function readLegacyRecord(): Promise<AuthRecord | null> {
  return await readJsonFile<AuthRecord>(LEGACY_AUTH_FILE);
}

async function loadAuthState(): Promise<AuthState> {
  return (await readJsonFile<AuthState>(STATE_FILE)) ?? {};
}

/** The non-secret half of a record — what `auth-state.json` may hold. */
function stampsOf(record: AuthRecord): AuthState {
  return {
    savedAt: record.savedAt,
    invalidatedAt: record.invalidatedAt,
    nudgedAt: record.nudgedAt,
  };
}

async function saveAuthState(state: AuthState): Promise<void> {
  await writePluginFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * The token plus its stamps, as one record — the shape the session checks read.
 *
 * The keystore is the source of truth. The plaintext file is consulted only
 * when the store has nothing, which after a successful migration it never does;
 * that fallback is what keeps a failed migration from logging the user out.
 */
async function loadAuthRecord(): Promise<AuthRecord | null> {
  await ensureMigrated();
  const legacy = await readLegacyRecord();
  const legacyToken =
    typeof legacy?.accessToken === "string" && legacy.accessToken !== "" ? legacy.accessToken : null;
  const token = (await readSecret(await tokenKey())) ?? legacyToken;
  if (!token) return null;
  // Token and stamps are sourced independently, because a half-finished
  // migration can leave one in each place: `auth-state.json` is the stamps once
  // it exists, and until then the legacy file still carries them. Without that
  // fallback a failed stamp write would drop an invalidatedAt while the token
  // itself read back fine — a server-revoked session reported as valid, the
  // presence-only bug the tri-state replaced.
  const stamps = (await readJsonFile<AuthState>(STATE_FILE)) ?? stampsOf(legacy ?? {});
  return { accessToken: token, ...stamps };
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
 * the expired token stays stored as the "session expired" marker.
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
 * auth state so every later check is offline; keep the token so "expired
 * session" stays distinguishable from "never logged in" (they route
 * differently). A fresh login overwrites the stamps via parkCapturedToken.
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
  try {
    await saveAuthState({ ...stampsOf(record), invalidatedAt: new Date().toISOString() });
  } catch {
    // Best-effort: the runtime backstop fires again on the next request.
  }
}

/**
 * Once-per-expiry-event throttle for the "session expired" toast, persisted
 * beside the token (NOT module state: the off-webview engine migration
 * allows per-build contexts, under which module flags reset every build and
 * sync_on_build would toast every build). Fresh login rewrites the state,
 * clearing nudgedAt, so the next expiry event nudges again.
 */
export async function shouldNudgeSessionExpired(): Promise<boolean> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return false;
  if (record.nudgedAt) return false;
  try {
    await saveAuthState({ ...stampsOf(record), nudgedAt: new Date().toISOString() });
  } catch {
    // Failing to persist means we may nudge again next build; harmless.
  }
  return true;
}

// ============================================================================
// Credential projections
// ============================================================================

/**
 * Read a USABLE token for the `x-access-token` API header. Stored token only
 * (no cookie) — the API never authenticates via the cookie. Returns null
 * when there is no usable stored token (caller must trigger login).
 */
export async function authHeaderToken(): Promise<string | null> {
  if (cachedAccessToken !== null) {
    return cachedAccessToken;
  }
  try {
    const storedToken = await loadStoredToken();
    if (storedToken) {
      console.log("🔑 Using stored access token from the moss keystore");
      cachedAccessToken = storedToken;
      return cachedAccessToken;
    }
  } catch {
    // No usable stored token.
  }
  return null;
}

/**
 * Login-only: capture the freshly-set `__access_token` cookie into the keystore.
 *
 * Reads the stored token FIRST (so a still-valid token short-circuits), then the
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
      // parkCapturedToken (erasing the invalidatedAt stamp) and end the login
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

        // Immediately persist so future calls don't need cookies
        try {
          await parkCapturedToken(value);
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
 * Project this folder's stored token into the global `__access_token` cookie
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
 * only a freshly-logged-in token can be captured (captureLogin reads the stored
 * token before the cookie). Cookie-clear failure is non-fatal.
 */
export async function beginFreshLogin(): Promise<void> {
  await clearStoredToken();
  try {
    await clearPluginCookies();
  } catch (e) {
    console.warn(`⚠️ Failed to clear matters cookies before login: ${e}`);
  }
}
