/**
 * The deploy contract with moss: a site built by a real moss is published by
 * the plugin's own deploy code with real git. Only GitHub is replaced, by a
 * local bare repository, so this runs offline and catches moss moving its
 * build where the plugin no longer looks.
 *
 * Run: MOSS_BINARY=/path/to/moss INCLUDE_E2E=1 npx vitest run --project e2e
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const MOSS_BINARY = process.env.MOSS_BINARY;
if (!MOSS_BINARY) console.warn("github deploy contract skipped: set MOSS_BINARY to a moss CLI binary");

const OWNER = "alex";
const REPO = "site";
const run = { site: "", remote: "", env: {} as NodeJS.ProcessEnv };

// moss-api's host calls, bound to real processes in the site folder. Any
// github.com address the plugin hands git points at the local bare repository.
vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: async (o: { binaryPath: string; args: string[]; env?: Record<string, string>; stdin?: string }) => {
    const args = o.args.map((a) => (a.includes(`github.com/${OWNER}/${REPO}.git`) ? run.remote : a));
    const r = spawnSync(o.binaryPath, args, { cwd: run.site, env: { ...run.env, ...o.env }, input: o.stdin, encoding: "utf8" });
    return { success: r.status === 0, exitCode: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },
  listSiteFilesWithSizes: async () => [],
}));
vi.mock("../src/utils", () => ({ showToast: async () => {} }));

describe.skipIf(!MOSS_BINARY)("github deploy contract with moss", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-github-contract-"));
    const home = path.join(testDir, "home");
    fs.mkdirSync(home);
    // An empty HOME keeps the developer's git config and moss approvals out.
    run.env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.org" };
    run.site = path.join(testDir, "site");
    run.remote = path.join(testDir, "remote.git");
    fs.mkdirSync(path.join(run.site, ".moss"), { recursive: true });
    fs.writeFileSync(path.join(run.site, "index.md"), "# Hello\n\nBuilt by moss, published by the plugin.\n");
    fs.writeFileSync(path.join(run.site, ".moss", "config.toml"), 'environment = "local"\n');
    execFileSync("git", ["init", "-q", "--bare", run.remote], { env: run.env });

    const build = spawnSync(MOSS_BINARY!, ["build", run.site], { env: run.env, encoding: "utf8", timeout: 120_000 });
    if (build.status !== 0) throw new Error(`moss build failed:\n${build.stdout}\n${build.stderr}`);
  });

  afterAll(() => {
    if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("publishes moss's build to gh-pages and keeps it off main", async () => {
    const { deployViaGitPush } = await import("../src/github-deploy");
    await deployViaGitPush({ owner: OWNER, repo: REPO, token: "test-token", onProgress: () => {}, gitPath: "git" });

    const remote = (...args: string[]) => execFileSync("git", ["--git-dir", run.remote, ...args], { env: run.env, encoding: "utf8" });
    const pages = remote("ls-tree", "-r", "--name-only", "gh-pages").split("\n");
    expect(pages).toContain("index.html");
    expect(pages).toContain(".nojekyll");
    expect(remote("show", "gh-pages:index.html")).toContain("Built by moss, published by the plugin.");

    const main = remote("ls-tree", "-r", "--name-only", "main").split("\n");
    expect(main).toContain("index.md");
    expect(main.filter((f) => f.startsWith(".moss/build"))).toEqual([]);
  });
});
