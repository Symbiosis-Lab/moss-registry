/**
 * Pinata credential storage.
 *
 * The Pinata JWT is a secret, so it is stored via plugin cookies (like the
 * GitHub token in github/src/token.ts), never in config.json. Resolution
 * order: the in-memory cache for this session, then the stored cookie.
 *
 * There is deliberately no environment-variable override: the host's
 * `get_plugin_env_var` allow-list refuses any name outside MOSS_MATTERS_*, so
 * the documented MOSS_IPFS_PINATA_JWT escape hatch could never have worked.
 */

import {
  getPluginCookie,
  setPluginCookie,
  clearPluginCookies,
} from "@symbiosis-lab/moss-api";

const JWT_COOKIE_NAME = "__pinata_jwt";
const PINATA_HOST = "pinata.cloud";

let cachedJwt: string | null = null;

/** Retrieve the Pinata JWT, or null if unset. */
export async function getPinataJwt(): Promise<string | null> {
  if (cachedJwt) return cachedJwt;

  try {
    const cookies = await getPluginCookie();
    const cookie = cookies?.find((c) => c.name === JWT_COOKIE_NAME);
    if (cookie) {
      cachedJwt = cookie.value;
      return cachedJwt;
    }
  } catch {
    // Cookie retrieval failed — treat as unset.
  }

  return null;
}

/** Persist the Pinata JWT (cookie + in-memory cache). */
export async function storePinataJwt(jwt: string): Promise<boolean> {
  try {
    await setPluginCookie([{ name: JWT_COOKIE_NAME, value: jwt, domain: PINATA_HOST }]);
  } catch {
    // Cookie write failed — still cache in memory for this session.
  }
  cachedJwt = jwt;
  return true;
}

/**
 * Remove the stored Pinata JWT.
 *
 * `setPluginCookie([])` does NOT do this: the host returns early on an empty
 * list (`write_plugin_cookies`), so the rejected token survived and came back
 * on the next deploy, every session. `clearPluginCookies()` is the call that
 * actually clears the plugin's domain.
 */
export async function clearPinataJwt(): Promise<void> {
  try {
    await clearPluginCookies();
  } catch {
    // Ignore — the in-memory cache is cleared either way.
  }
  cachedJwt = null;
}
