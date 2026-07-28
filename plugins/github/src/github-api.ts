/**
 * GitHub API Module
 *
 * Provides functions for interacting with GitHub's REST API.
 * Used for repository creation and availability checking.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * GitHub user information
 */
export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  name?: string;
}

/**
 * Repository information returned after creation
 */
export interface CreatedRepository {
  /** Repository name */
  name: string;
  /** Full name (owner/repo) */
  fullName: string;
  /** HTML URL (https://github.com/owner/repo) */
  htmlUrl: string;
  /** SSH URL (git@github.com:owner/repo.git) */
  sshUrl: string;
  /** HTTPS clone URL */
  cloneUrl: string;
}

/**
 * Result of repository availability check
 */
export interface RepoAvailabilityResult {
  /** Whether the name is available */
  available: boolean;
  /** If not available, why */
  reason?: "exists" | "invalid" | "error";
  /** Error message if any */
  message?: string;
}

/**
 * GitHub Pages deployment status
 * Feature 21: Used to check if a deployed site is live
 */
export interface PagesStatus {
  /** Deployment status: built, building, errored, or unknown */
  status: "built" | "building" | "errored" | "unknown";
  /** The GitHub Pages URL for this repository */
  url: string;
  /** The commit SHA this build corresponds to */
  commit?: string;
  /** Error message from the build, if any */
  error?: string;
}

/**
 * GitHub Pages configuration (custom domain + HTTPS state)
 * Used by the idempotent configure_domain hook to check current state.
 */
export interface PagesConfig {
  /** Currently configured custom domain (CNAME), or null if none */
  cname: string | null;
  /** Whether HTTPS is enforced for the custom domain */
  https_enforced: boolean;
}

// ============================================================================
// API Constants
// ============================================================================

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "moss-GitHub-Deployer",
};

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get the authenticated user's information
 *
 * @param token - GitHub OAuth access token
 * @returns User information
 * @throws Error if request fails or token is invalid
 */
export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      ...GITHUB_API_HEADERS,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid or expired token");
    }
    throw new Error(`Failed to get user: ${response.status}`);
  }

  return response.json();
}

/**
 * Check if a repository name is available for the authenticated user
 *
 * @param name - Repository name to check
 * @param token - GitHub OAuth access token
 * @returns Availability result
 */
