/**
 * Git utility functions for the GitHub Pages Publisher Plugin
 *
 * Pure functions for URL parsing.
 */

/**
 * Extract GitHub owner and repo from remote URL.
 *
 * Recognizes every common spelling of a GitHub remote: HTTPS, the scp-like
 * SSH shorthand, and explicit ssh:// — with or without the ".git" suffix.
 */
export function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const url = remoteUrl.trim();

  // https://github.com/owner/repo(.git)?
  // Allows dots in repo name (e.g., username.github.io) but not slashes
  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // ssh://git@github.com/owner/repo(.git)?
  const sshUrlMatch = url.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshUrlMatch) {
    return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };
  }

  // git@github.com:owner/repo(.git)? (scp-like SSH shorthand)
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

/**
 * True if two git remote URLs name the same GitHub {owner}/{repo} — the
 * same repository can be spelled as HTTPS, SSH shorthand, or ssh://, and
 * GitHub treats owner/repo names case-insensitively. Used to decide
 * whether an existing repo's origin already matches a deploy target,
 * before ever touching that repo's git state (see github-deploy.ts).
 */
export function isSameGitHubRepo(urlA: string, urlB: string): boolean {
  const a = parseGitHubUrl(urlA);
  const b = parseGitHubUrl(urlB);
  if (!a || !b) return false;
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

/**
 * Check if a repo is the root GitHub Pages repo for the given owner.
 * Root repos follow the pattern {owner}.github.io (case-insensitive).
 */
export function isRootRepo(owner: string, repo: string): boolean {
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io`;
}

/**
 * Build GitHub Pages URL from owner and repo name.
 * User/org site repos (e.g., "username.github.io") serve at root.
 */
export function buildPagesUrl(owner: string, repo: string): string {
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io`;
  }
  return `https://${owner}.github.io/${repo}`;
}

/**
 * Extract GitHub Pages URL from remote URL
 */
export function extractGitHubPagesUrl(remoteUrl: string): string {
  const parsed = parseGitHubUrl(remoteUrl);
  if (!parsed) {
    throw new Error("Could not parse GitHub URL from remote");
  }
  // User/org site repos (e.g., "username.github.io") serve at root
  if (parsed.repo.toLowerCase() === `${parsed.owner.toLowerCase()}.github.io`) {
    return `https://${parsed.owner}.github.io`;
  }
  return `https://${parsed.owner}.github.io/${parsed.repo}`;
}
