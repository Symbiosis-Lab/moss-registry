/**
 * In-memory stand-in for moss's keystore, for the suites that exercise the real
 * `credential.ts` rather than mocking it. The real `getSecret`/`setSecret` reach
 * a Tauri command, so a suite that spreads `importActual` over the moss-api
 * module otherwise gets a token store that throws.
 *
 * A module singleton, because a `vi.mock` factory and the test body must see the
 * same map: the factory imports this module, and so does the test.
 */

/** Keys as `credential.ts` writes them — `access_token` or `access_token:<user>`. */
export const secretStore = new Map<string, string>();

export async function getSecret(key: string): Promise<string | null> {
  return secretStore.get(key) ?? null;
}

/** Empty erases, as the host does — `credential.ts` signs out by writing `""`. */
export async function setSecret(key: string, value: string): Promise<void> {
  if (value === "") secretStore.delete(key);
  else secretStore.set(key, value);
}

export function resetSecretStore(): void {
  secretStore.clear();
}
