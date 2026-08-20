/**
 * Is the site live, or is it not?
 *
 * The user asked for exactly one thing here: "I shouldn't need to know
 * 'Published, but not reachable on Tor yet'; I just need to know if it is live
 * or not." So this is a binary with an explicit third value for "we don't know
 * yet" — and "we don't know yet" is never allowed to masquerade as either
 * answer.
 *
 * What it replaces: a single string, "Published, but not reachable on Tor yet
 * — the address should resolve within a minute." That sentence predicted a
 * recovery it had no way to know about. The user hit it during an outage where
 * nothing resolved within a minute, or at all, because the transport was
 * wedged (see the watchdog's escalation ladder). A message that is reassuring
 * and wrong is worse than one that is blunt and right.
 */

/** The only three things we may say. */
export type Liveness = "live" | "not-live" | "checking";

/**
 * Response codes that mean OnionHeaven answered, not the site.
 *
 * OnionHeaven is failover, not hosting: when an address goes offline it takes
 * it over and serves 302s to a Wayback snapshot. That keeps a link from
 * 404ing, which is a real service — but it is a strictly weaker promise than
 * "your site is live", and reporting the weaker one as the stronger one is the
 * bug moss#917 was filed for. For a site published minutes ago the snapshot
 * predates the post the user just wrote; for a brand-new site there is no
 * snapshot at all.
 */
const FAILOVER_CODES = new Set(["takeover"]);

/**
 * Classify what the receiver told us.
 *
 * `reachable === null` means the check has not resolved — an older receiver,
 * or a probe still in flight. It is NOT a negative, and it is NOT a success.
 */
export function classifyLiveness(
  reachable: boolean | null | undefined,
  httpCode?: string | null,
): Liveness {
  // Belt and braces: a failover answer is not-live whatever the boolean says.
  // The receiver already reports takeover as `reachable: false`, so this only
  // matters if that ever changes — and if it does, it must fail in the safe
  // direction rather than promote failover to hosting.
  if (httpCode && FAILOVER_CODES.has(httpCode)) return "not-live";
  if (reachable === true) return "live";
  if (reachable === false) return "not-live";
  return "checking";
}

// The per-verdict user-facing sentences that used to live here
// (livenessMessage / livenessToastVariant) moved with the toast itself: moss
// owns every status surface, and the publish wording ladder is
// `frontend/app/workflows/deploy/publish-verify-strings.ts`. This module's
// remaining job is the verdict, which travels as data in
// `deployment.metadata.liveness`.