export async function checkRepoNameAvailable(
  name: string,
  token: string
): Promise<RepoAvailabilityResult> {
  // Validate name format first
  if (!isValidRepoName(name)) {
    return {
      available: false,
      reason: "invalid",
      message: "Repository name can only contain letters, numbers, hyphens, underscores, and periods",
    };
  }

  try {
    // Get the authenticated user to check their repos
    const user = await getAuthenticatedUser(token);

    // Check if repo exists
    const response = await fetch(`${GITHUB_API_BASE}/repos/${user.login}/${name}`, {
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      // Repo doesn't exist - name is available
      return { available: true };
    }

    if (response.ok) {
      // Repo exists
      return {
        available: false,
        reason: "exists",
        message: `Repository '${name}' already exists`,
      };
    }

    // Other error
    return {
      available: false,
      reason: "error",
      message: `Failed to check availability: ${response.status}`,
    };
  } catch (error) {
    return {
      available: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create a new public repository for the authenticated user
 *
 * @param name - Repository name
 * @param token - GitHub OAuth access token
 * @param description - Optional repository description
 * @returns Created repository information
 * @throws Error if creation fails
 */
export async function createRepository(
  name: string,
  token: string,
  description?: string
): Promise<CreatedRepository> {
  console.log(`Creating repository: ${name}`);

  const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: "POST",
    headers: {
      ...GITHUB_API_HEADERS,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      description: description ?? "Created with moss",
      private: false, // Always public for GitHub Pages
      auto_init: false, // Force-push overwrites any initial commit; avoid useless "Initial commit"
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.message || `Failed to create repository: ${response.status}`;
    throw new Error(message);
  }

  const repo = await response.json();

  console.log(`Repository created: ${repo.html_url}`);

  return {
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    sshUrl: repo.ssh_url,
    cloneUrl: repo.clone_url,
  };
}

/**
 * Get the SSH URL for an existing repository
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @param token - GitHub OAuth access token
 * @returns The SSH URL (e.g., git@github.com:owner/repo.git)
 * @throws Error if repo is not found or request fails
 */
export async function getRepoSshUrl(
  owner: string,
  repo: string,
  token: string
): Promise<string> {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Repo not found: ${owner}/${repo}`);
  const data = await response.json();
  return data.ssh_url;
}

/**
 * Check if a repository exists for a given owner
 *
 * Feature 20: Used to check if {username}.github.io already exists
 * before auto-creating it.
 *
 * @param owner - Repository owner (username or org)
 * @param name - Repository name
 * @param token - GitHub OAuth access token
 * @returns true if repo exists, false otherwise (including errors)
 */
export async function checkRepoExists(
  owner: string,
  name: string,
  token: string
): Promise<boolean> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}`, {
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    });

    return response.ok;
  } catch {
    // Network errors or other failures - treat as "doesn't exist"
    return false;
  }
}

/**
 * Check GitHub Pages deployment status
 *
 * Feature 21: Used to verify if a deployed site is live.
 * Uses GET /repos/{owner}/{repo}/pages/builds/latest
 *
 * @see https://docs.github.com/en/rest/pages/pages
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @param token - GitHub OAuth access token
 * @returns Pages status with deployment state and URL
 */
export async function checkPagesStatus(
  owner: string,
  repo: string,
  token: string
): Promise<PagesStatus> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages/builds/latest`,
      {
        headers: {
          ...GITHUB_API_HEADERS,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      return { status: "unknown", url: "" };
    }

    const data = await response.json();

    // Generate the GitHub Pages URL
    // Root repo ({username}.github.io) → https://{username}.github.io/
    // Project repo → https://{username}.github.io/{repo}
    const isRootRepo = repo === `${owner}.github.io`;
    const url = isRootRepo
      ? `https://${owner}.github.io/`
      : `https://${owner}.github.io/${repo}`;

    // Map API status to our status type
    const status = data.status as "built" | "building" | "errored" | undefined;

    return {
      status: status || "unknown",
      url,
      commit: data.commit || undefined,
      error: data.error?.message || undefined,
    };
  } catch {
    return { status: "unknown", url: "" };
  }
}

/**
 * Explicitly request a GitHub Pages build.
 *
 * Force-pushed orphan commits sometimes don't trigger automatic builds.
 * This endpoint forces GitHub to rebuild from the current gh-pages branch.
 *
 * @see https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build
 */
export async function requestPagesBuild(
  owner: string,
  repo: string,
  token: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages/builds`,
      {
        method: "POST",
        headers: {
          ...GITHUB_API_HEADERS,
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get current GitHub Pages configuration (custom domain + HTTPS state)
 *
 * Used by the idempotent configure_domain hook to check what's already
 * configured before making changes.
 *
 * @see https://docs.github.com/en/rest/pages/pages#get-a-github-pages-site
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @param token - GitHub OAuth access token
 * @returns Pages config, or null if Pages is not enabled (404)
 */
export async function getPages(
  owner: string,
  repo: string,
  token: string,
): Promise<PagesConfig | null> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages`;
  const response = await fetch(url, {
    headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return { cname: data.cname || null, https_enforced: !!data.https_enforced };
}

/**
 * Enforce HTTPS on a GitHub Pages custom domain
 *
 * This requires the SSL certificate to be provisioned by Let's Encrypt,
 * which happens automatically after DNS propagation. If the cert isn't
 * ready yet, GitHub returns an error and this function returns false.
 *
 * @see https://docs.github.com/en/rest/pages/pages#update-information-about-a-github-pages-site
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @param token - GitHub OAuth access token
 * @returns true if HTTPS was successfully enforced, false if not yet possible
 */
export async function enforceHttps(
  owner: string,
  repo: string,
  token: string,
): Promise<boolean> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...GITHUB_API_HEADERS,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ https_enforced: true }),
  });
  return response.ok;
}

