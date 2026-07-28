/**
 * Git utility functions for the GitHub Pages Publisher Plugin
 *
 * Pure functions for URL parsing.
 */

/**
 * Extract GitHub owner and repo from remote URL
 */
export function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  // Parse HTTPS URLs: https://github.com/user/repo.git
  // Allows dots in repo name (e.g., username.github.io) but not slashes
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // Parse SSH URLs: git@github.com:user/repo.git
  // Allows dots in repo name (e.g., username.github.io) but not slashes
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
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
