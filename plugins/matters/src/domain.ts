/**
 * Domain configuration module for the Matters plugin
 *
 * Centralizes all domain-dependent URL construction and domain state.
 * The domain defaults to "matters.town" but can be overridden via
 * plugin config (config.json: { "domain": "matters.icu" }).
 *
 * Call initializeDomain() at the start of each hook (process, syndicate)
 * to load the configured domain and update the API endpoint + manifest.
 */

import { readPluginFile, writePluginFile, getPluginEnvVar } from "@symbiosis-lab/moss-api";
import { getConfig } from "./config";
import { apiConfig } from "./api";

// ============================================================================
// State
// ============================================================================

const DEFAULT_DOMAIN = "matters.town";
let currentDomain = DEFAULT_DOMAIN;

// The auth-token cookie name is env-specific: production (matters.town) names it
// `__access_token`, but the staging web app (e.g. matters.icu) names it
// `__dev__access_token`. Derived from currentDomain in initializeDomain() so the
// login poll reads the right cookie and login is actually detected.
let currentTokenCookieName = "__access_token";

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize domain configuration from plugin config.
 *
 * Must be called at the start of each hook (process, syndicate).
 * Reads `domain` from config.json, updates:
 * - Module-level currentDomain state
 * - apiConfig.endpoint for GraphQL requests
 * - manifest.json domain field (so Rust cookie filtering uses the correct domain)
 *
 * @returns The configured domain
 */
export async function initializeDomain(): Promise<string> {
  const config = await getConfig();
  currentDomain = config.domain || DEFAULT_DOMAIN;

  // Allow MOSS_MATTERS_DOMAIN env var to override config.domain — enables
  // test-env switching (e.g. matters.icu) via moss-claude.sh without
  // pre-seeding .moss/plugins/matters/config.json. Must happen before the
  // endpoint is set so the whole init uses the env-specified domain.
  const envDomain = await getPluginEnvVar("MOSS_MATTERS_DOMAIN");
  if (envDomain && envDomain.length > 0) {
    console.info(`📍 MOSS_MATTERS_DOMAIN override: ${envDomain} (was: ${currentDomain})`);
    currentDomain = envDomain;
  }

  // Derive the auth-token cookie name from the finalized domain. Production
  // (matters.town) uses `__access_token`; any non-default (staging) domain uses
  // `__dev__access_token`. Without this, the login poll watches the wrong cookie
  // on staging and never detects login.
  currentTokenCookieName =
    currentDomain === DEFAULT_DOMAIN ? "__access_token" : "__dev__access_token";

  // Update API endpoint
  apiConfig.endpoint = `https://server.${currentDomain}/graphql`;

  // Update manifest.json domain if it differs (for Rust cookie filtering)
  try {
    const manifestContent = await readPluginFile("manifest.json");
    const manifest = JSON.parse(manifestContent);

    if (manifest.domain !== currentDomain) {
      manifest.domain = currentDomain;
      await writePluginFile("manifest.json", JSON.stringify(manifest, null, 2));
      console.log(
        `📍 Updated manifest domain to ${currentDomain}`
      );
    }
  } catch {
    // Manifest read/write failure is non-fatal
    console.warn(
      `⚠️ Could not update manifest domain to ${currentDomain}`
    );
  }

  console.info(`📍 Matters domain: ${currentDomain}`);
  return currentDomain;
}

/**
 * Reset domain to default (for testing)
 */
export function resetDomain(): void {
  currentDomain = DEFAULT_DOMAIN;
  currentTokenCookieName = "__access_token";
  apiConfig.endpoint = `https://server.${DEFAULT_DOMAIN}/graphql`;
}

// ============================================================================
// Getters
// ============================================================================

/**
 * Get the current configured domain
 */
export function getDomain(): string {
  return currentDomain;
}

/**
 * Get the env-specific auth-token cookie name (`__access_token` on production,
 * `__dev__access_token` on staging). Reflects the domain resolved by the most
 * recent initializeDomain() call.
 */
export function accessTokenCookieName(): string {
  return currentTokenCookieName;
}

// ============================================================================
// URL Builders
// ============================================================================

/**
 * Get the login page URL
 */
export function loginUrl(): string {
  return `https://${currentDomain}/login`;
}

/**
 * Get the draft editor URL
 */
export function draftUrl(draftId: string): string {
  return `https://${currentDomain}/me/drafts/${draftId}`;
}

/**
 * Get the published article URL
 */
export function articleUrl(
  userName: string,
  slug: string,
  shortHash: string
): string {
  return `https://${currentDomain}/@${userName}/${slug}-${shortHash}`;
}

/**
 * Get the published collection URL.
 *
 * Collection ids are Matters global ids (base64, e.g. "Q29sbGVjdGlvbjo0ODQx");
 * encode defensively so an id with reserved characters still forms a valid URL.
 */
export function collectionUrl(userName: string, collectionId: string): string {
  return `https://${currentDomain}/@${userName}/collections/${encodeURIComponent(collectionId)}`;
}

// ============================================================================
// URL Matchers
// ============================================================================

/**
 * Check if a URL belongs to the configured Matters domain
 */
export function isMattersUrl(url: string): boolean {
  return url.includes(currentDomain);
}

/**
 * Extract the Matters shortHash from an article URL.
 *
 * Supports both URL forms Matters produces:
 *   - Canonical:   https://matters.town/@user/<slug>-<shortHash>  → <shortHash>
 *   - Short link:  https://matters.town/a/<shortHash>             → <shortHash>
 *
 * Accepts absolute or root-relative URLs. Returns null when no shortHash can be
 * determined. Pure function: the fixed base host only lets `new URL` parse
 * root-relative inputs and never affects the parsed pathname.
 */
export function extractShortHash(url: string): string | null {
  let path: string;
  try {
    path = new URL(url, "https://matters.town").pathname;
  } catch {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // Short-link form: /a/<shortHash> — the whole segment is the hash.
  if (segments[0] === "a" && segments.length >= 2) {
    return segments[1] || null;
  }

  // Collection form: /@user/collections/<id> — not an article. Without this
  // guard an id containing a hyphen would yield a bogus "shortHash".
  if (segments[1] === "collections") return null;

  // Canonical form: /@user/<slug>-<shortHash> — hash is after the final hyphen.
  const last = segments[segments.length - 1];
  const hyphen = last.lastIndexOf("-");
  return hyphen === -1 ? null : last.substring(hyphen + 1) || null;
}

/**
 * Extract the Matters collection id from a collection URL.
 *
 * Matches the canonical form /@user/collections/<id> (absolute or
 * root-relative). Returns null for anything else, including article URLs.
 */
export function extractCollectionId(url: string): string | null {
  let path: string;
  try {
    path = new URL(url, "https://matters.town").pathname;
  } catch {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length < 3) return null;
  if (!segments[0].startsWith("@") || segments[1] !== "collections") return null;

  try {
    return decodeURIComponent(segments[2]) || null;
  } catch {
    return null;
  }
}

/**
 * Check if a URL points to the current user's content on the configured domain
 */
export function isInternalMattersLink(
  url: string,
  userName: string
): boolean {
  // Escape backslashes in domain before escaping dots for regex
  const escapedDomain = currentDomain.replace(/\\/g, "\\\\").replace(/\./g, "\\.");
  const pattern = new RegExp(
    `^https?://${escapedDomain}/@${userName}/`
  );
  return pattern.test(url);
}
