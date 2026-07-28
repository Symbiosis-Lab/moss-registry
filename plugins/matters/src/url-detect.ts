/**
 * Pure URL classifiers for the Matters browser-panel.
 *
 * The published-article URL is only a TRIGGER; the Matters API (draft.article)
 * remains the source of truth for confirming a publish. These functions never
 * confirm a publish on their own — they are hints to fire an immediate API
 * verify instead of waiting for the next 5s poll cycle.
 */

/**
 * Extract the pathname from a URL string. Returns "" on parse failure.
 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Returns true when the URL points to the Matters draft editor:
 * `…/me/drafts/<id>`.
 */
export function isDraftUrl(url: string): boolean {
  return /^\/me\/drafts\/[^/]+/.test(pathOf(url));
}

/**
 * Returns true when the URL looks like a published Matters article:
 * `/@<user>/<slug>-<shortHash>`.
 *
 * The hash suffix requirement (`-[a-z0-9]{6,}` at the end of the slug) rejects
 * profile sub-pages like `/@user/followers`, `/@user/settings`,
 * `/@user/bookmarks`, and bare `/@user`.
 *
 * Accepted false-trigger: Matters sub-pages whose final path segment ends in
 * `-<6+ alnum>` (e.g. `/@u/tags-abcdef`) will pass this check. This is
 * harmless — the API `draft.article` verify rejects them as unrelated content.
 *
 * This is a HINT only — always verify publication via the API before acting on it.
 */
export function looksLikePublishedArticleUrl(url: string): boolean {
  const path = pathOf(url);
  // Must be /@user/slug-<shortHash>
  // - segment under @ handle is required (rejects bare /@user)
  // - trailing segment must end with -[a-z0-9]{6,} (the Matters hash suffix)
  return /^\/@[^/]+\/[^/]+-[a-z0-9]{6,}$/.test(path);
}
