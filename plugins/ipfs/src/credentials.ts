/**
 * The Pinata credential, which this plugin reads and never collects.
 *
 * moss holds it (ADR-072): the manifest declares `pinata_jwt` under
 * `contributes.deploy_target.setup.credentials`, moss's own modal is the only
 * thing that ever asks for it, and the store is app-global — a Pinata account
 * is an account fact, not a per-project one. The plugin's whole surface is the
 * two calls below.
 *
 * Rejecting is the half that is easy to forget: without it a revoked token
 * fails every publish identically forever, because nothing ever asks for a new
 * one.
 */

import { getSecret, rejectSecret } from "@symbiosis-lab/moss-api";

/** The key in moss's secret store, and in the manifest's `credentials` block. */
export const PINATA_JWT_KEY = "pinata_jwt";

/** The stored Pinata JWT, or null when the user has not given moss one. */
export async function getPinataJwt(): Promise<string | null> {
  return await getSecret(PINATA_JWT_KEY);
}

/**
 * Tell moss the token no longer works, so the next publish asks for a new one.
 * Only for a credential the service itself refused (401/403) — a transport
 * failure throws away a working token.
 */
export async function rejectPinataJwt(): Promise<void> {
  await rejectSecret(PINATA_JWT_KEY);
}
