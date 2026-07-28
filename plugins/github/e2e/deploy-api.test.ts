/**
 * E2E Tests for GitHub REST API Deploy Functions
 *
 * Tests the Git Data API workflow (blob -> tree -> commit -> ref) against
 * real GitHub repos. Uses ephemeral repos that are created and deleted
 * per test suite.
 *
 * Prerequisites:
 * - Set GITHUB_TOKEN environment variable (or have gh CLI authenticated)
 * - Set GITHUB_E2E_TEST=1 to enable these tests
 *
 * These tests verify the same API endpoints used by github-deploy.ts
 * without requiring the Tauri runtime.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";

// Skip all tests unless explicitly enabled
const RUN_E2E = process.env.GITHUB_E2E_TEST === "1";

const GITHUB_API_BASE = "https://api.github.com";

// Get token from environment or gh CLI
function getToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No GITHUB_TOKEN env var and gh auth token failed");
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "moss-E2E-Tests",
    Authorization: `Bearer ${token}`,
  };
}

// Helper: get authenticated username
async function getUsername(token: string): Promise<string> {
  const res = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to get user: ${res.status}`);
  const data = await res.json();
  return data.login;
}

// Helper: create ephemeral repo
async function createEphemeralRepo(
  token: string,
  name: string
): Promise<void> {
  const res = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, auto_init: true, private: false }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Failed to create repo ${name}: ${res.status} ${body.message || ""}`
    );
  }
}

// Helper: delete repo
// Tries the API first (needs delete_repo scope), falls back to gh CLI.
// If both fail, prints manual cleanup instructions.
async function deleteRepo(
  token: string,
  owner: string,
  name: string
): Promise<void> {
  // Try API first
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (res.ok || res.status === 204 || res.status === 404) return;

  // Fall back to gh CLI
  try {
    execFileSync("gh", ["repo", "delete", `${owner}/${name}`, "--yes"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return;
  } catch {
    // Both methods failed
  }

  console.warn(
    `\nCould not delete ephemeral repo ${owner}/${name}.\n` +
    `To grant delete_repo scope: gh auth refresh -h github.com -s delete_repo\n` +
    `To delete manually: gh repo delete ${owner}/${name} --yes\n`
  );
}

// Helper: get branch ref
// Note: GitHub's refs API can return an array (prefix match) or a single object.
async function getBranchRef(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ exists: boolean; sha?: string }> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { headers: authHeaders(token) }
  );
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`getBranchRef failed: ${res.status}`);
  const data = await res.json();

  // GitHub may return an array if the branch name is a prefix of other refs
  if (Array.isArray(data)) {
    const exact = data.find(
      (r: { ref: string }) => r.ref === `refs/heads/${branch}`
    );
    if (!exact) return { exists: false };
    return { exists: true, sha: exact.object.sha };
  }

  return { exists: true, sha: data.object.sha };
}

// Helper: get tree (recursive)
async function getTree(
  token: string,
  owner: string,
  repo: string,
  treeSha: string
): Promise<Array<{ path: string; sha: string; type: string }>> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`getTree failed: ${res.status}`);
  const data = await res.json();
  return data.tree;
}

// Helper: get commit
async function getCommit(
  token: string,
  owner: string,
  repo: string,
  sha: string
): Promise<{ treeSha: string; parents: string[]; message: string }> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${sha}`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`getCommit failed: ${res.status}`);
  const data = await res.json();
  return {
    treeSha: data.tree.sha,
    parents: data.parents.map((p: { sha: string }) => p.sha),
    message: data.message,
  };
}

// Helper: upload a blob
async function uploadBlob(
  token: string,
  owner: string,
  repo: string,
  content: string,
  encoding: string
): Promise<string> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ content, encoding }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `uploadBlob failed: ${res.status} ${body.message || ""}`
    );
  }
  const data = await res.json();
  return data.sha;
}

// Helper: create tree
async function createTree(
  token: string,
  owner: string,
  repo: string,
  entries: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string | null;
  }>,
  baseTree: string | null
): Promise<string> {
  const body: Record<string, unknown> = { tree: entries };
  if (baseTree) body.base_tree = baseTree;
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`createTree failed: ${res.status} ${b.message || ""}`);
  }
  const data = await res.json();
  return data.sha;
}

// Helper: create commit
async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parents: string[]
): Promise<string> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: treeSha, parents }),
    }
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(
      `createCommit failed: ${res.status} ${b.message || ""}`
    );
  }
  const data = await res.json();
  return data.sha;
}

// Helper: create or update ref
async function updateRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  exists: boolean
): Promise<void> {
  let res: Response;
  if (exists) {
    res = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sha, force: true }),
      }
    );
  } else {
    res = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      }
    );
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`updateRef failed: ${res.status} ${b.message || ""}`);
  }
}

// Helper: text to base64
function textToBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

// Helper: get blob content (decoded from base64)
async function getBlobContent(
  token: string,
  owner: string,
  repo: string,
  sha: string
): Promise<string> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`getBlobContent failed: ${res.status}`);
  const data = await res.json();
  const base64 = data.content.replace(/\n/g, "");
  return Buffer.from(base64, "base64").toString("utf-8");
}

// ============================================================================
// Test Suites
// ============================================================================

describe.skipIf(!RUN_E2E)("GitHub REST API Deploy E2E", () => {
  let token: string;
  let owner: string;
  const repoName = `moss-e2e-${Date.now()}`;

  beforeAll(async () => {
    token = getToken();
    owner = await getUsername(token);
    await createEphemeralRepo(token, repoName);
    // Small delay for GitHub to propagate
    await new Promise((r) => setTimeout(r, 2000));
  }, 30000);

  afterAll(async () => {
    await deleteRepo(token, owner, repoName);
  }, 15000);

  // ========================================================================
  // Scenario 1: First-time deploy (repo has main from auto_init, no gh-pages)
  // ========================================================================

  let scenario1CommitSha: string;
  let scenario1TreeSha: string;

  describe("Scenario 1: First-time deploy to gh-pages", () => {
    it("uploads blobs and creates gh-pages branch", async () => {
      // Repo was created with auto_init: main exists, but gh-pages does not
      const ghPages = await getBranchRef(token, owner, repoName, "gh-pages");
      expect(ghPages.exists).toBe(false);

      // Upload 3 files as blobs
      const files = [
        { path: "index.html", content: "<h1>Hello World</h1>" },
        { path: "about/index.html", content: "<h1>About</h1>" },
        {
          path: "articles/hello/index.html",
          content: "<h1>Hello Article</h1>",
        },
      ];

      const blobShas: Record<string, string> = {};
      for (const file of files) {
        blobShas[file.path] = await uploadBlob(
          token,
          owner,
          repoName,
          textToBase64(file.content),
          "base64"
        );
      }

      // Create tree (no base tree -- first deploy)
      const treeEntries = files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: blobShas[f.path],
      }));

      scenario1TreeSha = await createTree(
        token,
        owner,
        repoName,
        treeEntries,
        null
      );

      // Create orphan commit
      scenario1CommitSha = await createCommit(
        token,
        owner,
        repoName,
        "Deploy site\n\nGenerated by moss",
        scenario1TreeSha,
        []
      );

      // Create gh-pages ref
      await updateRef(
        token,
        owner,
        repoName,
        "gh-pages",
        scenario1CommitSha,
        false
      );

      // Verify: gh-pages branch exists
      const ghPagesAfter = await getBranchRef(
        token,
        owner,
        repoName,
        "gh-pages"
      );
      expect(ghPagesAfter.exists).toBe(true);
      expect(ghPagesAfter.sha).toBe(scenario1CommitSha);

      // Verify: tree has 3 files
      const tree = await getTree(token, owner, repoName, scenario1TreeSha);
      const blobEntries = tree.filter((e) => e.type === "blob");
      expect(blobEntries).toHaveLength(3);
      expect(blobEntries.map((e) => e.path).sort()).toEqual([
        "about/index.html",
        "articles/hello/index.html",
        "index.html",
      ]);

      // Verify: commit is orphan (no parents)
      const commit = await getCommit(
        token,
        owner,
        repoName,
        scenario1CommitSha
      );
      expect(commit.parents).toHaveLength(0);
    }, 30000);

    it("pushes source files to a new branch (first-time backup)", async () => {
      // The "source" branch should not exist yet (tests orphan branch creation)
      // This mirrors pushSourceToMain which creates an orphan branch for source backup
      const source = await getBranchRef(token, owner, repoName, "source");
      expect(source.exists).toBe(false);

      // Upload source files
      const sourceFiles = [
        {
          path: "index.md",
          content: "# Hello World\n\nWelcome to my site.",
        },
        { path: "about.md", content: "# About\n\nAbout me." },
        {
          path: "articles/hello.md",
          content: "# Hello Article\n\nFirst post.",
        },
        {
          path: "moss.toml",
          content: '[site]\ntitle = "My Site"\n',
        },
      ];

      const blobShas: Record<string, string> = {};
      for (const file of sourceFiles) {
        blobShas[file.path] = await uploadBlob(
          token,
          owner,
          repoName,
          textToBase64(file.content),
          "base64"
        );
      }

      // Create tree
      const treeEntries = sourceFiles.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: blobShas[f.path],
      }));

      const treeSha = await createTree(
        token,
        owner,
        repoName,
        treeEntries,
        null
      );

      // Create orphan commit (independent of gh-pages)
      const commitSha = await createCommit(
        token,
        owner,
        repoName,
        "Initial commit\n\nSource files uploaded by moss",
        treeSha,
        []
      );

      // Create source ref
      await updateRef(token, owner, repoName, "source", commitSha, false);

      // Verify: source branch exists
      const sourceAfter = await getBranchRef(
        token,
        owner,
        repoName,
        "source"
      );
      expect(sourceAfter.exists).toBe(true);

      // Verify: source has source files
      const sourceTree = await getTree(token, owner, repoName, treeSha);
      const sourceBlobs = sourceTree.filter((e) => e.type === "blob");
      expect(sourceBlobs).toHaveLength(4);
      expect(sourceBlobs.map((e) => e.path).sort()).toEqual([
        "about.md",
        "articles/hello.md",
        "index.md",
        "moss.toml",
      ]);

      // Verify: .moss/ and .git/ are NOT in source tree
      const hasMossDir = sourceBlobs.some((e) =>
        e.path.startsWith(".moss/")
      );
      const hasGitDir = sourceBlobs.some((e) =>
        e.path.startsWith(".git/")
      );
      expect(hasMossDir).toBe(false);
      expect(hasGitDir).toBe(false);

      // Verify: commit is orphan (no parents -- independent of gh-pages and main)
      const sourceCommit = await getCommit(
        token,
        owner,
        repoName,
        commitSha
      );
      expect(sourceCommit.parents).toHaveLength(0);
    }, 30000);
  });

  // ========================================================================
  // Scenario 2: Subsequent deploy with changes
  // ========================================================================

  let scenario2CommitSha: string;

  describe("Scenario 2: Subsequent deploy with changes", () => {
    it("uploads only changed file and creates new commit", async () => {
      // Get current gh-pages state
      const ghPages = await getBranchRef(
        token,
        owner,
        repoName,
        "gh-pages"
      );
      expect(ghPages.exists).toBe(true);

      const currentCommit = await getCommit(
        token,
        owner,
        repoName,
        ghPages.sha!
      );
      const currentTreeSha = currentCommit.treeSha;

      // Get current tree to identify unchanged files
      const currentTree = await getTree(
        token,
        owner,
        repoName,
        currentTreeSha
      );

      // Upload ONLY the changed file (index.html with new content)
      const newContent = "<h1>Hello World - Updated!</h1>";
      const newBlobSha = await uploadBlob(
        token,
        owner,
        repoName,
        textToBase64(newContent),
        "base64"
      );

      // Create tree with base_tree (only send changed entry)
      const treeEntries = [
        {
          path: "index.html",
          mode: "100644",
          type: "blob",
          sha: newBlobSha,
        },
      ];

      const newTreeSha = await createTree(
        token,
        owner,
        repoName,
        treeEntries,
        currentTreeSha
      );

      // Create commit with parent (not orphan this time)
      scenario2CommitSha = await createCommit(
        token,
        owner,
        repoName,
        "Deploy site\n\nGenerated by moss",
        newTreeSha,
        [ghPages.sha!]
      );

      // Update gh-pages ref
      await updateRef(
        token,
        owner,
        repoName,
        "gh-pages",
        scenario2CommitSha,
        true
      );

      // Verify: the commit we created has the right structure
      // (We verify the commit directly rather than re-reading the ref,
      // because GitHub Pages automation may update the ref after our push)
      const newCommit = await getCommit(
        token,
        owner,
        repoName,
        scenario2CommitSha
      );
      expect(newCommit.parents).toHaveLength(1);
      expect(newCommit.parents[0]).toBe(ghPages.sha!);

      // Verify: tree still has all 3 files
      const newTree = await getTree(token, owner, repoName, newTreeSha);
      const blobs = newTree.filter((e) => e.type === "blob");
      expect(blobs).toHaveLength(3);

      // Verify: index.html has new SHA
      const indexEntry = blobs.find((e) => e.path === "index.html");
      expect(indexEntry?.sha).toBe(newBlobSha);

      // Verify: other files are unchanged (same SHA as scenario 1)
      const aboutEntry = blobs.find(
        (e) => e.path === "about/index.html"
      );
      const scenario1About = currentTree.find(
        (e: { path: string }) => e.path === "about/index.html"
      );
      expect(aboutEntry?.sha).toBe(scenario1About?.sha);

      // Verify: main branch is unchanged
      const mainRef = await getBranchRef(token, owner, repoName, "main");
      expect(mainRef.exists).toBe(true);
    }, 30000);
  });

  // ========================================================================
  // Scenario 3: No-change deploy
  // ========================================================================

  describe("Scenario 3: No-change deploy", () => {
    it("detects no changes via blob SHA idempotency", async () => {
      // The core insight: uploading identical content produces identical blob SHAs.
      // Our diff algorithm compares local blob SHAs against remote tree SHAs.
      // If they match, there are no changes to deploy.

      // Upload the same content twice and verify SHAs match
      const content = "<h1>Idempotency Test</h1>";
      const firstSha = await uploadBlob(
        token,
        owner,
        repoName,
        textToBase64(content),
        "base64"
      );

      const secondSha = await uploadBlob(
        token,
        owner,
        repoName,
        textToBase64(content),
        "base64"
      );

      // Same content = same SHA (content-addressed storage)
      expect(firstSha).toBe(secondSha);
      expect(firstSha).toHaveLength(40); // SHA-1 hex

      // Now verify against a tree: create a tree with this blob, then
      // confirm the tree entry's SHA matches what uploadBlob returned
      const treeSha = await createTree(
        token,
        owner,
        repoName,
        [
          {
            path: "test.html",
            mode: "100644",
            type: "blob",
            sha: firstSha,
          },
        ],
        null
      );

      const tree = await getTree(token, owner, repoName, treeSha);
      const entry = tree.find((e) => e.path === "test.html");
      expect(entry?.sha).toBe(firstSha);

      // This proves: if local hash === remote hash, we can skip the deploy
      // (no new tree, commit, or ref update needed)
    }, 30000);
  });

  // ========================================================================
  // Scenario 4: Deploy with file deletions
  // ========================================================================

  describe("Scenario 4: Deploy with file deletions", () => {
    it("removes about/index.html by setting sha to null", async () => {
      // Get current gh-pages state
      const ghPages = await getBranchRef(
        token,
        owner,
        repoName,
        "gh-pages"
      );
      const commit = await getCommit(
        token,
        owner,
        repoName,
        ghPages.sha!
      );

      // Create tree with deletion (sha: null removes the file)
      const treeEntries = [
        {
          path: "about/index.html",
          mode: "100644",
          type: "blob",
          sha: null,
        },
      ];

      const newTreeSha = await createTree(
        token,
        owner,
        repoName,
        treeEntries,
        commit.treeSha
      );

      // Create commit
      const commitSha = await createCommit(
        token,
        owner,
        repoName,
        "Deploy site\n\nGenerated by moss",
        newTreeSha,
        [ghPages.sha!]
      );

      // Update ref
      await updateRef(
        token,
        owner,
        repoName,
        "gh-pages",
        commitSha,
        true
      );

      // Verify: tree no longer has about/index.html
      const newTree = await getTree(token, owner, repoName, newTreeSha);
      const blobs = newTree.filter((e) => e.type === "blob");
      expect(blobs).toHaveLength(2); // Was 3, now 2
      expect(blobs.map((e) => e.path).sort()).toEqual([
        "articles/hello/index.html",
        "index.html",
      ]);
      // about/index.html should NOT be in the tree
      expect(
        blobs.find((e) => e.path === "about/index.html")
      ).toBeUndefined();
    }, 30000);
  });

  // ========================================================================
  // Scenario 5: Binary files (images)
  // ========================================================================

  describe("Scenario 5: Binary files", () => {
    it("uploads a PNG file as base64 blob", async () => {
      // Create a minimal valid 1x1 red PNG (base64)
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

      const blobSha = await uploadBlob(
        token,
        owner,
        repoName,
        pngBase64,
        "base64"
      );

      expect(blobSha).toBeTruthy();
      expect(blobSha).toHaveLength(40); // SHA-1 hex

      // Add the image to gh-pages tree
      const ghPages = await getBranchRef(
        token,
        owner,
        repoName,
        "gh-pages"
      );
      const commit = await getCommit(
        token,
        owner,
        repoName,
        ghPages.sha!
      );

      const treeEntries = [
        {
          path: "assets/photo.png",
          mode: "100644",
          type: "blob",
          sha: blobSha,
        },
      ];

      const newTreeSha = await createTree(
        token,
        owner,
        repoName,
        treeEntries,
        commit.treeSha
      );

      const commitSha = await createCommit(
        token,
        owner,
        repoName,
        "Deploy site\n\nGenerated by moss",
        newTreeSha,
        [ghPages.sha!]
      );

      await updateRef(
        token,
        owner,
        repoName,
        "gh-pages",
        commitSha,
        true
      );

      // Verify: tree now includes the PNG
      const newTree = await getTree(token, owner, repoName, newTreeSha);
      const blobs = newTree.filter((e) => e.type === "blob");
      const pngEntry = blobs.find(
        (e) => e.path === "assets/photo.png"
      );
      expect(pngEntry).toBeDefined();
      expect(pngEntry?.sha).toBe(blobSha);

      // Verify blob content can be retrieved
      const retrievedBlob = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repoName}/git/blobs/${blobSha}`,
        { headers: authHeaders(token) }
      );
      expect(retrievedBlob.ok).toBe(true);
      const blobData = await retrievedBlob.json();
      expect(blobData.encoding).toBe("base64");
      // The content should be the same PNG data (may have newlines added by GitHub)
      expect(blobData.content.replace(/\n/g, "")).toBe(pngBase64);
    }, 30000);
  });
});

// ============================================================================
// Scenario 6: Unicode filenames (independent repo)
// ============================================================================

describe.skipIf(!RUN_E2E)("Scenario 6: Unicode filenames", () => {
  let token: string;
  let owner: string;
  const repoName = `moss-e2e-unicode-${Date.now()}`;

  beforeAll(async () => {
    token = getToken();
    owner = await getUsername(token);
    await createEphemeralRepo(token, repoName);
    await new Promise((r) => setTimeout(r, 2000));
  }, 30000);

  afterAll(async () => {
    await deleteRepo(token, owner, repoName);
  }, 15000);

  it("handles Chinese and Japanese filenames", async () => {
    // Upload files with unicode paths
    const files = [
      { path: "文章/hello.html", content: "<h1>你好世界</h1>" },
      { path: "游记/旅行.html", content: "<h1>旅行日记</h1>" },
      { path: "日本語/テスト.html", content: "<h1>テスト</h1>" },
      { path: "café/résumé.html", content: "<h1>Résumé</h1>" },
    ];

    const blobShas: Record<string, string> = {};
    for (const file of files) {
      blobShas[file.path] = await uploadBlob(
        token,
        owner,
        repoName,
        textToBase64(file.content),
        "base64"
      );
    }

    // Create tree
    const treeEntries = files.map((f) => ({
      path: f.path,
      mode: "100644",
      type: "blob",
      sha: blobShas[f.path],
    }));

    const treeSha = await createTree(
      token,
      owner,
      repoName,
      treeEntries,
      null
    );
    const commitSha = await createCommit(
      token,
      owner,
      repoName,
      "Deploy site",
      treeSha,
      []
    );
    await updateRef(token, owner, repoName, "gh-pages", commitSha, false);

    // Verify: tree has all 4 files with correct unicode paths
    const tree = await getTree(token, owner, repoName, treeSha);
    const blobs = tree.filter((e) => e.type === "blob");
    expect(blobs).toHaveLength(4);

    const paths = blobs.map((e) => e.path).sort();
    expect(paths).toContain("文章/hello.html");
    expect(paths).toContain("游记/旅行.html");
    expect(paths).toContain("日本語/テスト.html");
    expect(paths).toContain("café/résumé.html");

    // Verify: content can be retrieved correctly
    const helloSha = blobShas["文章/hello.html"];
    const content = await getBlobContent(token, owner, repoName, helloSha);
    expect(content).toBe("<h1>你好世界</h1>");
  }, 30000);
});

// ============================================================================
// Scenario 7: Large site (50+ files, independent repo)
// ============================================================================

describe.skipIf(!RUN_E2E)("Scenario 7: Large site (50+ files)", () => {
  let token: string;
  let owner: string;
  const repoName = `moss-e2e-large-${Date.now()}`;

  beforeAll(async () => {
    token = getToken();
    owner = await getUsername(token);
    await createEphemeralRepo(token, repoName);
    await new Promise((r) => setTimeout(r, 2000));
  }, 30000);

  afterAll(async () => {
    await deleteRepo(token, owner, repoName);
  }, 15000);

  it("deploys 50 files without errors", async () => {
    const FILE_COUNT = 50;

    // Generate 50 files
    const files = Array.from({ length: FILE_COUNT }, (_, i) => ({
      path: `articles/article-${String(i + 1).padStart(3, "0")}/index.html`,
      content: `<h1>Article ${i + 1}</h1><p>Content for article ${i + 1}.</p>`,
    }));

    // Upload all blobs
    const blobShas: Record<string, string> = {};
    for (const file of files) {
      blobShas[file.path] = await uploadBlob(
        token,
        owner,
        repoName,
        textToBase64(file.content),
        "base64"
      );
    }

    // Create tree
    const treeEntries = files.map((f) => ({
      path: f.path,
      mode: "100644",
      type: "blob",
      sha: blobShas[f.path],
    }));

    const treeSha = await createTree(
      token,
      owner,
      repoName,
      treeEntries,
      null
    );
    const commitSha = await createCommit(
      token,
      owner,
      repoName,
      "Deploy site",
      treeSha,
      []
    );
    await updateRef(token, owner, repoName, "gh-pages", commitSha, false);

    // Verify: tree has all 50 files
    const tree = await getTree(token, owner, repoName, treeSha);
    const blobs = tree.filter((e) => e.type === "blob");
    expect(blobs).toHaveLength(FILE_COUNT);

    // Verify first and last
    expect(
      blobs.find((e) => e.path === "articles/article-001/index.html")
    ).toBeDefined();
    expect(
      blobs.find((e) => e.path === "articles/article-050/index.html")
    ).toBeDefined();
  }, 120000); // 2 minute timeout for 50 uploads
});

// ============================================================================
// Scenario 8: Auth failure (independent repo)
// ============================================================================

describe.skipIf(!RUN_E2E)("Scenario 8: Auth failure", () => {
  let token: string;
  let owner: string;
  const repoName = `moss-e2e-auth-${Date.now()}`;

  beforeAll(async () => {
    token = getToken();
    owner = await getUsername(token);
    await createEphemeralRepo(token, repoName);
    await new Promise((r) => setTimeout(r, 2000));
  }, 30000);

  afterAll(async () => {
    await deleteRepo(token, owner, repoName);
  }, 15000);

  it("returns 401 for invalid token", async () => {
    const badToken = "ghp_invalidtoken123456789012345678901";

    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}/git/refs/heads/gh-pages`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "moss-E2E-Tests",
          Authorization: `Bearer ${badToken}`,
        },
      }
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toContain("Bad credentials");
  }, 15000);

  it("returns structured error for blob upload with invalid token", async () => {
    const badToken = "ghp_invalidtoken123456789012345678901";

    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}/git/blobs`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "moss-E2E-Tests",
          Authorization: `Bearer ${badToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: textToBase64("test"),
          encoding: "base64",
        }),
      }
    );

    expect(res.status).toBe(401);
  }, 15000);

  it("succeeds after retrying with valid token", async () => {
    // First, verify bad token fails
    const badToken = "ghp_invalidtoken123456789012345678901";
    const failRes = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}/git/refs/heads/gh-pages`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "moss-E2E-Tests",
          Authorization: `Bearer ${badToken}`,
        },
      }
    );
    expect(failRes.status).toBe(401);

    // Then, verify good token succeeds
    const goodRes = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}/git/refs/heads/gh-pages`,
      { headers: authHeaders(token) }
    );
    // 404 is expected (no gh-pages yet), but NOT 401
    expect(goodRes.status).not.toBe(401);
  }, 15000);
});