/**
 * Set a custom domain (CNAME) for GitHub Pages
 *
 * Uses the GitHub Pages API to configure a custom domain for the repository.
 * This is the API equivalent of setting the "Custom domain" field in the
 * repository's Pages settings.
 *
 * @see https://docs.github.com/en/rest/pages/pages#update-information-about-a-github-pages-site
 *
 * @param owner - GitHub username or organization
 * @param repo - Repository name
 * @param token - GitHub OAuth access token
 * @param domain - Custom domain to configure (e.g., "example.com")
 * @returns true if the domain was set successfully
 */
export async function setCustomDomain(
  owner: string,
  repo: string,
  token: string,
  domain: string,
): Promise<boolean> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages`;
  const headers = {
    ...GITHUB_API_HEADERS,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // Try with HTTPS enforcement first
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ cname: domain, https_enforced: true }),
  });

  if (response.ok) return true;

  // GitHub rejects https_enforced if DNS hasn't propagated yet (422),
  // or if the SSL certificate doesn't exist yet (404).
  // Retry without it — HTTPS can be enabled later in GitHub settings
  // once DNS propagates and the certificate is provisioned.
  if (response.status === 422 || response.status === 404) {
    const retryResponse = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ cname: domain }),
    });
    if (retryResponse.ok) return true;

    // GitHub returns 404 when the SSL certificate doesn't exist yet.
    // The CNAME is typically set despite the 404 response — GitHub
    // processes the CNAME before checking the cert. Return true and
    // let getPages() verify the actual state on the next call.
    if (retryResponse.status === 404) return true;

    const body = await retryResponse.text();
    throw new Error(
      `GitHub Pages API error (${retryResponse.status}): ${body}`
    );
  }

  const body = await response.text();
  throw new Error(
    `GitHub Pages API error (${response.status}): ${body}`
  );
}

// ============================================================================
// Pages Source Configuration
// ============================================================================

/**
 * Result of ensuring GitHub Pages source is configured correctly
 */
export interface EnsurePagesResult {
  /** Whether Pages is now serving from the desired branch */
  configured: boolean;
  /** Whether Pages was newly created (vs. already existed) */
  wasCreated: boolean;
}

/**
 * Ensure GitHub Pages serves from the specified branch.
 *
 * - If Pages is not enabled (404): POST to create it
 * - If Pages exists but on the wrong branch: PUT to update it
 * - If Pages is already on the correct branch: no-op
 *
 * Non-fatal: returns { configured: false } on errors instead of throwing.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub access token
 * @param branch - Desired source branch (e.g. "gh-pages")
 * @returns Result indicating whether Pages was configured
 */
export async function ensurePagesSource(
  owner: string,
  repo: string,
  token: string,
  branch: string,
): Promise<EnsurePagesResult> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages`;
  const headers = {
    ...GITHUB_API_HEADERS,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const sourceBody = JSON.stringify({ source: { branch, path: "/" } });

  try {
    // Check current Pages config
    const getResp = await fetch(url, { headers });

    if (getResp.status === 404) {
      // Pages not enabled — create it
      const postResp = await fetch(url, { method: "POST", headers, body: sourceBody });
      if (postResp.ok) {
        return { configured: true, wasCreated: true };
      }
      return { configured: false, wasCreated: false };
    }

    if (getResp.ok) {
      const data = await getResp.json();
      if (data.source?.branch === branch) {
        // Already correct
        return { configured: true, wasCreated: false };
      }
      // Wrong branch — update it
      const putResp = await fetch(url, { method: "PUT", headers, body: sourceBody });
      if (putResp.ok) {
        return { configured: true, wasCreated: false };
      }
      return { configured: false, wasCreated: false };
    }

    return { configured: false, wasCreated: false };
  } catch {
    return { configured: false, wasCreated: false };
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if a repository name is valid
 *
 * GitHub repo names can contain:
 * - Letters (a-z, A-Z)
 * - Numbers (0-9)
 * - Hyphens (-)
 * - Underscores (_)
 * - Periods (.)
 *
 * Cannot start with a period or be empty.
 */
export function isValidRepoName(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }

  if (name.startsWith(".")) {
    return false;
  }

  // GitHub has a max length of 100 characters
  if (name.length > 100) {
    return false;
  }

  // Only allowed characters
  return /^[a-zA-Z0-9._-]+$/.test(name);
}
