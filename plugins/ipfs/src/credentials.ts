/**
 * Pinata credential access.
 *
 * The JWT is a declared `secret` setting (`pinata_jwt` in manifest.json), so
 * moss collects it in its own credential modal and holds it in the OS
 * keystore. The plugin only reads it back, and marks it bad when Pinata
 * rejects it — `rejectSecret` forgets the stored value and re-asks the user
 * with the reason, resolving with the replacement (or null on cancel).
 *
 * Host calls are invoked directly here because the published moss-api (0.12.0)
 * predates `getSecret`/`rejectSecret`; when a release that exports them ships,
 * this module becomes two one-line re-exports.
 */

const PINATA_JWT_KEY = "pinata_jwt";

interface TauriWindow {
  __TAURI__?: { core?: { invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> } };
}

function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const core = (globalThis as TauriWindow).__TAURI__?.core;
  if (!core) throw new Error("moss host not available");
  return core.invoke<T>(cmd, args);
}

/** The stored Pinata JWT, or null when there is none (or nobody can be asked). */
export async function getPinataJwt(): Promise<string | null> {
  return invoke<string | null>("get_plugin_secret", { key: PINATA_JWT_KEY });
}

/**
 * Tell moss the stored JWT no longer works. moss forgets it and re-asks with
 * `detail` as the reason; resolves with the fresh token, or null if the user
 * declined (or there is no window to ask in — headless builds).
 */
export async function rejectPinataJwt(detail: string): Promise<string | null> {
  return invoke<string | null>("reject_plugin_secret", { key: PINATA_JWT_KEY, detail });
}
