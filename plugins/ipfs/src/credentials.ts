/**
 * Pinata credential storage.
 *
 * The Pinata JWT is a secret, so it is stored via plugin cookies (like the
 * GitHub token in github/src/token.ts), never in config.json. Resolution order:
 *   1. MOSS_IPFS_PINATA_JWT env var (power-user / CI override, never persisted)
 *   2. In-memory cache (current session)
 *   3. Plugin cookie
 */

import {
  getPluginCookie,
  setPluginCookie,
  getPluginEnvVar,
} from "@symbiosis-lab/moss-api";

const JWT_COOKIE_NAME = "__pinata_jwt";
const PINATA_HOST = "pinata.cloud";
const ENV_OVERRIDE = "MOSS_IPFS_PINATA_JWT";

let cachedJwt: string | null = null;

/**
 * Retrieve the Pinata JWT, or null if unset.
 * The env override wins so CI/power users can skip the setup panel.
 */
export async function getPinataJwt(): Promise<string | null> {
  // 1. Env override (never cached or persisted).
  try {
    const env = await getPluginEnvVar(ENV_OVERRIDE);
    if (env && env.length > 0) return env;
  } catch {
    // getPluginEnvVar unavailable — fall through.
  }

  // 2. In-memory cache.
  if (cachedJwt) return cachedJwt;

  // 3. Plugin cookie.
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

/** Clear the in-memory JWT cache (does not touch stored cookies). */
export function clearJwtCache(): void {
  cachedJwt = null;
}

/** Remove the stored Pinata JWT. */
export async function clearPinataJwt(): Promise<void> {
  try {
    await setPluginCookie([]);
  } catch {
    // Ignore.
  }
  cachedJwt = null;
}
