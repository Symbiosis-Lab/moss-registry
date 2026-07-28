/**
 * GitHub Deployment Module
 *
 * Deploys site content to GitHub Pages via git push and backs up
 * source files to the main branch.
 *
 * @module github-deploy
 */

import { GITHUB_API_BASE, GITHUB_API_HEADERS } from "./github-api";
import { executeBinary, listSiteFilesWithSizes, type ExecuteResult } from "@symbiosis-lab/moss-api";
import { showToast } from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Progress callback: (percent 0-100, message).
 * Percent reflects weighted phase position, not linear file count.
 */
export type OnProgress = (percent: number, message: string) => void;

/**
 * Result of a deployViaGitPush call.
 */
export interface DeployResult {
  /** Short SHA of the main branch commit (empty string if no changes) */
  commitSha: string;
  /** Full SHA of the orphan commit pushed to gh-pages */
  orphanSha: string;
  /** Whether the gh-pages tree actually changed from the previous deployment */
  treeChanged: boolean;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Parse an error response body for a human-readable message.
 */
async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.message || `GitHub API error: ${response.status}`;
  } catch {
    return `GitHub API error: ${response.status}`;
  }
}


// ============================================================================
// API Functions
// ============================================================================

/**
 * Verify that a repository exists on GitHub.
 *
 * Call this early in the deploy flow to fail fast with a clear error message
 * instead of getting a cryptic "Not Found" from blob/tree/commit endpoints.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub access token
 * @throws {RepoNotFoundError} if the repository is definitively not found (404)
 * @throws {Error} if the token is invalid (401), access is denied (403), or another API error occurs
 */
export async function verifyRepoExists(
  owner: string,
  repo: string,
  token: string
): Promise<void> {
  const headers = {
    ...GITHUB_API_HEADERS,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
    { headers }
  );

  if (response.status === 404) {
    // Disambiguate: check if the owner exists (unauthenticated, works for public profiles)
    const ownerResp = await fetch(`${GITHUB_API_BASE}/users/${owner}`, {
      headers: { ...GITHUB_API_HEADERS },
    });

    if (ownerResp.status === 404) {
      throw new Error(
        `GitHub user or organization "${owner}" not found. ` +
        `Check for typos in the repository owner name.`
      );
    }

    throw new Error(
      `Repository "${owner}/${repo}" not found on GitHub. ` +
      `The repository may not exist, or your token may not have access to it.`
    );
  }

  if (response.status === 401) {
    throw new Error(
      `GitHub token is invalid or expired. Please re-authenticate.`
    );
  }

  if (response.status === 403) {
    throw new Error(
      `Access denied to "${owner}/${repo}". ` +
      `Your token may lack the required "repo" scope.`
    );
  }

  if (!response.ok) {
    const msg = await parseErrorMessage(response);
    throw new Error(msg);
  }
}

// ============================================================================
// Git Origin Helpers
// ============================================================================

/**
 * Read the deploy target from the project's .git origin remote.
 * Returns null if no .git, no origin, or origin is not a GitHub URL.
 */
export async function getOriginOwnerRepo(gitPath: string = "git"): Promise<{ owner: string; repo: string } | null> {
  const result = await executeBinary({
    binaryPath: gitPath,
    args: ["remote", "get-url", "origin"],
    workingDir: ".",
    timeoutMs: 5_000,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });

  if (!result.success) return null;

  const url = result.stdout.trim();

  // Parse HTTPS: https://github.com/{owner}/{repo}.git
  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // Parse SSH: git@github.com:{owner}/{repo}.git
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

// ============================================================================
// Constants
// ============================================================================

/** GitHub's per-file size limit: 100 MB */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Patterns in git error output that indicate corrupt local objects.
 * These errors cannot be fixed by retrying — the .git directory must
 * be wiped and reinitialized. Common cause: iCloud sync corrupting
 * .git/objects/ files.
 */
const CORRUPT_GIT_PATTERNS = [
  "Could not read",
  "Failed to traverse parents",
  "bad object",
  "corrupt",
];

/**
 * Check if a git error message indicates corrupt local git state.
 */
export function looksLikeCorruptGit(errorMsg: string): boolean {
  return CORRUPT_GIT_PATTERNS.some(p => errorMsg.includes(p));
}

// ============================================================================
// Git Push Deploy
// ============================================================================

/**
 * Options for deploying via git push.
 */
export interface DeployViaGitPushOptions {
  owner: string;
  repo: string;
  token: string;
  onProgress: OnProgress;
  gitPath: string;
  /** Custom domain to include as CNAME file in gh-pages branch */
  domain?: string;
}

/**
 * Replace all occurrences of the token in text with "***".
 * Prevents leaking credentials in error messages.
 */
function sanitize(text: string, token: string): string {
  return text.replaceAll(token, "***");
}

/**
 * Format a byte count as a human-readable string (e.g., "105.3 MB").
 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Parse git push progress from stderr and map to a progress range.
 *
 * Git push outputs lines like:
 *   "Writing objects:  79% (234/295), 1.84 MiB | 1.20 MiB/s"
 *
 * @param line - stderr line from git push
 * @param rangeStart - Start of the progress range (e.g., 20)
 * @param rangeEnd - End of the progress range (e.g., 40)
 * @param onProgress - Callback to report progress
 * @param token - Token to sanitize from output
 */
function parsePushProgress(
  line: string,
  rangeStart: number,
  rangeEnd: number,
  onProgress: OnProgress,
  token: string,
): void {
  const match = line.match(/Writing objects:\s+(\d+)%/);
  if (match) {
    const gitPercent = parseInt(match[1], 10);
    const mapped = Math.round(rangeStart + (gitPercent / 100) * (rangeEnd - rangeStart));
    onProgress(mapped, sanitize(line.trim(), token));
  }
}

/**
 * Resolve the current generation directory path (relative to project root).
 *
 * The build pipeline writes output to `.moss/build/generations/<hash>/` and
 * updates `.moss/build/current` (a symlink) to point to that directory.
 * `.moss/build/site/` is empty in the generations model — never stage from there.
 *
 * Returns a path like `.moss/build/generations/abc123def456` — the real directory
 * git can stage and extract a tree from (git does not follow symlinks for
 * `write-tree --prefix`).
 *
 * @throws {Error} if the current symlink is absent or unresolvable
 */
export async function resolveCurrentGenDir(): Promise<string> {
  // `readlink` on macOS does NOT support -f, but the symlink target is already
  // absolute (set_current_ptr uses an absolute path), so plain `readlink` suffices.
  const result = await executeBinary({
    binaryPath: "readlink",
    args: [".moss/build/current"],
    workingDir: ".",
    timeoutMs: 5_000,
    env: {},
  });
  if (!result.success || !result.stdout.trim()) {
    throw new Error(
      "Cannot locate current generation: .moss/build/current symlink is missing or unresolvable. " +
      "Run a build first before deploying."
    );
  }
  // The symlink target is absolute: /abs/path/to/.moss/build/generations/<id>
  // Extract just the generation ID and reconstruct the relative path.
  const absTarget = result.stdout.trim();
  const genId = absTarget.split("/").filter(Boolean).pop();
  if (!genId) {
    throw new Error(`Unexpected generation symlink target: ${absTarget}`);
  }
  return `.moss/build/generations/${genId}`;
}

/**
 * Deploy site to GitHub Pages via a single git repo.
 *
 * Uses one git repo at the project root. Stages site files from the current
 * generation directory (.moss/build/current → .moss/build/generations/<id>/),
 * extracts the generation tree as an orphan commit and pushes it to gh-pages,
 * then backs up source files to main. This gives GitHub Pages the site content
 * at the branch root while keeping source on main.
 *
 * Enforces GitHub's 100MB per-file limit:
 * - Site files (current generation dir): ABORT if any exceed 100MB
 * - Source files (project root): SKIP >100MB files with a warning toast
 *
 * @param options - Deploy options
 * @returns DeployResult with commitSha (short SHA on main) and orphanSha (full SHA on gh-pages)
 */
export async function deployViaGitPush(options: DeployViaGitPushOptions): Promise<DeployResult> {
  const { owner, repo, token, onProgress } = options;
  const repoMarker = `https://github.com/${owner}/${repo}.git`;
  const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

  async function git(
    args: string[],
    onStderr?: (line: string) => void,
  ): Promise<ExecuteResult> {
    return executeBinary({
      binaryPath: options.gitPath,
      args,
      workingDir: ".",
      timeoutMs: 600_000,  // 10 min — first push of large repos can be slow
      env: { GIT_TERMINAL_PROMPT: "0" },
      onStderr,
    });
  }

  // ── Pre-flight: Check site files for 100MB limit ──────────────────────
  onProgress(0, "Preparing deploy...");

  const siteFiles = await listSiteFilesWithSizes();
  const oversizedSiteFiles = siteFiles.filter((f) => f.size > MAX_FILE_SIZE);
  if (oversizedSiteFiles.length > 0) {
    const fileList = oversizedSiteFiles
      .map((f) => `  ${f.path} (${formatSize(f.size)})`)
      .join("\n");
    throw new Error(
      `Site files exceed GitHub's 100 MB per-file limit:\n${fileList}\n\n` +
      `Remove or reduce these files before deploying.`
    );
  }

  // Inner function containing the full init → add → commit → push sequence.
  // Extracted so we can retry once on corrupt git state.
  async function attemptDeploy(): Promise<DeployResult> {
    // ── 1. Init git repo if needed, reinit if target repo changed ────────
    // IDEMPOTENT: detect repo change and reinitialize .git so switching
    // deploy targets doesn't push to the wrong remote.
    const check = await git(["rev-parse", "--git-dir"]);
    let needsInit = !check.success;

    if (check.success) {
      const originUrl = await git(["remote", "get-url", "origin"]);
      if (!originUrl.success || originUrl.stdout.trim() !== repoMarker) {
        // Origin missing or pointing at a different repo — wipe and reinit
        const rm = await executeBinary({
          binaryPath: "rm", args: ["-rf", ".git"],
          workingDir: ".", timeoutMs: 10_000, env: {},
        });
        if (!rm.success) throw new Error(`Failed to remove stale .git: ${rm.stderr}`);
        needsInit = true;
      }
    }

    if (needsInit) {
      await git(["init"]);
      await git(["config", "user.email", "moss@symbiosis-lab.com"]);
      await git(["config", "user.name", "moss"]);
      await git(["remote", "add", "origin", repoMarker]);
    }

    // ── Fetch remote refs for delta compression during push ──────────────
    // Without this, git has no common objects and must upload everything.
    // Non-fatal: first deploy has no remote refs to fetch.
    const fetchResult = await git(["fetch", "--depth=1", "origin"]);
    if (!fetchResult.success) {
      console.log("   No remote history to fetch (first deploy)");
    }

    // ── Migration: strip stale moss-managed .moss/* lines from root .gitignore ──
    // Older moss versions overwrote the root .gitignore with .moss/* exclusions.
    // Those rules now live in .moss/.gitignore (written by the Rust pipeline).
    await executeBinary({
      binaryPath: "sh",
      args: ["-c", "[ -f .gitignore ] && sed -i '' '/^\\.moss/d;/^!\\.moss/d' .gitignore || true"],
      workingDir: ".",
      timeoutMs: 5_000,
      env: {},
    });

    // IDEMPOTENT: remove stale locks from crashed git operations (common with iCloud)
    await executeBinary({
      binaryPath: "rm", args: ["-f", ".git/index.lock"],
      workingDir: ".", timeoutMs: 5_000, env: {},
    });
    await executeBinary({
      binaryPath: "rm", args: ["-f", ".git/shallow.lock"],
      workingDir: ".", timeoutMs: 5_000, env: {},
    });

    // ── 2. Resolve current generation dir and stage its files ────────────
    // .moss/build/site/ is empty in the generations model (#816). The real
    // output lives at .moss/build/current → .moss/build/generations/<id>/.
    // git does not follow symlinks for write-tree --prefix, so we resolve
    // the symlink to the actual (relative) generation directory first.
    onProgress(5, "Staging site files...");
    const genDir = await resolveCurrentGenDir();
    await git(["add", `${genDir}/`]);

    // ── 3. Get site tree SHA directly from index ─────────────────────────
    // Remove index.lock again: iCloud can re-lock the index between git add
    // (which releases it) and write-tree (which needs to read it). The lock
    // file is zero-bytes with iCloud extended attributes — not a real git lock.
    await executeBinary({
      binaryPath: "rm", args: ["-f", ".git/index.lock"],
      workingDir: ".", timeoutMs: 5_000, env: {},
    });
    onProgress(10, "Preparing gh-pages...");
    const writeTree = await git(["write-tree", `--prefix=${genDir}/`]);
    if (!writeTree.success) throw new Error(`Failed to write site tree: ${sanitize(writeTree.stderr, token)}`);

    // Inject .nojekyll (always) and CNAME (when domain is set) into the
    // gh-pages tree. Without .nojekyll, GitHub runs Jekyll which may skip
    // files starting with underscores or fail to trigger the Pages pipeline.
    // Without CNAME, each force-push removes the custom domain setting.
    // Both are injected in a single ls-tree → modify → mktree pass.
    let treeSha = writeTree.stdout.trim();
    {
      // Create empty .nojekyll blob
      const nojekyllHash = await executeBinary({
        binaryPath: options.gitPath,
        args: ["hash-object", "-w", "--stdin"],
        workingDir: ".",
        timeoutMs: 30_000,  // iCloud can slow .git/objects writes
        env: { GIT_TERMINAL_PROMPT: "0" },
        stdin: "",
      });

      if (nojekyllHash.success) {
        const lsTree = await git(["ls-tree", treeSha]);
        if (lsTree.success) {
          // Filter out existing .nojekyll and CNAME entries to avoid duplicates
          // (user's site may already contain these files)
          const filteredEntries = lsTree.stdout.trimEnd().split("\n")
            .filter(line => !line.endsWith("\t.nojekyll") && !line.endsWith("\tCNAME"))
            .join("\n");
          let treeEntries = filteredEntries
            + "\n100644 blob " + nojekyllHash.stdout.trim() + "\t.nojekyll\n";

          // Additionally inject CNAME when domain is configured
          if (options.domain) {
            const cnameHash = await executeBinary({
              binaryPath: options.gitPath,
              args: ["hash-object", "-w", "--stdin"],
              workingDir: ".",
              timeoutMs: 30_000,
              env: { GIT_TERMINAL_PROMPT: "0" },
              stdin: options.domain + "\n",
            });
            if (cnameHash.success) {
              treeEntries += "100644 blob " + cnameHash.stdout.trim() + "\tCNAME\n";
            }
          }

          const mktree = await executeBinary({
            binaryPath: options.gitPath,
            args: ["mktree"],
            workingDir: ".",
            timeoutMs: 30_000,
            env: { GIT_TERMINAL_PROMPT: "0" },
            stdin: treeEntries,
          });
          if (mktree.success) treeSha = mktree.stdout.trim();
        }
      }
    }

    // ── 4. Parent to previous gh-pages tip for delta compression ─────────
    // When the remote gh-pages ref exists, create a child commit instead of
    // an orphan. This lets git delta-compress against the previous tree,
    // drastically reducing upload size on repeat deploys.
    // Also detect whether the tree actually changed (for accurate UI messaging).
    const ghPagesTip = await git(["rev-parse", "refs/remotes/origin/gh-pages"]);
    let treeChanged = true;  // Assume changed unless we prove otherwise
    if (ghPagesTip.success) {
      const prevTree = await git(["rev-parse", `${ghPagesTip.stdout.trim()}^{tree}`]);
      if (prevTree.success && prevTree.stdout.trim() === treeSha) {
        treeChanged = false;
      }
    }
    const commitTreeArgs = ghPagesTip.success
      ? ["commit-tree", treeSha, "-p", ghPagesTip.stdout.trim(), "-m", "Deploy site\n\nGenerated by moss"]
      : ["commit-tree", treeSha, "-m", "Deploy site\n\nGenerated by moss"];
    const orphan = await git(commitTreeArgs);
    if (!orphan.success) throw new Error(`Failed to create gh-pages commit: ${sanitize(orphan.stderr, token)}`);
    const orphanSha = orphan.stdout.trim();

    // ── 5. Push gh-pages first (fast — user sees "Deployed!" quickly) ────
    onProgress(25, "Pushing to GitHub...");
    const push = await git(
      [
        "push", "--force", "--progress", pushUrl,
        `${orphanSha}:refs/heads/gh-pages`,
      ],
      (line) => parsePushProgress(line, 25, 95, onProgress, token),
    );
    if (!push.success) throw new Error(`git push failed: ${sanitize(push.stderr, token)}`);

    onProgress(100, "Deployed!");

    // ── 6. Deferred source backup to main branch (non-fatal) ─────────────
    // Stage the entire vault (may be slow on iCloud) and push source to main.
    // This happens AFTER "Deployed!" so the user isn't waiting.
    //
    // Emit a phase change so the parent's heartbeat shows the right message
    // ("Backing up source...") instead of repeating "Deployed!" for minutes
    // while iCloud-synced `git add --all` of the whole vault grinds.
    onProgress(100, "Backing up source...");
    let sha = "";
    try {
      // Check for source files >100MB and append to .gitignore
      const findResult = await executeBinary({
        binaryPath: "find",
        args: [
          ".", "-not", "-path", "./.moss/*", "-not", "-path", "./.git/*",
          "-type", "f", "-size", "+100M",
        ],
        workingDir: ".",
        timeoutMs: 30_000,
        env: {},
      });

      const largeSourceFiles = findResult.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => l.startsWith("./") ? l.slice(2) : l);

      if (largeSourceFiles.length > 0) {
        const escapedFiles = largeSourceFiles.map((f) => f.replace(/'/g, "'\\''")).join("\\n");
        await executeBinary({
          binaryPath: "sh",
          args: ["-c", `printf "\\n${escapedFiles}\\n" >> .gitignore`],
          workingDir: ".",
          timeoutMs: 5_000,
          env: {},
        });

        const fileList = largeSourceFiles
          .map((f) => `&nbsp;&nbsp;${f}`)
          .join("<br>");
        await showToast({
          variant: "warning",
          message: `Skipped ${largeSourceFiles.length} file(s) exceeding 100 MB:<br>${fileList}`,
          duration: 10_000,
        });
      }

      await git(["add", "--all"]);
      const diff = await git(["diff", "--cached", "--quiet"]);
      if (!diff.success) {
        // Has changes to commit
        const commit = await git(["commit", "-m", "Deploy site\n\nGenerated by moss"]);
        if (commit.success) {
          const revParse = await git(["rev-parse", "--short", "HEAD"]);
          sha = revParse.success ? revParse.stdout.trim() : "";
          await git(["push", pushUrl, "HEAD:refs/heads/main"]);
        }
      } else {
        // No new changes to commit, but push any existing unpushed commits.
        // This handles the case where previous deploys committed but failed
        // to push (e.g., network error), leaving local main ahead of remote.
        const behind = await git(["rev-list", "--count", "origin/main..HEAD"]);
        if (behind.success && parseInt(behind.stdout.trim(), 10) > 0) {
          await git(["push", pushUrl, "HEAD:refs/heads/main"]);
        }
      }
    } catch {
      // Source backup is non-fatal — site is already deployed to gh-pages
      console.warn("Source backup to main branch failed (non-fatal)");
    }

    return { commitSha: sha, orphanSha, treeChanged };
  }

  // ── Execute with corrupt-git recovery ──────────────────────────────────
  // If the deploy fails due to corrupt local git objects (common with iCloud
  // sync), wipe .git and retry once. Since we force-push, no history is needed.
  try {
    return await attemptDeploy();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!looksLikeCorruptGit(msg)) throw err;

    // Corrupt git state detected — wipe and retry once
    onProgress(0, "Recovering from corrupt git state...");
    console.warn("Corrupt git detected, reinitializing .git");
    await executeBinary({
      binaryPath: "rm", args: ["-rf", ".git"],
      workingDir: ".", timeoutMs: 10_000, env: {},
    });
    return await attemptDeploy();
  }
}
